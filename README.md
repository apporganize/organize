# organize!

App web de controle de finanças pessoais, instalável no celular (PWA). HTML, CSS e JavaScript puro, com login e banco no
[Supabase](https://supabase.com). **Não tem servidor próprio**: o app roda inteiro no navegador e é publicado de graça
no GitHub Pages.

## Como funciona

```
navegador (HTML + JS)  ──►  Supabase (login + banco, com segurança por linha / RLS)
        ▲
GitHub Pages (só entrega os arquivos da pasta public/)
```

## Publicar no GitHub Pages (passo a passo)

1. **Banco de dados (Supabase).** Em **SQL Editor → New query**, rode `sql/schema.sql` (instalação nova).
   - Banco já existente: **não rode o `schema.sql` de novo**; rode, nesta ordem, só o que faltar entre
     `sql/migracao_etapa4.sql`, `sql/migracao_etapa4b.sql`, `sql/migracao_etapa5.sql`, `sql/migracao_etapa6.sql` e `sql/migracao_etapa7.sql`.
2. **Login.** Em **Authentication → Providers → Email**, deixe **Confirm email** desligado (para entrar logo após o cadastro).
3. **Configure o app.** Edite `public/js/config.js` com a **Project URL** e a chave **pública** (*anon public* ou *publishable*)
   de **Project Settings → API**. Nunca use a chave `service_role` / `secret` (o app se recusa a funcionar com ela).
4. **Suba para o GitHub** (a publicação é automática pelo workflow `.github/workflows/pages.yml`):
   ```bash
   git add .
   git commit -m "organize! no GitHub Pages"
   git push
   ```
5. **Ligue o Pages.** No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   (O GitHub Pages gratuito exige repositório **público**.) Acompanhe em **Actions**; ao terminar, o endereço será
   `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.
6. **Diga ao Supabase qual é o endereço.** Em **Authentication → URL Configuration**, coloque o endereço acima em
   **Site URL** (e também em **Redirect URLs**).
7. Abra o endereço no celular, crie sua conta e instale o app (veja abaixo). Cada pessoa cria a própria conta e só enxerga os próprios dados.

### É seguro deixar o repositório público?

Sim. No repositório só existe a **chave pública** do Supabase, feita para ficar à vista no navegador. Quem protege os dados é a
**segurança por linha (RLS)** do banco: cada pessoa só lê e altera as próprias linhas, mesmo que alguém use a chave pública por
fora do app. Não há senhas, `.env` nem chave secreta no código.

Atenção: como o cadastro é aberto, qualquer pessoa com o link pode criar uma conta (e ver apenas os próprios dados). Se quiser
fechar, em **Authentication → Sign In / Providers** desative *Allow new users to sign up* depois que você e quem for usar já
tiverem criado as contas.

## Testar no seu computador

Qualquer servidor de arquivos estáticos serve (o app é só HTML/CSS/JS). Com `js/config.js` preenchido:

```bash
python -m http.server 8000 -d public      # ou: npx serve public
```

Abra <http://localhost:8000>. Para o login funcionar em `localhost`, o Supabase aceita sem configuração extra.

## Estrutura

```
organize/
├── .github/workflows/pages.yml  → publica a pasta public/ no GitHub Pages
├── public/                      → o app (é isto que vai para o ar)
│   ├── *.html                   → telas (login, cadastro, lançamentos, painel, tipos, cartões, perfil)
│   ├── css/style.css
│   ├── js/config.js             → URL e chave PÚBLICA do Supabase (único arquivo a editar)
│   ├── js/backend.js            → login, validações, contas (resumo, limite, painel) e acesso ao Supabase
│   ├── js/api.js                → ponte entre as telas e o backend.js
│   ├── js/*.js                  → uma por tela
│   ├── manifest.json, sw.js     → instalação no celular (PWA) e uso offline das telas
│   └── .nojekyll
├── sql/schema.sql               → tabelas, regras e políticas RLS (instalação nova)
├── sql/migracao_etapa4.sql      → vencimento, parcelas, recorrência
├── sql/migracao_etapa4b.sql     → tipos "conta com vencimento"
├── sql/migracao_etapa5.sql      → receitas, tipos de receita e limite mensal
├── sql/migracao_etapa6.sql      → perfil: endereço e foto
├── sql/migracao_etapa7.sql      → limite de gastos em porcentagem da renda
└── .gitignore
```

## Instalar no celular (PWA)

- **Android (Chrome):** botão **Instalar app** no topo, ou menu ⋮ > *Instalar app*.
- **iPhone (Safari):** Compartilhar > *Adicionar à Tela de Início*.
- A instalação exige **HTTPS** (o GitHub Pages já usa).

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Configuração do Supabase ausente" | Edite `public/js/config.js` com a URL e a chave pública e faça `git push` |
| Página 404 no endereço do Pages | Confira **Settings → Pages → Source: GitHub Actions** e se o workflow terminou em **Actions** |
| Mudei algo e o celular mostra a versão antiga | Feche e abra o app duas vezes (ele atualiza sozinho ao detectar arquivos novos) |
| Cadastro pede confirmação por e-mail e o link abre uma página errada | Ajuste **Site URL** em *Authentication → URL Configuration* (passo 6) |
| `permission denied for table ...` | No SQL Editor, rode: `grant select, insert, update, delete on public.tipos_despesa, public.cartoes, public.despesas, public.tipos_receita, public.receitas, public.configuracoes to authenticated; grant select, insert, update on public.perfis to authenticated;` |

## Etapas do MVP

- [x] Banco de dados e estrutura base do projeto
- [x] Login e cadastro de usuário
- [x] Tipos de despesa
- [x] Cartões de crédito
- [x] App instalável no celular (PWA) e layout responsivo
- [x] Tela principal de lançamento de despesas (data da compra + vencimento, parcelamento no crédito, despesa que se repete todo mês, tipos "conta com vencimento" para aluguel, água e luz)
- [x] Receitas, saldo do mês (receitas − despesas), limite mensal de gastos com aviso e Painel com gráficos por mês e por tipo
- [x] Perfil (nome, endereço e foto redonda no topo) e botão para limpar todos os lançamentos (despesas, receitas e limite)
- [x] Publicação gratuita no GitHub Pages (sem servidor PHP)
- [x] Limite de gastos em % da renda do mês (ou em R$), com dica da regra 50/30/20
