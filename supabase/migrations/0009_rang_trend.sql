-- Veränderung der eigenen Platzierung in einer Tipprunde: jetzt vs. vor dem letzten Spieltag
-- (letzter Tag mit gespielten Spielen der Tipprunde, Schweizer Zeit).
create or replace function public.group_rank_trend(p_group_id uuid)
returns table (rank_now bigint, rank_before bigint, last_matchday date)
language sql stable security definer set search_path = public as $$
  with grp as (
    select g.id, g.team_id, public.group_league_ids(g.id) league_ids
      from public.groups g where g.id = p_group_id and public.is_group_member(g.id)
  ), gm as (
    select mt.* from public.matches mt, grp
     where mt.status = 'finished' and public.match_in_group(mt, grp.team_id, grp.league_ids)
  ), lastday as (
    select max((kickoff at time zone 'Europe/Zurich')::date) d from gm
  ), cutoff as (
    select (d::timestamp at time zone 'Europe/Zurich') ts, d from lastday
  ), scored as (
    select m.user_id,
           coalesce(sum(t.points), 0) pts_now,
           count(t.id) filter (where x.home_goals = t.home_goals and x.away_goals = t.away_goals) ex_now,
           coalesce(sum(t.points) filter (where x.kickoff < (select ts from cutoff)), 0) pts_before,
           count(t.id) filter (where x.kickoff < (select ts from cutoff) and x.home_goals = t.home_goals and x.away_goals = t.away_goals) ex_before
      from public.group_members m
      join grp on grp.id = m.group_id
      left join public.tips t on t.user_id = m.user_id and t.match_id in (select id from gm)
      left join gm x on x.id = t.match_id
     group by m.user_id
  ), ranked as (
    select user_id,
           rank() over (order by pts_now desc, ex_now desc) r_now,
           rank() over (order by pts_before desc, ex_before desc) r_before
      from scored
  )
  select r_now, r_before, (select d from cutoff) from ranked where user_id = auth.uid();
$$;
revoke execute on function public.group_rank_trend(uuid) from public, anon;
grant execute on function public.group_rank_trend(uuid) to authenticated;
