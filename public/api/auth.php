<?php
declare(strict_types=1);

/**
 * Autenticação.
 *
 *   GET  api/auth.php?acao=me         -> usuário logado (401 se não houver sessão)
 *   POST api/auth.php?acao=cadastrar  -> { nome, email, senha }
 *   POST api/auth.php?acao=entrar     -> { email, senha }
 *   POST api/auth.php?acao=sair
 */

require_once __DIR__ . '/../../src/helpers.php';

const SENHA_MIN = 8;
const SENHA_MAX = 72; // limite do bcrypt, usado pelo Supabase

/** Só devolve ao navegador o que a tela precisa (nunca tokens nem id). */
function usuario_publico(array $usuario): array
{
    $email = (string) ($usuario['email'] ?? '');
    $nome  = trim((string) ($usuario['nome'] ?? ''));
    if ($nome === '') {
        $nome = explode('@', $email)[0];
    }
    return ['nome' => $nome, 'email' => $email];
}

function campo_senha(array $dados): string
{
    return is_string($dados['senha'] ?? null) ? $dados['senha'] : '';
}

api(function () {
    $acao = (string) ($_GET['acao'] ?? '');

    if ($acao === 'me') {
        require_method('GET');
        $usuario = auth_user();
        if ($usuario === null) {
            // Login e cadastro só perguntam "já existe sessão?": responde 200 para não gerar erro no console.
            if (($_GET['opcional'] ?? '') === '1') {
                json_response(['ok' => true, 'usuario' => null]);
            }
            json_error('Sessão expirada. Faça login novamente.', 401);
        }
        json_response(['ok' => true, 'usuario' => usuario_publico($usuario)]);
    }

    if ($acao === 'cadastrar') {
        require_method('POST');
        $dados = request_json();
        $nome  = str_field($dados, 'nome', 80);
        $email = strtolower(str_field($dados, 'email', 254));
        $senha = campo_senha($dados);

        if ($nome === '') {
            json_error('Informe seu nome.', 422);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_error('Informe um e-mail válido.', 422);
        }
        if (mb_strlen($senha) < SENHA_MIN) {
            json_error('A senha deve ter pelo menos ' . SENHA_MIN . ' caracteres.', 422);
        }
        if (strlen($senha) > SENHA_MAX) {
            json_error('A senha deve ter no máximo ' . SENHA_MAX . ' caracteres.', 422);
        }

        $resultado = auth_signup($nome, $email, $senha);
        $resposta  = ['ok' => true] + $resultado;
        if ($resultado['logado']) {
            $resposta['usuario'] = usuario_publico(auth_user() ?? []);
        }
        json_response($resposta, 201);
    }

    if ($acao === 'entrar') {
        require_method('POST');
        $dados = request_json();
        $email = strtolower(str_field($dados, 'email', 254));
        $senha = campo_senha($dados);

        if ($email === '' || $senha === '') {
            json_error('Informe seu e-mail e sua senha.', 422);
        }

        auth_login($email, $senha);
        json_response(['ok' => true, 'usuario' => usuario_publico(auth_user() ?? [])]);
    }

    if ($acao === 'sair') {
        require_method('POST');
        auth_logout();
        json_response(['ok' => true]);
    }

    json_error('Ação inválida.', 404);
});