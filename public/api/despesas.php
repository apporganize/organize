<?php
declare(strict_types=1);

/**
 * Despesas (lançamentos).
 *
 *   GET    api/despesas.php?mes=AAAA-MM          -> despesas que VENCEM no mês (mais recentes primeiro)
 *   POST   api/despesas.php                      -> cria 1 despesa, ou uma série (parcelas / todo mês)
 *   PUT    api/despesas.php?id=UUID              -> altera os campos de UM lançamento
 *   PATCH  api/despesas.php?id=UUID              -> altera só o status { status: "pago" | "pendente" }
 *   DELETE api/despesas.php?id=UUID&escopo=...   -> exclui; escopo = esta (padrão) | proximas | todas
 *
 * Corpo de POST/PUT:
 *   { descricao, valor, data_despesa (data da compra), data_vencimento, tipo_id,
 *     (se o tipo for "conta com vencimento", data_despesa é ignorada e fica igual ao vencimento)
 *     forma_pagamento: "credito"|"debito"|"pix", cartao_id (obrigatório só no crédito),
 *     status: "pago"|"pendente" }
 * Só no POST:
 *   repeticao: "unica" (padrão) | "parcelada" (só crédito; + parcelas: 2..24, valor = total da compra)
 *            | "mensal" (+ meses: 2..60, valor = valor de cada mês)
 *
 * Em uma série, o status escolhido vale para o primeiro lançamento; os demais nascem pendentes.
 */

require_once __DIR__ . '/../../src/helpers.php';
require_once __DIR__ . '/../../src/valores.php';

const DESCRICAO_MAX = 100;
const PARCELAS_MAX = 24;
const COLUNAS_DESPESA = 'id,descricao,valor,data_despesa,data_vencimento,tipo_id,forma_pagamento,cartao_id,status,'
    . 'serie_id,serie_tipo,serie_numero,serie_total';
const FORMAS = ['credito', 'debito', 'pix'];
const STATUS = ['pago', 'pendente'];

function status_param(mixed $valor): string
{
    if (!is_string($valor) || !in_array($valor, STATUS, true)) {
        json_error('Informe se a despesa está paga ou pendente.', 422);
    }
    return $valor;
}

/** Divide o total em parcelas iguais (em centavos); a última absorve a diferença. */
function dividir_em_parcelas(string $total, int $quantidade): array
{
    $centavos = (int) round(((float) $total) * 100);
    $base = intdiv($centavos, $quantidade);
    if ($base < 1) {
        json_error('O valor é pequeno demais para dividir em ' . $quantidade . ' parcelas.', 422);
    }
    $parcelas = array_fill(0, $quantidade, $base);
    $parcelas[$quantidade - 1] = $centavos - $base * ($quantidade - 1);
    return array_map(fn(int $c): string => number_format($c / 100, 2, '.', ''), $parcelas);
}

/** O tipo é uma "conta com vencimento" (aluguel, água, luz...)? Tipo inexistente conta como não. */
function tipo_so_vencimento(string $tipoId): bool
{
    $linhas = supabase_db('GET', 'tipos_despesa', [
        'query' => ['id' => 'eq.' . $tipoId, 'select' => 'so_vencimento'],
    ]);
    return (bool) ($linhas[0]['so_vencimento'] ?? false);
}

/** Valida os campos de UM lançamento e devolve as colunas prontas para gravar. */
function validar_despesa(array $dados): array
{
    $descricao = required_text(
        $dados,
        'descricao',
        DESCRICAO_MAX,
        'Informe a descrição da despesa.',
        'A descrição deve ter no máximo ' . DESCRICAO_MAX . ' caracteres.'
    );

    $forma = $dados['forma_pagamento'] ?? null;
    if (!is_string($forma) || !in_array($forma, FORMAS, true)) {
        json_error('Escolha a forma de pagamento: crédito, débito ou pix.', 422);
    }

    $cartao = null;
    if ($forma === 'credito') {
        $cartao = uuid_valor($dados['cartao_id'] ?? null, 'Escolha o cartão usado no crédito.');
    }

    $valor = valor_param($dados['valor'] ?? null);
    $tipoId = uuid_valor($dados['tipo_id'] ?? null, 'Escolha o tipo da despesa.');
    $vencimento = data_param($dados['data_vencimento'] ?? null, 'Informe uma data de vencimento válida.');
    // conta com vencimento (aluguel, água, luz): não tem data da compra, usa o vencimento
    $compra = tipo_so_vencimento($tipoId)
        ? $vencimento
        : data_param($dados['data_despesa'] ?? null, 'Informe uma data de compra válida.');

    return [
        'descricao'       => $descricao,
        'valor'           => $valor,
        'data_despesa'    => $compra,
        'data_vencimento' => $vencimento,
        'tipo_id'         => $tipoId,
        'forma_pagamento' => $forma,
        'cartao_id'       => $cartao, // débito e pix nunca levam cartão
        'status'          => status_param($dados['status'] ?? null),
    ];
}

/** Transforma o pedido de criação em uma ou mais linhas para o banco. */
function linhas_para_criar(array $dados): array
{
    $base = validar_despesa($dados);

    $repeticao = $dados['repeticao'] ?? 'unica';
    if (!is_string($repeticao) || !in_array($repeticao, ['unica', 'parcelada', 'mensal'], true)) {
        json_error('Repetição inválida. Use única, parcelada ou mensal.', 422);
    }
    if ($repeticao === 'unica') {
        return [$base];
    }

    if ($repeticao === 'parcelada') {
        if ($base['forma_pagamento'] !== 'credito') {
            json_error('Só é possível parcelar compras no crédito.', 422);
        }
        $quantidade = inteiro_param(
            $dados['parcelas'] ?? null,
            2,
            PARCELAS_MAX,
            'Informe o número de parcelas, de 2 a ' . PARCELAS_MAX . '.'
        );
        $valores = dividir_em_parcelas($base['valor'], $quantidade);
    } else {
        $quantidade = inteiro_param(
            $dados['meses'] ?? null,
            2,
            MESES_MAX,
            'Informe por quantos meses repetir, de 2 a ' . MESES_MAX . '.'
        );
        $valores = array_fill(0, $quantidade, $base['valor']);
    }

    $serie = uuid_v4();
    $linhas = [];
    for ($i = 0; $i < $quantidade; $i++) {
        $linha = $base;
        $linha['valor'] = $valores[$i];
        $linha['data_vencimento'] = somar_meses($base['data_vencimento'], $i);
        if ($repeticao === 'mensal') {
            $linha['data_despesa'] = somar_meses($base['data_despesa'], $i);
        }
        $linha['status'] = $i === 0 ? $base['status'] : 'pendente';
        $linha['serie_id'] = $serie;
        $linha['serie_tipo'] = $repeticao;
        $linha['serie_numero'] = $i + 1;
        $linha['serie_total'] = $quantidade;
        $linhas[] = $linha;
    }
    return $linhas;
}

/** Exclui conforme o escopo; devolve quantos lançamentos foram removidos. */
function excluir_despesa(string $id, string $escopo): int
{
    $filtro = ['id' => 'eq.' . $id];

    if ($escopo !== 'esta') {
        $atual = supabase_db('GET', 'despesas', [
            'query' => ['id' => 'eq.' . $id, 'select' => 'serie_id,serie_numero'],
        ]);
        if (!$atual) {
            json_error('Despesa não encontrada.', 404);
        }
        $serie = $atual[0]['serie_id'] ?? null;
        $formato = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';
        if (is_string($serie) && preg_match($formato, $serie)) {
            $filtro = ['serie_id' => 'eq.' . strtolower($serie)];
            if ($escopo === 'proximas') {
                $filtro['serie_numero'] = 'gte.' . (int) $atual[0]['serie_numero'];
            }
        }
        // sem série, "próximas" e "todas" equivalem a "esta"
    }

    $linhas = supabase_db('DELETE', 'despesas', ['query' => $filtro + ['select' => 'id']]);
    if (!$linhas) {
        json_error('Despesa não encontrada.', 404);
    }
    return count($linhas);
}

api(function () {
    require_login();
    require_method('GET', 'POST', 'PUT', 'PATCH', 'DELETE');
    $metodo = $_SERVER['REQUEST_METHOD'];

    try {
        if ($metodo === 'GET') {
            [$inicio, $fim] = intervalo_do_mes();
            $despesas = supabase_db('GET', 'despesas', [
                'query' => [
                    'select' => COLUNAS_DESPESA,
                    'and'    => '(data_vencimento.gte.' . $inicio . ',data_vencimento.lt.' . $fim . ')',
                    'order'  => 'data_vencimento.desc,criado_em.desc,serie_numero.asc',
                ],
            ]);
            json_response(['ok' => true, 'despesas' => $despesas]);
        }

        if ($metodo === 'POST') {
            $linhas = supabase_db('POST', 'despesas', [
                'query' => ['select' => COLUNAS_DESPESA],
                'json'  => linhas_para_criar(request_json()),
            ]);
            json_response(['ok' => true, 'despesa' => $linhas[0], 'criadas' => count($linhas)], 201);
        }

        if ($metodo === 'PUT' || $metodo === 'PATCH') {
            $id = uuid_param();
            if ($metodo === 'PUT') {
                $alteracoes = validar_despesa(request_json()); // só este lançamento; a série não muda
            } else {
                $alteracoes = ['status' => status_param(request_json()['status'] ?? null)];
            }
            $linhas = supabase_db('PATCH', 'despesas', [
                'query' => ['id' => 'eq.' . $id, 'select' => COLUNAS_DESPESA],
                'json'  => $alteracoes,
            ]);
            if (!$linhas) {
                json_error('Despesa não encontrada.', 404);
            }
            json_response(['ok' => true, 'despesa' => $linhas[0]]);
        }

        // DELETE
        $id = uuid_param();
        $escopo = $_GET['escopo'] ?? 'esta';
        if (!is_string($escopo) || !in_array($escopo, ESCOPOS, true)) {
            json_error('Escopo inválido. Use esta, proximas ou todas.', 422);
        }
        json_response(['ok' => true, 'removidas' => excluir_despesa($id, $escopo)]);
    } catch (SupabaseException $e) {
        $codigo = pg_code($e);
        // tipo ou cartão que não existem (ou não são do usuário) violam a chave estrangeira
        if ($codigo === '23503' && $metodo !== 'DELETE') {
            json_error('O tipo ou o cartão escolhido não foi encontrado. Atualize a página e tente de novo.', 422);
        }
        // trocar uma parcela para débito/pix
        if ($codigo === '23514' && is_array($e->details)
            && str_contains((string) ($e->details['message'] ?? ''), 'despesas_parcelada_so_no_credito')) {
            json_error('Uma parcela de compra parcelada só pode ser no crédito.', 422);
        }
        // banco ainda sem as colunas novas (migração não rodada)
        if ($codigo === '42703' || $codigo === 'PGRST204') {
            json_error('O banco de dados precisa da atualização da etapa 4. Rode os scripts migracao_etapa4.sql e migracao_etapa4b.sql no Supabase.', 500);
        }
        throw $e;
    }
});