<?php
declare(strict_types=1);

/**
 * Contas do resumo do mês e do painel (receitas, despesas, saldo, limite, totais por tipo).
 * Tudo é somado em CENTAVOS (inteiros) para não acumular erro de arredondamento.
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/valores.php';

const LIMITE_ALERTA_PERCENTUAL = 80; // a partir daqui o app avisa que o limite está perto

/** "1234.56" ou 1234.56 -> 123456 */
function em_centavos(mixed $valor): int
{
    return (int) round(((float) $valor) * 100);
}

/** 123456 -> "1234.56" (texto com 2 casas, sem arredondar por ponto flutuante) */
function em_reais(int $centavos): string
{
    $sinal = $centavos < 0 ? '-' : '';
    $centavos = abs($centavos);
    return $sinal . intdiv($centavos, 100) . '.' . str_pad((string) ($centavos % 100), 2, '0', STR_PAD_LEFT);
}

/** Primeiro dia (AAAA-MM-DD) do mês $mes (AAAA-MM) deslocado em $delta meses. */
function primeiro_dia_do_mes(string $mes, int $delta = 0): string
{
    return (new DateTimeImmutable($mes . '-01'))->modify(($delta >= 0 ? '+' : '') . $delta . ' month')->format('Y-m-d');
}

/**
 * Todas as linhas de $tabela cuja $colunaData está em [$inicio, $fim).
 * Busca em páginas de 1000 (limite padrão do Supabase) para nunca perder lançamentos.
 */
function linhas_do_periodo(string $tabela, string $colunaData, string $colunas, string $inicio, string $fim): array
{
    $todas = [];
    $pagina = 1000;
    for ($deslocamento = 0; $deslocamento < 20000; $deslocamento += $pagina) {
        $lote = supabase_db('GET', $tabela, [
            'query' => [
                'select' => $colunas,
                'and'    => '(' . $colunaData . '.gte.' . $inicio . ',' . $colunaData . '.lt.' . $fim . ')',
                'order'  => $colunaData . '.asc,id.asc',
                'limit'  => $pagina,
                'offset' => $deslocamento,
            ],
        ]);
        $todas = array_merge($todas, $lote);
        if (count($lote) < $pagina) {
            break;
        }
    }
    return $todas;
}

/** Limite mensal do usuário em centavos, ou null se não definiu. */
function limite_em_centavos(): ?int
{
    $linhas = supabase_db('GET', 'configuracoes', ['query' => ['select' => 'limite_mensal']]);
    $valor = $linhas[0]['limite_mensal'] ?? null;
    return $valor === null ? null : em_centavos($valor);
}

/**
 * Situação do limite: quanto foi usado, quanto resta e o nível do aviso.
 * nivel: "ok" (abaixo de 80%), "perto" (de 80% até o limite) ou "estourou" (passou do limite).
 */
function situacao_do_limite(?int $limite, int $usado): ?array
{
    if ($limite === null || $limite <= 0) {
        return null;
    }
    $nivel = 'ok';
    if ($usado > $limite) {
        $nivel = 'estourou';
    } elseif ($usado * 100 >= $limite * LIMITE_ALERTA_PERCENTUAL) {
        $nivel = 'perto';
    }
    return [
        'limite'     => em_reais($limite),
        'usado'      => em_reais($usado),
        'restante'   => em_reais($limite - $usado),   // negativo quando passou
        'percentual' => (int) floor($usado * 100 / $limite),
        'nivel'      => $nivel,
    ];
}

/** Soma de $linhas, separada por status: [total, do status "feito" (pago/recebida), do outro]. */
function somar_por_status(array $linhas, string $statusFeito): array
{
    $feito = 0;
    $aberto = 0;
    foreach ($linhas as $linha) {
        if (($linha['status'] ?? '') === $statusFeito) {
            $feito += em_centavos($linha['valor']);
        } else {
            $aberto += em_centavos($linha['valor']);
        }
    }
    return [$feito + $aberto, $feito, $aberto];
}

/** Linhas cuja $campo (AAAA-MM-DD) cai no mês $mes (AAAA-MM). */
function do_mes(array $linhas, string $campo, string $mes): array
{
    return array_values(array_filter($linhas, fn(array $l) => str_starts_with((string) $l[$campo], $mes . '-')));
}

/** Resumo de um mês a partir das linhas já filtradas do mês. */
function montar_resumo(string $mes, array $despesasDoMes, array $receitasDoMes, ?int $limite): array
{
    [$despTotal, $despPago, $despPendente] = somar_por_status($despesasDoMes, 'pago');
    [$recTotal, $recRecebido, $recAReceber] = somar_por_status($receitasDoMes, 'recebida');

    return [
        'mes'      => $mes,
        'receitas' => ['total' => em_reais($recTotal), 'recebido' => em_reais($recRecebido), 'a_receber' => em_reais($recAReceber)],
        'despesas' => ['total' => em_reais($despTotal), 'pago' => em_reais($despPago), 'pendente' => em_reais($despPendente)],
        'saldo'    => [
            'previsto' => em_reais($recTotal - $despTotal),        // tudo que entra - tudo que sai no mês
            'atual'    => em_reais($recRecebido - $despPago),      // só o que já aconteceu
        ],
        'limite'   => situacao_do_limite($limite, $despTotal),     // o limite olha o total de despesas do mês
    ];
}

/** Totais por tipo (do maior para o menor), com o nome do tipo e a participação no total. */
function totais_por_tipo(array $linhas, string $campoTipo, array $tipos): array
{
    $nomes = [];
    foreach ($tipos as $tipo) {
        $nomes[$tipo['id']] = $tipo['nome'];
    }

    $somas = [];
    $geral = 0;
    foreach ($linhas as $linha) {
        $id = (string) $linha[$campoTipo];
        $somas[$id] = ($somas[$id] ?? 0) + em_centavos($linha['valor']);
        $geral += em_centavos($linha['valor']);
    }
    arsort($somas);

    $saida = [];
    foreach ($somas as $id => $total) {
        $saida[] = [
            'tipo_id'    => $id,
            'nome'       => $nomes[$id] ?? 'Sem tipo',
            'total'      => em_reais($total),
            'percentual' => $geral > 0 ? round($total * 100 / $geral, 1) : 0,
        ];
    }
    return $saida;
}

/** Erro padrão quando as tabelas novas ainda não existem no banco. */
function erro_banco_sem_etapa5(SupabaseException $e): void
{
    if (in_array(pg_code($e), ['42P01', '42703', 'PGRST204', 'PGRST205'], true)) {
        json_error('O banco de dados precisa da atualização da etapa 5. Rode o script migracao_etapa5.sql no Supabase.', 500);
    }
}