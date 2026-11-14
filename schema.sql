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

-- ---------- Avisos cada hora ----------
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sub        jsonb not null,
  tz         text not null default 'America/Guayaquil',
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "push_leer"   on public.push_subs;
drop policy if exists "push_crear"  on public.push_subs;
drop policy if exists "push_editar" on public.push_subs;
drop policy if exists "push_borrar" on public.push_subs;
create policy "push_leer"   on public.push_subs for select to authenticated using (auth.uid() = user_id);
create policy "push_crear"  on public.push_subs for insert to authenticated with check (auth.uid() = user_id);
create policy "push_editar" on public.push_subs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_borrar" on public.push_subs for delete to authenticated using (auth.uid() = user_id);

-- Claves del servidor de avisos: solo la función puede leerlas (sin políticas = nadie más).
create table if not exists public.push_config (
  id          int primary key,
  public_key  text not null,
  private_key text not null,
  last_run    timestamptz
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- Tarea de cada hora (en punto) que llama a la función.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('bestiario-avisos') where exists (select 1 from cron.job where jobname = 'bestiario-avisos');
select cron.schedule('bestiario-avisos', '0 * * * *', $$
  select net.http_post(
    url := 'https://jwyxhmovudzyddgbjyev.supabase.co/functions/v1/avisar',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
