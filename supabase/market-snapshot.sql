-- Hourly shared market snapshot for stocks.html.
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run),
-- AFTER deploying the market-snapshot Edge Function.
-- Safe to run again: every statement is idempotent.

-- 1. One-row table holding the latest snapshot. Anyone may read it;
--    only the Edge Function (service role) can write it.
create table if not exists public.market_snapshots (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.market_snapshots enable row level security;

drop policy if exists "Anyone can read the market snapshot" on public.market_snapshots;
create policy "Anyone can read the market snapshot"
  on public.market_snapshots for select
  using (true);

-- 2. Scheduler (pg_cron) and outbound HTTP (pg_net).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- 3. Call the Edge Function at the top of every hour. The key below is the
--    public anon key (already in config.js); the function ignores calls made
--    within 50 minutes of the last refresh, so it can't be used to burn API quota.
select cron.schedule(
  'market-snapshot-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://wspoaaavafclfpdplcqv.supabase.co/functions/v1/market-snapshot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzcG9hYWF2YWZjbGZwZHBsY3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNTA5NTMsImV4cCI6MjEwMjgyNjk1M30.IJQ9ls4MDDml0ON-OpP-0ohq74HB0hUsng1muyGDyM0'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- 4. Build the first snapshot right now instead of waiting for the next hour.
select net.http_post(
  url := 'https://wspoaaavafclfpdplcqv.supabase.co/functions/v1/market-snapshot?force=1',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzcG9hYWF2YWZjbGZwZHBsY3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNTA5NTMsImV4cCI6MjEwMjgyNjk1M30.IJQ9ls4MDDml0ON-OpP-0ohq74HB0hUsng1muyGDyM0'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
);
