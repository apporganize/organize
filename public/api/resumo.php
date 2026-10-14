<?php
declare(strict_types=1);

/**
 * Resumo de um mês: receitas, despesas, saldo e situação do limite.
 *
 *   GET api/resumo.php?mes=AAAA-MM
 *
 * Despesas contam pelo VENCIMENTO e receitas pela data em que ENTRAM, como nas listas.
 */

require_once __DIR__ . '/../../src/financas.php';

api(function () {
    require_login();
    require_method('GET');

    [$inicio, $fim] = intervalo_do_mes();
    $mes = substr($inicio, 0, 7);

    try {
        $despesas = linhas_do_periodo('despesas', 'data_vencimento', 'valor,status,data_vencimento', $inicio, $fim);
        $receitas = linhas_do_periodo('receitas', 'data_recebimento', 'valor,status,data_recebimento', $inicio, $fim);
        $resumo = montar_resumo($mes, $despesas, $receitas, limite_em_centavos());
    } catch (SupabaseException $e) {
        erro_banco_sem_etapa5($e);
        throw $e;
    }

    json_response(['ok' => true] + $resumo);
});