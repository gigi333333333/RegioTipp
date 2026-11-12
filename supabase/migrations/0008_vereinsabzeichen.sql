-- Eigene RegioTipp-Vereinsabzeichen statt Original-Wappen.
-- Die Edge Function "logos" liest nur die Vereinsfarben aus den Original-Wappen und erzeugt
-- ein eigenes Schild mit Kürzel (z.B. "FCW"). Originale werden nicht gespeichert.

alter table public.club_logos add column if not exists club_name text;
alter table public.club_logos add column if not exists initials text;
alter table public.club_logos add column if not exists color1 text;
alter table public.club_logos add column if not exists color2 text;
alter table public.club_logos add column if not exists badge_url text;

create or replace function public.badges_todo(p_limit integer default 300)
returns table (source text, team_names text[]) language sql stable security definer set search_path = public as $$
  select split_part(t.logo_source, '?', 1), array_agg(distinct t.name)
    from public.teams t
   where t.logo_source is not null
     and not exists (select 1 from public.club_logos c
                      where c.source = split_part(t.logo_source, '?', 1) and c.badge_url is not null)
   group by 1
   limit p_limit;
$$;

create or replace function public.badge_saved(p_source text, p_url text, p_club text, p_initials text, p_c1 text, p_c2 text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.club_logos (source, storage_url, club_name, initials, color1, color2, badge_url)
  values (p_source, p_url, p_club, p_initials, p_c1, p_c2, p_url)
  on conflict (source) do update set storage_url = excluded.storage_url, club_name = excluded.club_name,
    initials = excluded.initials, color1 = excluded.color1, color2 = excluded.color2,
    badge_url = excluded.badge_url, mirrored_at = now();
  update public.teams set logo_url = p_url where split_part(logo_source, '?', 1) = p_source;
  get diagnostics n = row_count;
  return n;
end $$;

-- Import: nur noch eigene Abzeichen anzeigen, nie das Original-Wappen
create or replace function public.fs_set_team_logos(p_logos jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.teams t
     set logo_source = x->>'logo',
         logo_url = (select c.badge_url from public.club_logos c where c.source = split_part(x->>'logo', '?', 1))
    from jsonb_array_elements(p_logos) x
   where t.fs_team_id = x->>'fs_team_id'
     and nullif(x->>'logo', '') is not null
     and x->>'logo' ~ '^https://[a-z0-9.-]+\.amazonaws\.com/'
     and t.logo_source is distinct from x->>'logo';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.badges_todo(integer), public.badge_saved(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.badges_todo(integer), public.badge_saved(text, text, text, text, text, text)
  to service_role;
