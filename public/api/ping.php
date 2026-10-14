<?php
declare(strict_types=1);

/**
 * Diagnóstico local: confirma PHP, cURL, .env e conexão com o Supabase.
 * Acesse: http://localhost:8000/api/ping.php
 * Só funciona com APP_ENV=local.
 */

require_once __DIR__ . '/../../src/helpers.php';

api(function () {
    require_method('GET');

    if (APP_ENV !== 'local') {
        json_error('Não encontrado.', 404);
    }

    $out = [
        'ok'     => true,
        'php'    => PHP_VERSION,
        'curl'     => extension_loaded('curl'),
        'mbstring' => extension_loaded('mbstring'),
        'env'      => [
            'SUPABASE_URL'      => SUPABASE_URL !== '',
            'SUPABASE_ANON_KEY' => SUPABASE_ANON_KEY !== '',
        ],
        'logado' => auth_user() !== null,
    ];

    $faltando = array_values(array_filter(['curl', 'mbstring'], fn($ext) => !extension_loaded($ext)));
    if ($faltando) {
        json_error(
            'Extensões do PHP não habilitadas (php.ini): ' . implode(', ', $faltando),
            500,
            ['diagnostico' => $out]
        );
    }

    if ($out['env']['SUPABASE_URL'] && $out['env']['SUPABASE_ANON_KEY']) {
        $res = supabase_request('GET', '/auth/v1/health');
        $out['supabase_http']      = $res['status'];
        $out['supabase_alcancavel'] = $res['status'] === 200;
    }

    json_response($out);
});
