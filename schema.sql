-- Bestiario: una fila por usuario con todo su estado.
-- Pégalo en Supabase → SQL Editor → New query → Run.
create table if not exists public.bestiario (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data        jsonb not null,
  actualizado bigint not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.bestiario enable row level security;

drop policy if exists "bestiario_leer"   on public.bestiario;
drop policy if exists "bestiario_crear"  on public.bestiario;
drop policy if exists "bestiario_editar" on public.bestiario;

create policy "bestiario_leer"   on public.bestiario for select to authenticated using (auth.uid() = user_id);
create policy "bestiario_crear"  on public.bestiario for insert to authenticated with check (auth.uid() = user_id);
create policy "bestiario_editar" on public.bestiario for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
