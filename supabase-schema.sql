-- Run this once in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run)

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plate_number text not null,
  plate_state text not null,
  plate_type text not null,
  created_at timestamptz not null default now()
);

alter table public.vehicles enable row level security;

create policy "Users can view own vehicles"
  on public.vehicles for select
  using (auth.uid() = user_id);

create policy "Users can insert own vehicles"
  on public.vehicles for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own vehicles"
  on public.vehicles for delete
  using (auth.uid() = user_id);
