<?php
declare(strict_types=1);

/**
 * Receitas (dinheiro que entra).
 *
 *   GET    api/receitas.php?mes=AAAA-MM          -> receitas que entram no mês (mais recentes primeiro)
 *   POST   api/receitas.php                      -> cria 1 receita, ou uma série "todo mês"
 *   PUT    api/receitas.php?id=UUID              -> altera os campos de UM lançamento
 *   PATCH  api/receitas.php?id=UUID              -> altera só o status { status: "recebida" | "a_receber" }
 *   DELETE api/receitas.php?id=UUID&escopo=...   -> exclui; escopo = esta (padrão) | proximas | todas
 *
 * Corpo de POST/PUT:
 *   { descricao, valor, data_recebimento, tipo_receita_id, status: "recebida"|"a_receber" }
 * Só no POST:
 *   repeticao: "unica" (padrão) | "mensal" (+ meses: 2..60, valor = valor de cada mês)
 *
 * Em uma série, o status escolhido vale para o primeiro lançamento; os demais nascem "a receber".
 */

require_once __DIR__ . '/../../src/helpers.php';
require_once __DIR__ . '/../../src/valores.php';

const DESCRICAO_MAX = 100;
const COLUNAS_RECEITA = 'id,descricao,valor,data_recebimento,tipo_receita_id,status,serie_id,serie_tipo,serie_numero,serie_total';
const STATUS_RECEITA = ['recebida', 'a_receber'];

function status_receita(mixed $valor): string
{
    if (!is_string($valor) || !in_array($valor, STATUS_RECEITA, true)) {
        json_error('Informe se a receita foi recebida ou ainda está a receber.', 422);
    }
    return $valor;
}

/** Valida os campos de UM lançamento e devolve as colunas prontas para gravar. */
function validar_receita(array $dados): array
{
    return [
        'descricao' => required_text(
            $dados,
            'descricao',
            DESCRICAO_MAX,
            'Informe a descrição da receita.',
            'A descrição deve ter no máximo ' . DESCRICAO_MAX . ' caracteres.'
        ),
        'valor'            => valor_param($dados['valor'] ?? null),
        'data_recebimento' => data_param($dados['data_recebimento'] ?? null, 'Informe uma data de recebimento válida.'),
        'tipo_receita_id'  => uuid_valor($dados['tipo_receita_id'] ?? null, 'Escolha o tipo da receita.'),
        'status'           => status_receita($dados['status'] ?? null),
    ];
}

/** Transforma o pedido de criação em uma ou mais linhas para o banco. */
function linhas_para_criar(array $dados): array
{
    $base = validar_receita($dados);

    $repeticao = $dados['repeticao'] ?? 'unica';
    if (!is_string($repeticao) || !in_array($repeticao, ['unica', 'mensal'], true)) {
        json_error('Repetição inválida. Use única ou mensal.', 422);
    }
    if ($repeticao === 'unica') {
        return [$base];
    }

    $quantidade = inteiro_param(
        $dados['meses'] ?? null,
        2,
        MESES_MAX,
        'Informe por quantos meses repetir, de 2 a ' . MESES_MAX . '.'
    );

    $serie = uuid_v4();
    $linhas = [];
    for ($i = 0; $i < $quantidade; $i++) {
        $linha = $base;
        $linha['data_recebimento'] = somar_meses($base['data_recebimento'], $i);
        $linha['status'] = $i === 0 ? $base['status'] : 'a_receber';
        $linha['serie_id'] = $serie;
        $linha['serie_tipo'] = 'mensal';
        $linha['serie_numero'] = $i + 1;
        $linha['serie_total'] = $quantidade;
        $linhas[] = $linha;
    }
    return $linhas;
}

/** Exclui conforme o escopo; devolve quantos lançamentos foram removidos. */
function excluir_receita(string $id, string $escopo): int
{
    $filtro = ['id' => 'eq.' . $id];

    if ($escopo !== 'esta') {
        $atual = supabase_db('GET', 'receitas', [
            'query' => ['id' => 'eq.' . $id, 'select' => 'serie_id,serie_numero'],
        ]);
        if (!$atual) {
            json_error('Receita não encontrada.', 404);
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

    $linhas = supabase_db('DELETE', 'receitas', ['query' => $filtro + ['select' => 'id']]);
    if (!$linhas) {
        json_error('Receita não encontrada.', 404);
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
            $receitas = supabase_db('GET', 'receitas', [
                'query' => [
                    'select' => COLUNAS_RECEITA,
                    'and'    => '(data_recebimento.gte.' . $inicio . ',data_recebimento.lt.' . $fim . ')',
                    'order'  => 'data_recebimento.desc,criado_em.desc,serie_numero.asc',
                ],
            ]);
            json_response(['ok' => true, 'receitas' => $receitas]);
        }

        if ($metodo === 'POST') {
            $linhas = supabase_db('POST', 'receitas', [
                'query' => ['select' => COLUNAS_RECEITA],
                'json'  => linhas_para_criar(request_json()),
            ]);
            json_response(['ok' => true, 'receita' => $linhas[0], 'criadas' => count($linhas)], 201);
        }

        if ($metodo === 'PUT' || $metodo === 'PATCH') {
            $id = uuid_param();
            if ($metodo === 'PUT') {
                $alteracoes = validar_receita(request_json()); // só este lançamento; a série não muda
            } else {
                $alteracoes = ['status' => status_receita(request_json()['status'] ?? null)];
            }
            $linhas = supabase_db('PATCH', 'receitas', [
                'query' => ['id' => 'eq.' . $id, 'select' => COLUNAS_RECEITA],
                'json'  => $alteracoes,
            ]);
            if (!$linhas) {
                json_error('Receita não encontrada.', 404);
            }
            json_response(['ok' => true, 'receita' => $linhas[0]]);
        }

        // DELETE
        $id = uuid_param();
        $escopo = $_GET['escopo'] ?? 'esta';
        if (!is_string($escopo) || !in_array($escopo, ESCOPOS, true)) {
            json_error('Escopo inválido. Use esta, proximas ou todas.', 422);
        }
        json_response(['ok' => true, 'removidas' => excluir_receita($id, $escopo)]);
    } catch (SupabaseException $e) {
        $codigo = pg_code($e);
        // tipo que não existe (ou não é do usuário) viola a chave estrangeira
        if ($codigo === '23503' && $metodo !== 'DELETE') {
            json_error('O tipo escolhido não foi encontrado. Atualize a página e tente de novo.', 422);
        }
        // banco ainda sem as tabelas novas (migração não rodada)
        if (in_array($codigo, ['42P01', '42703', 'PGRST204', 'PGRST205'], true)) {
            json_error('O banco de dados precisa da atualização da etapa 5. Rode o script migracao_etapa5.sql no Supabase.', 500);
        }
        throw $e;
    }
});