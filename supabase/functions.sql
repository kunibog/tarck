-- TRAKROBOT: серверные функции статистики, достижений и рефералов.
-- Выполнить ПОСЛЕ schema.sql.

-- Серии и статистика пользователя (по локальной дате пользователя)
create or replace function user_stats(p_user uuid) returns jsonb language sql stable as $$
  with tz as (select (now() at time zone timezone)::date as today from users where id = p_user),
  d as (select distinct log_date from habit_logs where user_id = p_user and completed),
  g as (select log_date, log_date - (row_number() over (order by log_date))::int as grp from d),
  runs as (select count(*)::int as len, max(log_date) as last_d from g group by grp)
  select jsonb_build_object(
    'best', coalesce((select max(len) from runs), 0),
    'current', coalesce((select len from runs, tz where last_d >= tz.today - 1 order by last_d desc limit 1), 0),
    'completions', (select count(*) from habit_logs where user_id = p_user and completed),
    'active_days', (select count(*) from d),
    'habits', (select count(*) from habits where user_id = p_user)
  );
$$;

-- Серия по каждой привычке
create or replace function habit_streaks(p_user uuid) returns table(habit_id uuid, streak int)
language sql stable as $$
  with tz as (select (now() at time zone timezone)::date as today from users where id = p_user),
  d as (
    select l.habit_id, l.log_date,
           l.log_date - (row_number() over (partition by l.habit_id order by l.log_date))::int as grp
    from habit_logs l where l.user_id = p_user and l.completed
  ),
  runs as (select habit_id, count(*)::int as len, max(log_date) as last_d from d group by habit_id, grp)
  select r.habit_id, r.len from runs r, tz where r.last_d >= tz.today - 1;
$$;

-- Автоначисление достижений. Повторное начисление невозможно (primary key + on conflict).
create or replace function eval_achievements(p_user uuid) returns text[] language plpgsql as $$
declare s jsonb; r text[];
begin
  s := user_stats(p_user);
  with ins as (
    insert into user_achievements(user_id, achievement_id)
    select p_user, a.id from achievements a where
      (a.category = 'streak' and (s->>'best')::int >= a.threshold) or
      (a.category = 'completions' and (s->>'completions')::int >= a.threshold) or
      (a.code = 'first_habit' and (s->>'habits')::int >= 1) or
      (a.code = 'ten_habits' and (s->>'habits')::int >= 10) or
      (a.code = 'first_week' and (s->>'active_days')::int >= 7) or
      (a.code = 'first_month' and (s->>'active_days')::int >= 30)
    on conflict do nothing
    returning achievement_id
  )
  select array_agg(a.code) into r from ins join achievements a on a.id = ins.achievement_id;
  return coalesce(r, '{}');
end $$;

-- Активация реферала (после первой выполненной привычки приглашённого) и начисление наград:
-- 1 активный = 1 день, 5 активных = +5 дней, 10 активных = +10 дней. Каждая награда уникальна.
create or replace function activate_referral(p_invited uuid) returns jsonb language plpgsql as $$
declare r referrals; n int; added int := 0; c int; m int; base timestamptz; tg bigint;
begin
  select * into r from referrals where invited_user_id = p_invited and status = 'registered' for update;
  if not found then return null; end if;
  update referrals set status = 'activated' where id = r.id;
  select count(*) into n from referrals where inviter_id = r.inviter_id and status = 'activated';

  insert into referral_rewards(user_id, referral_id, reward_days) values (r.inviter_id, r.id, 1)
    on conflict do nothing;
  get diagnostics c = row_count; added := added + c;

  foreach m in array array[5, 10] loop
    if n >= m then
      insert into referral_rewards(user_id, milestone, reward_days) values (r.inviter_id, m, m)
        on conflict do nothing;
      get diagnostics c = row_count; added := added + c * m;
    end if;
  end loop;

  if added > 0 then
    select coalesce(max(expires_at), now()) into base from subscriptions
      where user_id = r.inviter_id and source = 'REFERRAL_REWARD' and revoked_at is null and expires_at > now();
    insert into subscriptions(user_id, source, days, started_at, expires_at, reason)
      values (r.inviter_id, 'REFERRAL_REWARD', added, base, base + make_interval(days => added), 'referral');
  end if;
  select telegram_id into tg from users where id = r.inviter_id;
  return jsonb_build_object('inviter_tg', tg, 'days', added);
end $$;

-- Стартовые темы
insert into themes(id, name, configuration, is_premium) values
  ('default-dark', 'Default Dark', '{}', false), ('default-light', 'Default Light', '{}', false),
  ('midnight', 'Midnight', '{}', true), ('violet', 'Violet', '{}', true), ('ocean', 'Ocean', '{}', true),
  ('emerald', 'Emerald', '{}', true), ('sunset', 'Sunset', '{}', true), ('rose', 'Rose', '{}', true),
  ('graphite', 'Graphite', '{}', true)
on conflict do nothing;
