-- profiles table for user metadata
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null,
  name text,
  first_name text,
  last_name text,
  onboarded boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
before update on public.profiles
for each row execute procedure trigger_set_updated_at();
