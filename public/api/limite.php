<?php
declare(strict_types=1);

/**
 * Limite mensal de gastos (um só, vale para todos os meses).
 *
 *   GET    api/limite.php                 -> { limite: "5000.00" | null }
 *   PUT    api/limite.php   { limite }    -> define ou altera (valor em reais, maior que zero)
 *   DELETE api/limite.php                 -> remove o limite
 */

require_once __DIR__ . '/../../src/financas.php';

api(function () {
    $usuario = require_login();
    require_method('GET', 'PUT', 'DELETE');
    $metodo = $_SERVER['REQUEST_METHOD'];

    try {
        if ($metodo === 'PUT') {
            $limite = valor_param(request_json()['limite'] ?? null);
            $linhas = supabase_db('POST', 'configuracoes', [
                'query'   => ['on_conflict' => 'user_id', 'select' => 'limite_mensal'],
                'json'    => ['user_id' => $usuario['id'], 'limite_mensal' => $limite, 'atualizado_em' => gmdate('c')],
                'headers' => ['Prefer: return=representation,resolution=merge-duplicates'],
            ]);
            json_response(['ok' => true, 'limite' => em_reais(em_centavos($linhas[0]['limite_mensal']))]);
        }

        if ($metodo === 'DELETE') {
            supabase_db('DELETE', 'configuracoes', [
                'query' => ['user_id' => 'eq.' . $usuario['id'], 'select' => 'user_id'],
            ]);
            json_response(['ok' => true, 'limite' => null]);
        }

        $limite = limite_em_centavos();
        json_response(['ok' => true, 'limite' => $limite === null ? null : em_reais($limite)]);
    } catch (SupabaseException $e) {
        erro_banco_sem_etapa5($e);
        throw $e;
    }
});