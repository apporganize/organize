<?php
declare(strict_types=1);

/**
 * Dados do painel: receitas x despesas dos últimos meses e totais por tipo do mês escolhido.
 *
 *   GET api/painel.php?mes=AAAA-MM[&meses=6]
 *
 * "meses" (1 a 12, padrão 6) é quantos meses o gráfico mostra, terminando em "mes".
 * Despesas contam pelo vencimento; receitas, pela data em que entram.
 */

require_once __DIR__ . '/../../src/financas.php';

const MESES_PADRAO = 6;
const MESES_MAXIMO = 12;

api(function () {
    require_login();
    require_method('GET');

    [$inicioDoMes, $fimDoMes] = intervalo_do_mes();
    $mes = substr($inicioDoMes, 0, 7);

    $quantos = $_GET['meses'] ?? (string) MESES_PADRAO;
    if (!is_string($quantos) || !preg_match('/^\d{1,2}$/', $quantos) || (int) $quantos < 1 || (int) $quantos > MESES_MAXIMO) {
        json_error('Informe de 1 a ' . MESES_MAXIMO . ' meses.', 422);
    }
    $quantos = (int) $quantos;

    $inicioDoPeriodo = primeiro_dia_do_mes($mes, -($quantos - 1));

    try {
        $despesas = linhas_do_periodo('despesas', 'data_vencimento', 'valor,status,data_vencimento,tipo_id', $inicioDoPeriodo, $fimDoMes);
        $receitas = linhas_do_periodo('receitas', 'data_recebimento', 'valor,status,data_recebimento,tipo_receita_id', $inicioDoPeriodo, $fimDoMes);
        $tiposDespesa = supabase_db('GET', 'tipos_despesa', ['query' => ['select' => 'id,nome']]);
        $tiposReceita = supabase_db('GET', 'tipos_receita', ['query' => ['select' => 'id,nome']]);
        $limite = limite_em_centavos();
    } catch (SupabaseException $e) {
        erro_banco_sem_etapa5($e);
        throw $e;
    }

    $serie = [];
    for ($i = $quantos - 1; $i >= 0; $i--) {
        $m = substr(primeiro_dia_do_mes($mes, -$i), 0, 7);
        [$recTotal] = somar_por_status(do_mes($receitas, 'data_recebimento', $m), 'recebida');
        [$despTotal] = somar_por_status(do_mes($despesas, 'data_vencimento', $m), 'pago');
        $serie[] = [
            'mes'      => $m,
            'receitas' => em_reais($recTotal),
            'despesas' => em_reais($despTotal),
            'saldo'    => em_reais($recTotal - $despTotal),
        ];
    }

    $despesasDoMes = do_mes($despesas, 'data_vencimento', $mes);
    $receitasDoMes = do_mes($receitas, 'data_recebimento', $mes);

    json_response([
        'ok'      => true,
        'resumo'  => montar_resumo($mes, $despesasDoMes, $receitasDoMes, $limite),
        'meses'   => $serie,
        'por_tipo' => [
            'despesas' => totais_por_tipo($despesasDoMes, 'tipo_id', $tiposDespesa),
            'receitas' => totais_por_tipo($receitasDoMes, 'tipo_receita_id', $tiposReceita),
        ],
    ]);
});