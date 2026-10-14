# organize!

App web de controle de finanças pessoais. PHP + AJAX (fetch), HTML, CSS e JS puro, com banco no Supabase.

## Requisitos

- PHP 8.0 ou superior, com as extensões **cURL** e **mbstring** habilitadas
- Um projeto no [Supabase](https://supabase.com)
- Git

## Configuração do Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor → New query**, cole o conteúdo de `sql/schema.sql` e clique em **Run**.
   - Se você já tinha rodado o `schema.sql` antes da etapa 4, **não rode o `schema.sql` de novo**. Rode, nesta ordem, `sql/migracao_etapa4.sql` e `sql/migracao_etapa4b.sql` (podem rodar mais de uma vez sem problema).
3. Vá em **Authentication → Providers → Email** e desligue **Confirm email** (para testar sem precisar confirmar o e-mail).
4. Vá em **Project Settings → API** e copie a **Project URL** e a chave pública (**anon** ou **publishable**).
   - Nunca use a chave `service_role` / `secret` neste projeto.

## Rodando localmente

```bash
cp .env.example .env        # no Windows: copy .env.example .env
# edite o .env com a URL e a chave do seu projeto

php -S localhost:8000 -t public
```

Teste a conexão em: <http://localhost:8000/api/ping.php>

Resposta esperada: `"curl": true`, `"mbstring": true`, as duas variáveis do `env` como `true` e `"supabase_alcancavel": true`.

## Subindo para o GitHub

```bash
git init
git add .
git status                  # confira que o .env NÃO aparece na lista
git commit -m "Estrutura inicial do organize!"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/organize.git
git push -u origin main
```

O `.env` está no `.gitignore`: suas chaves não sobem para o GitHub. Quem clonar o projeto usa o `.env.example` como modelo.

## Estrutura

```
organize/
├── public/              → raiz web (php -S ... -t public)
│   ├── api/             → endpoints PHP (JSON)
│   ├── css/
│   └── js/
├── src/
│   ├── config.php       → .env, constantes e sessão
│   ├── supabase.php     → cliente Supabase (Auth + REST)
│   └── helpers.php      → respostas JSON, validação, tratamento de erros
├── sql/schema.sql       → tabelas, regras e políticas RLS (instalação nova)
├── sql/migracao_etapa4.sql → atualiza um banco já existente (vencimento, parcelas, recorrência)
├── sql/migracao_etapa4b.sql → atualiza um banco já existente (tipos "conta com vencimento")
├── .env.example
└── .gitignore
```

## Como a segurança funciona

- O login é feito pelo **Supabase Auth**; as senhas nunca passam por tabela própria.
- Os tokens do usuário ficam na **sessão PHP** (servidor). O JavaScript não os recebe.
- Toda consulta usa o token do usuário e o **RLS** do Supabase garante que cada pessoa só acessa os próprios dados.
- Requisições que alteram dados exigem o header `X-Requested-With: XMLHttpRequest`.
- Cartões guardam apenas o nome e os 4 últimos dígitos.

## Instalar no celular (PWA)

- **Android (Chrome):** botão **Instalar app** no topo, ou menu ⋮ > *Instalar app*.
- **iPhone (Safari):** Compartilhar > *Adicionar à Tela de Início*.
- A instalação exige **HTTPS**. Em `localhost` funciona para testes; para usar no celular, publique em uma hospedagem com PHP e HTTPS (o GitHub guarda só o código, não executa PHP).

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `Extensões do PHP não habilitadas` | No `php.ini`, remova o `;` de `extension=curl` e `extension=mbstring` e reinicie o servidor |
| Erro de certificado SSL (Windows) | Baixe o `cacert.pem` e informe o caminho em `CURL_CA_BUNDLE` no `.env` |
| `Configuração do Supabase ausente` | Confira se o arquivo `.env` existe e está preenchido |
| `permission denied for table ...` | No SQL Editor, rode: `grant select, insert, update, delete on public.tipos_despesa, public.cartoes, public.despesas to authenticated; grant select, update on public.perfis to authenticated;` |

## Etapas do MVP

- [x] Banco de dados e estrutura base do projeto
- [x] Login e cadastro de usuário
- [x] Tipos de despesa
- [x] Cartões de crédito
- [x] App instalável no celular (PWA) e layout responsivo
- [x] Tela principal de lançamento de despesas (data da compra + vencimento, parcelamento no crédito, despesa que se repete todo mês, tipos "conta com vencimento" para aluguel, água e luz)