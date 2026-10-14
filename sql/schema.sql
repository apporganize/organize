-- =====================================================
-- organize! — schema do MVP
-- Execute no Supabase: SQL Editor -> New query -> Run
-- =====================================================

-- 1) PERFIS (dados extras do usuário; login fica no Supabase Auth)
create table public.perfis (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  criado_em   timestamptz not null default now()
);

-- Cria o perfil automaticamente quando alguém se cadastra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfis (id, nome)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) TIPOS DE DESPESA
create table public.tipos_despesa (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome       text not null check (char_length(trim(nome)) > 0),
  criado_em  timestamptz not null default now(),
  unique (user_id, nome),
  unique (id, user_id)  -- necessário para a FK composta de despesas
);

-- 3) CARTÕES DE CRÉDITO (apenas nome + 4 últimos dígitos)
create table public.cartoes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome               text not null check (char_length(trim(nome)) > 0),
  ultimos_4_digitos  char(4) not null check (ultimos_4_digitos ~ '^[0-9]{4}$'),
  criado_em          timestamptz not null default now(),
  unique (id, user_id)  -- necessário para a FK composta de despesas
);

-- 4) DESPESAS
create table public.despesas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  descricao        text not null check (char_length(trim(descricao)) > 0),
  valor            numeric(12,2) not null check (valor > 0),
  data_despesa     date not null default current_date,
  tipo_id          uuid not null,
  forma_pagamento  text not null check (forma_pagamento in ('credito', 'debito', 'pix')),
  cartao_id        uuid,
  status           text not null default 'pendente' check (status in ('pago', 'pendente')),
  criado_em        timestamptz not null default now(),

  -- Garante que tipo e cartão pertencem ao MESMO usuário da despesa
  foreign key (tipo_id,   user_id) references public.tipos_despesa (id, user_id) on delete restrict,
  foreign key (cartao_id, user_id) references public.cartoes       (id, user_id) on delete restrict,

  -- Crédito exige cartão; débito e pix não podem ter cartão
  constraint cartao_conforme_forma_pagamento check (
    (forma_pagamento = 'credito' and cartao_id is not null)
    or (forma_pagamento <> 'credito' and cartao_id is null)
  )
);

create index despesas_user_data_idx on public.despesas (user_id, data_despesa desc);

-- 5) SEGURANÇA: RLS (cada usuário só enxerga os próprios dados)
alter table public.perfis        enable row level security;
alter table public.tipos_despesa enable row level security;
alter table public.cartoes       enable row level security;
alter table public.despesas      enable row level security;

create policy "perfis: ver o próprio" on public.perfis
  for select using (id = (select auth.uid()));
create policy "perfis: editar o próprio" on public.perfis
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "tipos: acesso do dono" on public.tipos_despesa
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "cartoes: acesso do dono" on public.cartoes
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "despesas: acesso do dono" on public.despesas
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
