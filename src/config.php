<?php
declare(strict_types=1);

/**
 * Configuração básica: lê o .env, define constantes e inicia a sessão.
 */

define('ROOT_DIR', dirname(__DIR__));

function load_env(string $path): void
{
    if (!is_file($path)) {
        return;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
            $value = substr($value, 1, -1);
        }
        $_ENV[$key] = $value;
    }
}

function env(string $key, ?string $default = null): ?string
{
    $value = $_ENV[$key] ?? getenv($key);
    return ($value !== false && $value !== null && $value !== '') ? (string) $value : $default;
}

load_env(ROOT_DIR . '/.env');

define('SUPABASE_URL', rtrim((string) env('SUPABASE_URL', ''), '/'));
define('SUPABASE_ANON_KEY', (string) env('SUPABASE_ANON_KEY', ''));
define('APP_ENV', (string) env('APP_ENV', 'local'));

if (session_status() === PHP_SESSION_NONE) {
    session_name('organize_sid');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => !empty($_SERVER['HTTPS']),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}
