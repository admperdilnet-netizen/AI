-- Dominican Clipper: perfiles y permisos básicos de autenticación
-- Ejecuta este archivo en Supabase Dashboard > SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user','admin')),
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.is_dominican_clipper_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and blocked = false
  );
$$;

revoke all on function public.is_dominican_clipper_admin() from public;
grant execute on function public.is_dominican_clipper_admin() to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
on public.profiles for select
to authenticated
using (public.is_dominican_clipper_admin());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create or replace function public.handle_new_dominican_clipper_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, blocked)
  values (
    new.id,
    new.email,
    case when lower(coalesce(new.email,'')) = 'admperdilnet@gmail.com' then 'admin' else 'user' end,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_dominican_clipper on auth.users;
create trigger on_auth_user_created_dominican_clipper
after insert on auth.users
for each row execute procedure public.handle_new_dominican_clipper_user();

-- Crea perfiles para cuentas que ya existían antes de instalar este esquema.
insert into public.profiles (id, email, role, blocked)
select id, email,
       case when lower(coalesce(email,'')) = 'admperdilnet@gmail.com' then 'admin' else 'user' end,
       false
from auth.users
on conflict (id) do update
set email = excluded.email,
    role = case when lower(coalesce(excluded.email,'')) = 'admperdilnet@gmail.com' then 'admin' else public.profiles.role end;

