<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

/**
 * Cliente mínimo do Supabase (Auth + REST/PostgREST) usando cURL.
 *
 * Os tokens do usuário ficam SOMENTE na sessão PHP (servidor); o JavaScript
 * nunca os vê. Todas as consultas usam o token do usuário logado, então o RLS
 * do banco garante que cada pessoa só acessa os próprios dados.
 */

final class SupabaseException extends RuntimeException
{
    public function __construct(
        string $message,
        public int $status = 500,
        public mixed $details = null
    ) {
        parent::__construct($message);
    }
}

/**
 * Chamada HTTP crua. Retorna ['status' => int, 'body' => mixed].
 *
 * $options: query (array|string), json (array), token (string), headers (string[])
 */
function supabase_request(string $method, string $path, array $options = []): array
{
    if (SUPABASE_URL === '' || SUPABASE_ANON_KEY === '') {
        throw new SupabaseException('Configuração do Supabase ausente. Preencha o arquivo .env.', 500);
    }

    $url = SUPABASE_URL . $path;
    if (!empty($options['query'])) {
        $query = is_array($options['query'])
            ? http_build_query($options['query'], '', '&', PHP_QUERY_RFC3986)
            : (string) $options['query'];
        $url .= '?' . $query;
    }

    // Chaves "publishable" não são JWT: nesse caso vai só no header apikey.
    $bearer = $options['token'] ?? (str_starts_with(SUPABASE_ANON_KEY, 'eyJ') ? SUPABASE_ANON_KEY : null);

    $headers = ['apikey: ' . SUPABASE_ANON_KEY, 'Accept: application/json'];
    if ($bearer !== null) {
        $headers[] = 'Authorization: Bearer ' . $bearer;
    }
    if (array_key_exists('json', $options)) {
        $headers[] = 'Content-Type: application/json';
    }
    foreach ($options['headers'] ?? [] as $header) {
        $headers[] = $header;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT        => 20,
    ]);
    if (array_key_exists('json', $options)) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($options['json'], JSON_UNESCAPED_UNICODE));
    }
    $caBundle = env('CURL_CA_BUNDLE');
    if ($caBundle !== null) {
        curl_setopt($ch, CURLOPT_CAINFO, $caBundle);
    }

    $raw = curl_exec($ch);
    if ($raw === false) {
        throw new SupabaseException('Não foi possível conectar ao Supabase: ' . curl_error($ch), 502);
    }

    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $body = null;
    if ($raw !== '') {
        $decoded = json_decode($raw, true);
        $body = json_last_error() === JSON_ERROR_NONE ? $decoded : $raw;
    }

    return ['status' => $status, 'body' => $body];
}

/* ------------------------------------------------------------------
 * Autenticação (Supabase Auth)
 * ---------------------------------------------------------------- */

function auth_http_status(array $res): int
{
    return ($res['status'] >= 400 && $res['status'] < 500) ? $res['status'] : 502;
}

function auth_error_message(array $res): string
{
    $body = is_array($res['body']) ? $res['body'] : [];
    $code = (string) ($body['error_code'] ?? $body['code'] ?? '');

    return match ($code) {
        'invalid_credentials'                              => 'E-mail ou senha inválidos.',
        'user_already_exists', 'email_exists'              => 'Já existe uma conta com esse e-mail.',
        'weak_password'                                    => 'Senha fraca. Use pelo menos 6 caracteres.',
        'email_not_confirmed'                              => 'Confirme seu e-mail antes de entrar.',
        'over_request_rate_limit',
        'over_email_send_rate_limit'                       => 'Muitas tentativas. Aguarde um pouco e tente de novo.',
        'validation_failed', 'email_address_invalid'       => 'E-mail ou senha em formato inválido.',
        default                                            => 'Não foi possível concluir. Tente novamente.',
    };
}

function auth_store_session(array $data): void
{
    $user = $data['user'] ?? [];
    $_SESSION['sb'] = [
        'access_token'  => $data['access_token'],
        'refresh_token' => $data['refresh_token'],
        'expires_at'    => time() + (int) ($data['expires_in'] ?? 3600),
        'user'          => [
            'id'    => $user['id'] ?? null,
            'email' => $user['email'] ?? null,
            'nome'  => $user['user_metadata']['nome'] ?? null,
        ],
    ];
}

/** Cria a conta. Retorna ['logado' => bool, 'confirmar_email' => bool]. */
function auth_signup(string $nome, string $email, string $senha): array
{
    $res = supabase_request('POST', '/auth/v1/signup', [
        'json' => ['email' => $email, 'password' => $senha, 'data' => ['nome' => $nome]],
    ]);

    if ($res['status'] >= 400) {
        throw new SupabaseException(auth_error_message($res), auth_http_status($res));
    }

    // Com "Confirm email" desligado, o Supabase já devolve a sessão.
    if (is_array($res['body']) && isset($res['body']['access_token'])) {
        session_regenerate_id(true);
        auth_store_session($res['body']);
        return ['logado' => true, 'confirmar_email' => false];
    }

    return ['logado' => false, 'confirmar_email' => true];
}

function auth_login(string $email, string $senha): void
{
    $res = supabase_request('POST', '/auth/v1/token', [
        'query' => ['grant_type' => 'password'],
        'json'  => ['email' => $email, 'password' => $senha],
    ]);

    if ($res['status'] >= 400 || !isset($res['body']['access_token'])) {
        $status = $res['status'] === 400 ? 401 : auth_http_status($res);
        throw new SupabaseException(auth_error_message($res), $status);
    }

    session_regenerate_id(true);
    auth_store_session($res['body']);
}

function auth_refresh(): bool
{
    $refreshToken = $_SESSION['sb']['refresh_token'] ?? null;
    if ($refreshToken === null) {
        return false;
    }

    $res = supabase_request('POST', '/auth/v1/token', [
        'query' => ['grant_type' => 'refresh_token'],
        'json'  => ['refresh_token' => $refreshToken],
    ]);

    if ($res['status'] >= 400 || !isset($res['body']['access_token'])) {
        unset($_SESSION['sb']);
        return false;
    }

    $anterior = $_SESSION['sb']['user'] ?? [];
    auth_store_session($res['body']);
    $_SESSION['sb']['user'] = array_filter($_SESSION['sb']['user'], fn($v) => $v !== null) + $anterior;
    return true;
}

/** Usuário logado (renova o token se estiver perto de expirar) ou null. */
function auth_user(): ?array
{
    $sessao = $_SESSION['sb'] ?? null;
    if ($sessao === null) {
        return null;
    }
    if (($sessao['expires_at'] ?? 0) - time() < 60 && !auth_refresh()) {
        return null;
    }
    return $_SESSION['sb']['user'] ?? null;
}

function auth_logout(): void
{
    $token = $_SESSION['sb']['access_token'] ?? null;
    if ($token !== null) {
        try {
            // scope=local encerra só esta sessão, não as de outros dispositivos
            supabase_request('POST', '/auth/v1/logout', ['token' => $token, 'query' => ['scope' => 'local']]);
        } catch (Throwable) {
            // mesmo que falhe, a sessão local é destruída abaixo
        }
    }

    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 42000,
            'path'     => $p['path'],
            'domain'   => $p['domain'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'] ?: 'Lax',
        ]);
    }
    session_destroy();
}

/* ------------------------------------------------------------------
 * Banco de dados (PostgREST) — sempre com o token do usuário logado
 * ---------------------------------------------------------------- */

function db_error_message(array $res): string
{
    $body = is_array($res['body']) ? $res['body'] : [];

    return match ((string) ($body['code'] ?? '')) {
        '23503' => 'Este registro está em uso por outros dados e não pode ser alterado ou excluído.',
        '23505' => 'Já existe um registro com esses dados.',
        '23514' => 'Dados inválidos. Revise os campos informados.',
        '23502' => 'Preencha todos os campos obrigatórios.',
        '22P02' => 'Valor em formato inválido.',
        '42501' => 'Sem permissão para esta operação.',
        default => 'Erro ao acessar o banco de dados.',
    };
}

/**
 * Executa uma operação em uma tabela. Ex.:
 *   supabase_db('GET',  'despesas', ['query' => ['select' => '*', 'order' => 'data_despesa.desc']]);
 *   supabase_db('POST', 'cartoes',  ['json' => ['nome' => 'Nubank', 'ultimos_4_digitos' => '1234']]);
 */
function supabase_db(string $method, string $table, array $options = []): mixed
{
    if (auth_user() === null) {
        throw new SupabaseException('Sessão expirada. Faça login novamente.', 401);
    }

    $method = strtoupper($method);

    // Por padrão, escritas devolvem as linhas afetadas (assim dá para saber se algo foi criado,
    // alterado ou excluído). Quem precisar de outro "Prefer" informa o próprio header.
    $temPrefer = false;
    foreach ($options['headers'] ?? [] as $header) {
        if (stripos($header, 'Prefer:') === 0) {
            $temPrefer = true;
        }
    }
    if (!$temPrefer && in_array($method, ['POST', 'PATCH', 'DELETE'], true)) {
        $options['headers'][] = 'Prefer: return=representation';
    }

    for ($tentativa = 0; $tentativa < 2; $tentativa++) {
        $options['token'] = $_SESSION['sb']['access_token'];
        $res = supabase_request($method, '/rest/v1/' . $table, $options);

        if ($res['status'] === 401 && $tentativa === 0 && auth_refresh()) {
            continue;
        }
        break;
    }

    if ($res['status'] === 401) {
        throw new SupabaseException('Sessão expirada. Faça login novamente.', 401);
    }
    if ($res['status'] >= 400) {
        throw new SupabaseException(
            db_error_message($res),
            $res['status'] < 500 ? $res['status'] : 502,
            $res['body']
        );
    }

    return $res['body'];
}