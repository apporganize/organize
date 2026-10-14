<?php
declare(strict_types=1);

/**
 * Cartões de crédito (somente nome e 4 últimos dígitos; o número completo nunca é pedido nem guardado).
 *
 *   GET    api/cartoes.php          -> lista
 *   POST   api/cartoes.php          -> cria { nome, ultimos_4_digitos }
 *   PUT    api/cartoes.php?id=UUID  -> altera { nome, ultimos_4_digitos }
 *   DELETE api/cartoes.php?id=UUID  -> exclui (bloqueado se houver despesas no cartão)
 */

require_once __DIR__ . '/../../src/helpers.php';

const NOME_MAX = 40;
const COLUNAS  = 'id,nome,ultimos_4_digitos';

/** Valida o corpo da requisição e devolve as colunas prontas para gravar. */
function dados_do_cartao(): array
{
    $dados = request_json();

    $nome = required_text(
        $dados,
        'nome',
        NOME_MAX,
        'Informe o nome do cartão.',
        'O nome do cartão deve ter no máximo ' . NOME_MAX . ' caracteres.'
    );

    $final = $dados['ultimos_4_digitos'] ?? '';
    $final = is_string($final) ? trim($final) : '';
    if (!preg_match('/^[0-9]{4}$/', $final)) {
        json_error('Informe somente os 4 últimos dígitos do cartão (apenas números).', 422);
    }

    return ['nome' => $nome, 'ultimos_4_digitos' => $final];
}

api(function () {
    require_login();
    require_method('GET', 'POST', 'PUT', 'DELETE');
    $metodo = $_SERVER['REQUEST_METHOD'];

    try {
        if ($metodo === 'GET') {
            $cartoes = supabase_db('GET', 'cartoes', [
                'query' => ['select' => COLUNAS, 'order' => 'nome.asc'],
            ]);
            json_response(['ok' => true, 'cartoes' => $cartoes]);
        }

        if ($metodo === 'POST') {
            $linhas = supabase_db('POST', 'cartoes', [
                'query' => ['select' => COLUNAS],
                'json'  => dados_do_cartao(),
            ]);
            json_response(['ok' => true, 'cartao' => $linhas[0]], 201);
        }

        if ($metodo === 'PUT') {
            $id = uuid_param();
            $linhas = supabase_db('PATCH', 'cartoes', [
                'query' => ['id' => 'eq.' . $id, 'select' => COLUNAS],
                'json'  => dados_do_cartao(),
            ]);
            if (!$linhas) {
                json_error('Cartão não encontrado.', 404);
            }
            json_response(['ok' => true, 'cartao' => $linhas[0]]);
        }

        // DELETE
        $id = uuid_param();
        $linhas = supabase_db('DELETE', 'cartoes', [
            'query' => ['id' => 'eq.' . $id, 'select' => 'id'],
        ]);
        if (!$linhas) {
            json_error('Cartão não encontrado.', 404);
        }
        json_response(['ok' => true]);
    } catch (SupabaseException $e) {
        if (pg_code($e) === '23503') {
            json_error('Este cartão está em uso por despesas e não pode ser excluído.', 409);
        }
        throw $e;
    }
});