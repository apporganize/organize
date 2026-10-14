<?php
declare(strict_types=1);

/**
 * Tipos de despesa.
 *
 *   GET    api/tipos.php                 -> lista
 *   POST   api/tipos.php                 -> cria { nome, so_vencimento? }
 *   POST   api/tipos.php?acao=sugeridos  -> cria os tipos sugeridos que ainda não existem
 *   PUT    api/tipos.php?id=UUID         -> altera { nome, so_vencimento? }
 *
 * Tipos de RECEITA (Salário, Freelance...): as mesmas chamadas com ?de=receita (ex.: GET api/tipos.php?de=receita).
 * Eles não têm so_vencimento.
 *
 * so_vencimento = true marca o tipo como "conta com vencimento" (aluguel, água, luz...):
 * as despesas desse tipo não têm data da compra, só o vencimento.
 *   DELETE api/tipos.php?id=UUID         -> exclui (bloqueado se houver despesas com o tipo)
 */

require_once __DIR__ . '/../../src/helpers.php';

const NOME_MAX = 60;
const COLUNAS  = 'id,nome,so_vencimento';
const COLUNAS_RECEITA = 'id,nome';
// [nome, é conta com vencimento?]
const SUGERIDOS = [
    ['Alimentação', false], ['Moradia', false], ['Transporte', false], ['Saúde', false],
    ['Lazer', false], ['Educação', false], ['Outros', false],
    ['Aluguel', true], ['Água', true], ['Luz', true], ['Internet', true], ['Condomínio', true],
];

function nome_do_tipo(): string
{
    return required_text(
        request_json(),
        'nome',
        NOME_MAX,
        'Informe o nome do tipo.',
        'O nome do tipo deve ter no máximo ' . NOME_MAX . ' caracteres.'
    );
}

const SUGERIDOS_RECEITA = ['Salário', 'Freelance', 'Investimentos', 'Reembolso', 'Outros'];

/** Campo so_vencimento do corpo: ausente -> null (não mexe); precisa ser verdadeiro/falso. */
function so_vencimento_do_corpo(): ?bool
{
    $dados = request_json();
    if (!array_key_exists('so_vencimento', $dados)) {
        return null;
    }
    if (!is_bool($dados['so_vencimento'])) {
        json_error('Valor inválido para "conta com vencimento".', 422);
    }
    return $dados['so_vencimento'];
}

api(function () {
    require_login();
    require_method('GET', 'POST', 'PUT', 'DELETE');
    $metodo = $_SERVER['REQUEST_METHOD'];

    $receita = ($_GET['de'] ?? '') === 'receita';
    $tabela  = $receita ? 'tipos_receita' : 'tipos_despesa';
    $colunas = $receita ? COLUNAS_RECEITA : COLUNAS;

    try {
        if ($metodo === 'GET') {
            $tipos = supabase_db('GET', $tabela, [
                'query' => ['select' => $colunas, 'order' => 'nome.asc'],
            ]);
            json_response(['ok' => true, 'tipos' => $tipos]);
        }

        if ($metodo === 'POST' && ($_GET['acao'] ?? '') === 'sugeridos') {
            $linhas = $receita
                ? array_map(fn(string $nome) => ['nome' => $nome], SUGERIDOS_RECEITA)
                : array_map(fn(array $t) => ['nome' => $t[0], 'so_vencimento' => $t[1]], SUGERIDOS);
            $criados = supabase_db('POST', $tabela, [
                'query'   => ['on_conflict' => 'user_id,nome', 'select' => $colunas],
                'json'    => $linhas,
                'headers' => ['Prefer: return=representation,resolution=ignore-duplicates'],
            ]);
            json_response(['ok' => true, 'criados' => count($criados)], 201);
        }

        if ($metodo === 'POST') {
            $linhas = supabase_db('POST', $tabela, [
                'query' => ['select' => $colunas],
                'json'  => $receita
                    ? ['nome' => nome_do_tipo()]
                    : ['nome' => nome_do_tipo(), 'so_vencimento' => so_vencimento_do_corpo() ?? false],
            ]);
            json_response(['ok' => true, 'tipo' => $linhas[0]], 201);
        }

        if ($metodo === 'PUT') {
            $id = uuid_param();
            $alteracoes = ['nome' => nome_do_tipo()];
            $contaComVencimento = $receita ? null : so_vencimento_do_corpo();
            if ($contaComVencimento !== null) {
                $alteracoes['so_vencimento'] = $contaComVencimento;
            }
            $linhas = supabase_db('PATCH', $tabela, [
                'query' => ['id' => 'eq.' . $id, 'select' => $colunas],
                'json'  => $alteracoes,
            ]);
            if (!$linhas) {
                json_error('Tipo não encontrado.', 404);
            }
            json_response(['ok' => true, 'tipo' => $linhas[0]]);
        }

        // DELETE
        $id = uuid_param();
        $linhas = supabase_db('DELETE', $tabela, [
            'query' => ['id' => 'eq.' . $id, 'select' => 'id'],
        ]);
        if (!$linhas) {
            json_error('Tipo não encontrado.', 404);
        }
        json_response(['ok' => true]);
    } catch (SupabaseException $e) {
        $codigo = pg_code($e);
        if ($codigo === '23505') {
            json_error('Já existe um tipo com esse nome.', 409);
        }
        if ($codigo === '23503') {
            json_error(
                'Este tipo está em uso por ' . ($receita ? 'receitas' : 'despesas') . ' e não pode ser excluído.',
                409
            );
        }
        // banco ainda sem a coluna nova (migração não rodada)
        if ($codigo === '42703' || $codigo === 'PGRST204') {
            json_error('O banco de dados precisa da atualização. Rode o script ' . ($receita ? 'migracao_etapa5.sql' : 'migracao_etapa4b.sql') . ' no Supabase.', 500);
        }
        throw $e;
    }
});