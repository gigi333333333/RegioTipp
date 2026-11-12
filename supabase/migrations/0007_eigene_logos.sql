-- Vereinswappen im eigenen Speicher (Bucket "logos"), heruntergeladen von footstats.ch
-- durch die Edge Function "logos" (täglich 04:25 für neue Vereine).

alter table public.teams add column if not exists logo_source text;
update public.teams set logo_source = logo_url where logo_source is null and logo_url is not null;

create table if not exists public.club_logos (
  source      text primary key,
  storage_url text not null,
  mime        text,
  bytes       integer,
  width       integer,
  height      integer,
  mirrored_at timestamptz not null default now()
);
alter table public.club_logos enable row level security;
create policy "lesen" on public.club_logos for select using (true);

-- Import: Quelle merken; solange keine eigene Kopie existiert, direkt die Quelle anzeigen
create or replace function public.fs_set_team_logos(p_logos jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.teams t
     set logo_source = x->>'logo',
         logo_url = coalesce((select c.storage_url from public.club_logos c where c.source = split_part(x->>'logo', '?', 1)),
                             x->>'logo')
    from jsonb_array_elements(p_logos) x
   where t.fs_team_id = x->>'fs_team_id'
     and nullif(x->>'logo', '') is not null
     and x->>'logo' ~ '^https://[a-z0-9.-]+\.amazonaws\.com/'
     and t.logo_source is distinct from x->>'logo';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.logos_to_mirror(p_limit integer default 200)
returns table (source text) language sql stable security definer set search_path = public as $$
  select distinct split_part(t.logo_source, '?', 1)
    from public.teams t
   where t.logo_source is not null
     and not exists (select 1 from public.club_logos c where c.source = split_part(t.logo_source, '?', 1))
   limit p_limit;
$$;

create or replace function public.logo_mirrored(p_source text, p_url text, p_mime text, p_bytes integer, p_w integer, p_h integer)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.club_logos (source, storage_url, mime, bytes, width, height)
  values (p_source, p_url, p_mime, p_bytes, p_w, p_h)
  on conflict (source) do update set storage_url = excluded.storage_url, mime = excluded.mime,
    bytes = excluded.bytes, width = excluded.width, height = excluded.height, mirrored_at = now();
  update public.teams set logo_url = p_url where split_part(logo_source, '?', 1) = p_source;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.logos_to_mirror(integer), public.logo_mirrored(text, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.logos_to_mirror(integer), public.logo_mirrored(text, text, text, integer, integer, integer)
  to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png', 'image/gif', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

select cron.schedule('logos-mirror', '25 4 * * *', $$select net.http_post(url := 'https://saguzhqngpyafvwetsnw.supabase.co/functions/v1/logos', headers := jsonb_build_object('Content-Type','application/json','x-sync-secret',(select value from private.config where key='sync_secret')), body := '{}'::jsonb, timeout_milliseconds := 150000)$$);
