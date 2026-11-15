-- TRAKROBOT: схема Supabase (PostgreSQL). Выполнить целиком в SQL Editor.
-- Доступ к таблицам только через Worker с service_role ключом: RLS включён, политик нет.

create extension if not exists pgcrypto;

-- ───────── Пользователи ─────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  telegram_id   bigint not null unique,
  username      text,
  first_name    text,
  photo_url     text,
  timezone      text not null default 'Europe/Moscow',
  locale        text not null default 'ru',
  theme         text not null default 'default-dark',
  notifications boolean not null default true,
  bot_blocked   boolean not null default false,
  referred_by   uuid references users(id),
  created_at    timestamptz not null default now()
);
create index users_username_idx on users (lower(username));

-- ───────── Привычки ─────────
create table habit_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  color text,
  sort_order int not null default 0
);
create index habit_groups_user_idx on habit_groups(user_id);

create type habit_type as enum ('boolean','quantity','duration','counter');

create table habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  group_id uuid references habit_groups(id) on delete set null,
  title text not null check (char_length(title) between 1 and 100),
  description text,
  icon text not null default 'check',
  color text not null default 'violet',
  type habit_type not null default 'boolean',
  target_value numeric not null default 1 check (target_value > 0),
  unit text,
  schedule jsonb not null default '{"kind":"daily"}',
  remind_at time,
  start_date date not null default current_date,
  sort_order int not null default 0,
  is_archived boolean not null default false,
  deleted_at timestamptz,            -- мягкое удаление: история логов сохраняется
  created_at timestamptz not null default now()
);
create index habits_user_idx on habits(user_id) where deleted_at is null;

create table habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  log_date date not null,            -- локальная дата пользователя
  value numeric not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (habit_id, log_date)
);
create index habit_logs_user_date_idx on habit_logs(user_id, log_date);

create table timer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  habit_id uuid references habits(id) on delete set null,
  started_at timestamptz not null,
  duration_sec int not null check (duration_sec > 0),
  elapsed_before_pause_sec int not null default 0,
  status text not null default 'running' check (status in ('running','paused','finished','cancelled')),
  completed_at timestamptz
);
create index timer_user_idx on timer_sessions(user_id, status);

-- ───────── Достижения ─────────
create table achievements (
  id serial primary key,
  code text not null unique,
  title text not null,
  description text not null,
  icon text not null,
  category text not null,            -- streak | completions | activity
  threshold int not null,
  rarity text not null default 'common'
);
create table user_achievements (
  user_id uuid not null references users(id) on delete cascade,
  achievement_id int not null references achievements(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)   -- защита от повторного начисления
);

insert into achievements (code,title,description,icon,category,threshold,rarity) values
 ('streak_2','2 дня','Серия 2 дня подряд','flame','streak',2,'common'),
 ('streak_5','5 дней','Серия 5 дней подряд','flame','streak',5,'common'),
 ('streak_7','7 дней','Серия 7 дней подряд','flame','streak',7,'common'),
 ('streak_14','14 дней','Серия 14 дней подряд','flame','streak',14,'common'),
 ('streak_30','30 дней','Серия 30 дней подряд','flame','streak',30,'rare'),
 ('streak_60','60 дней','Серия 60 дней подряд','flame','streak',60,'rare'),
 ('streak_90','90 дней','Серия 90 дней подряд','flame','streak',90,'rare'),
 ('streak_180','180 дней','Серия 180 дней подряд','flame','streak',180,'epic'),
 ('streak_365','365 дней','Серия целый год','flame','streak',365,'legendary'),
 ('done_100','100 выполнений','100 отметок выполнения','flag','completions',100,'common'),
 ('done_200','200 выполнений','200 отметок выполнения','flag','completions',200,'common'),
 ('done_300','300 выполнений','300 отметок выполнения','flag','completions',300,'rare'),
 ('done_500','500 выполнений','500 отметок выполнения','flag','completions',500,'rare'),
 ('done_1000','1000 выполнений','1000 отметок выполнения','flag','completions',1000,'epic'),
 ('first_habit','Первая привычка','Создана первая привычка','sparkles','activity',1,'common'),
 ('ten_habits','10 привычек','Создано 10 привычек','layers','activity',10,'common'),
 ('first_week','Первая неделя','7 дней активности','calendar','activity',7,'common'),
 ('first_month','Первый месяц','30 дней активности','calendar','activity',30,'rare');

-- ───────── Подписки (несколько независимых оснований PRO) ─────────
create type sub_source as enum ('TELEGRAM_STARS','ADMIN_GIFT','REFERRAL_REWARD','PROMO_CODE');

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source sub_source not null,
  plan text not null default 'pro',
  days int not null,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,            -- отзыв не удаляет запись
  reason text,
  granted_by_telegram_id bigint,
  telegram_charge_id text unique,    -- для Stars: защита от повторной обработки
  idempotency_key text unique,       -- для админ-операций
  created_at timestamptz not null default now()
);
create index subs_user_idx on subscriptions(user_id, expires_at);

-- Итоговый статус PRO = любое неотозванное неистёкшее основание
create or replace function pro_until(p_user uuid) returns timestamptz
language sql stable as $$
  select max(expires_at) from subscriptions
  where user_id = p_user and revoked_at is null and expires_at > now();
$$;

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  plan_code text not null,
  amount int not null,
  currency text not null check (currency = 'XTR'),
  telegram_charge_id text not null unique,
  provider_charge_id text,
  status text not null default 'paid' check (status in ('paid','refunded')),
  created_at timestamptz not null default now()
);

-- ───────── Админы и аудит ─────────
create table admins (
  telegram_id bigint primary key,
  role text not null check (role in ('OWNER','ADMIN')),
  added_by bigint,
  created_at timestamptz not null default now()
);
-- OWNER берётся из переменной окружения ADMIN_OWNER_ID; остальные ADMIN — из этой таблицы или ADMIN_TELEGRAM_IDS.

create table admin_action_log (
  id bigserial primary key,
  admin_telegram_id bigint not null,
  target_telegram_id bigint,
  action_type text not null,
  previous_state jsonb,
  new_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);
-- журнал только для добавления
create or replace function forbid_log_change() returns trigger language plpgsql as $$
begin raise exception 'admin_action_log is append-only'; end $$;
create trigger admin_log_immutable before update or delete on admin_action_log
  for each row execute function forbid_log_change();

-- Атомарная выдача PRO. Новый срок прибавляется к концу текущего ADMIN_GIFT этого пользователя,
-- иначе отсчёт идёт с текущего момента. Платные подписки не затрагиваются.
create or replace function admin_grant_pro(
  p_target_tg bigint, p_days int, p_admin_tg bigint, p_reason text, p_idem text
) returns jsonb language plpgsql as $$
declare
  v_user users; v_existing subscriptions; v_base timestamptz; v_new subscriptions; v_prev timestamptz;
begin
  if p_days < 1 or p_days > 3650 then raise exception 'invalid_days'; end if;
  select * into v_existing from subscriptions where idempotency_key = p_idem;
  if found then
    return jsonb_build_object('duplicate', true, 'expires_at', v_existing.expires_at);
  end if;
  select * into v_user from users where telegram_id = p_target_tg for update;
  if not found then raise exception 'user_not_found'; end if;

  v_prev := pro_until(v_user.id);
  select coalesce(max(expires_at), now()) into v_base from subscriptions
   where user_id = v_user.id and source = 'ADMIN_GIFT' and revoked_at is null and expires_at > now();

  insert into subscriptions(user_id, source, days, started_at, expires_at, reason, granted_by_telegram_id, idempotency_key)
  values (v_user.id, 'ADMIN_GIFT', p_days, v_base, v_base + make_interval(days => p_days), p_reason, p_admin_tg, p_idem)
  returning * into v_new;

  insert into admin_action_log(admin_telegram_id, target_telegram_id, action_type, previous_state, new_state, reason)
  values (p_admin_tg, p_target_tg, 'GRANT_PRO',
          jsonb_build_object('pro_until', v_prev),
          jsonb_build_object('pro_until', pro_until(v_user.id), 'days', p_days, 'subscription_id', v_new.id),
          p_reason);

  return jsonb_build_object('duplicate', false, 'expires_at', v_new.expires_at,
                            'extended', v_base > now(), 'pro_until', pro_until(v_user.id));
end $$;

-- Отзыв только ADMIN_GIFT; оплаченные подписки не трогаются
create or replace function admin_revoke_gifts(p_target_tg bigint, p_admin_tg bigint, p_reason text)
returns jsonb language plpgsql as $$
declare v_user users; v_prev timestamptz; v_count int;
begin
  select * into v_user from users where telegram_id = p_target_tg for update;
  if not found then raise exception 'user_not_found'; end if;
  v_prev := pro_until(v_user.id);
  update subscriptions set revoked_at = now()
   where user_id = v_user.id and source = 'ADMIN_GIFT' and revoked_at is null and expires_at > now();
  get diagnostics v_count = row_count;
  insert into admin_action_log(admin_telegram_id, target_telegram_id, action_type, previous_state, new_state, reason)
  values (p_admin_tg, p_target_tg, 'REVOKE_PRO', jsonb_build_object('pro_until', v_prev),
          jsonb_build_object('pro_until', pro_until(v_user.id), 'revoked', v_count), p_reason);
  return jsonb_build_object('revoked', v_count, 'pro_until', pro_until(v_user.id));
end $$;

-- Обработка платежа Stars: идемпотентно по telegram_charge_id
create or replace function record_stars_payment(
  p_tg bigint, p_plan text, p_days int, p_amount int, p_currency text, p_charge text, p_provider_charge text
) returns jsonb language plpgsql as $$
declare v_user users; v_base timestamptz; v_exp timestamptz;
begin
  if p_currency <> 'XTR' then raise exception 'bad_currency'; end if;
  if exists (select 1 from payments where telegram_charge_id = p_charge) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into v_user from users where telegram_id = p_tg for update;
  if not found then raise exception 'user_not_found'; end if;
  select coalesce(max(expires_at), now()) into v_base from subscriptions
   where user_id = v_user.id and source = 'TELEGRAM_STARS' and revoked_at is null and expires_at > now();
  v_exp := v_base + make_interval(days => p_days);
  insert into payments(user_id, plan_code, amount, currency, telegram_charge_id, provider_charge_id)
    values (v_user.id, p_plan, p_amount, p_currency, p_charge, p_provider_charge);
  insert into subscriptions(user_id, source, plan, days, started_at, expires_at, telegram_charge_id)
    values (v_user.id, 'TELEGRAM_STARS', p_plan, p_days, v_base, v_exp, p_charge);
  return jsonb_build_object('duplicate', false, 'expires_at', v_exp);
end $$;

-- ───────── Темы ─────────
create table themes (
  id text primary key, name text not null, configuration jsonb not null, is_premium boolean not null default false
);

-- ───────── Челленджи ─────────
create table challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references users(id),
  title text not null, description text, icon text default 'trophy', color text default 'violet',
  target_value numeric not null default 1, duration_days int not null check (duration_days between 1 and 365),
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  starts_at timestamptz not null default now(), ends_at timestamptz not null,
  status text not null default 'active',
  created_at timestamptz not null default now()    -- от него считается недельный откат для FREE
);
create index challenges_creator_idx on challenges(creator_id, created_at desc);
create table challenge_members (
  challenge_id uuid references challenges(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create table challenge_progress (
  challenge_id uuid not null, user_id uuid not null, log_date date not null, value numeric not null default 0,
  primary key (challenge_id, user_id, log_date),
  foreign key (challenge_id, user_id) references challenge_members(challenge_id, user_id) on delete cascade
);

-- ───────── Рефералы ─────────
create table referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references users(id),
  invited_user_id uuid not null unique references users(id),   -- один пользователь = один пригласивший
  status text not null default 'registered' check (status in ('registered','activated')),
  created_at timestamptz not null default now(),
  check (inviter_id <> invited_user_id)
);
create table referral_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  referral_id uuid references referrals(id),
  milestone int,
  reward_days int not null,
  created_at timestamptz not null default now(),
  unique (referral_id),
  unique (user_id, milestone)
);

-- ───────── Уведомления ─────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null, payload jsonb, dedupe_key text unique,
  scheduled_at timestamptz not null default now(), sent_at timestamptz,
  status text not null default 'pending'
);

-- ───────── RLS: всё закрыто для anon, доступ только service_role ─────────
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
