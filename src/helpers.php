<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/supabase.php';

/** Envia a resposta JSON e encerra o script (nunca retorna). */
function json_response(mixed $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Envia um erro JSON padronizado e encerra o script (nunca retorna). */
function json_error(string $message, int $status = 400, array $extra = []): void
{
    json_response(['ok' => false, 'erro' => $message] + $extra, $status);
}

function require_method(string ...$allowed): void
{
    if (!in_array($_SERVER['REQUEST_METHOD'], $allowed, true)) {
        header('Allow: ' . implode(', ', $allowed));
        json_error('Método não permitido.', 405);
    }
}

/** Lê o corpo JSON da requisição (retorna [] se vazio). */
function request_json(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json_error('Corpo da requisição inválido (JSON esperado).', 400);
    }
    return $data;
}

/** Lê um campo de texto, aparado e limitado em tamanho. */
function str_field(array $data, string $key, int $max = 255): string
{
    $value = $data[$key] ?? '';
    return is_string($value) ? mb_substr(trim($value), 0, $max) : '';
}

/** Lê um texto obrigatório: erro 422 (com a mensagem informada) se vier vazio ou maior que $max. */
function required_text(array $data, string $key, int $max, string $msgVazio, string $msgLongo): string
{
    $value = $data[$key] ?? '';
    $value = is_string($value) ? trim($value) : '';
    if ($value === '') {
        json_error($msgVazio, 422);
    }
    if (mb_strlen($value) > $max) {
        json_error($msgLongo, 422);
    }
    return $value;
}

/** Lê o parâmetro ?id= da URL e confirma que é um UUID (impede injetar filtros na consulta). */
function uuid_param(string $key = 'id'): string
{
    $value = $_GET[$key] ?? '';
    $formato = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';
    if (!is_string($value) || !preg_match($formato, $value)) {
        json_error('Identificador inválido.', 422);
    }
    return strtolower($value);
}

/** Código de erro do Postgres numa SupabaseException (23505 = duplicado, 23503 = em uso). */
function pg_code(SupabaseException $e): string
{
    return is_array($e->details) ? (string) ($e->details['code'] ?? '') : '';
}

/** Exige usuário logado. Retorna ['id', 'email', 'nome']. */
function require_login(): array
{
    $user = auth_user();
    if ($user === null) {
        json_error('Sessão expirada. Faça login novamente.', 401);
    }
    return $user;
}

/**
 * Envolve todo endpoint: define os headers JSON, exige o header AJAX nas
 * requisições que alteram dados (proteção básica contra CSRF) e padroniza erros.
 */
function api(callable $handler): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');

    try {
        if ($_SERVER['REQUEST_METHOD'] !== 'GET'
            && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'XMLHttpRequest') {
            json_error('Requisição não permitida.', 403);
        }
        $handler();
    } catch (SupabaseException $e) {
        $extra = (APP_ENV === 'local' && $e->details !== null) ? ['detalhes' => $e->details] : [];
        json_error($e->getMessage(), ($e->status >= 400 && $e->status < 600) ? $e->status : 500, $extra);
    } catch (Throwable $e) {
        error_log('[organize] ' . $e->getMessage() . ' em ' . $e->getFile() . ':' . $e->getLine());
        json_error(APP_ENV === 'local' ? $e->getMessage() : 'Erro interno. Tente novamente.', 500);
    }
}