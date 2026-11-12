-- Spiele-Ansicht mit Vereinswappen (für die Tipp-Karten)
create or replace view public.match_list with (security_invoker = true) as
select m.id, m.league_id, l.name as league_name, sl.slug as source_slug, sl.name as source_name,
       sl.category, (m.league_id is null) as is_cup, m.kickoff, m.status, m.home_goals, m.away_goals,
       m.home_team_id, th.name as home_name, m.away_team_id, ta.name as away_name,
       th.logo_url as home_logo, ta.logo_url as away_logo
  from public.matches m
  join public.teams th on th.id = m.home_team_id
  join public.teams ta on ta.id = m.away_team_id
  left join public.leagues l on l.id = m.league_id
  left join public.source_leagues sl on sl.slug = l.source_slug;
