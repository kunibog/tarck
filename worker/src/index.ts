// TRAKROBOT API + Telegram bot webhook + cron (Cloudflare Worker)
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PLANS, FREE_LIMITS, PRO_MAX_HISTORY_DAYS, CHALLENGE_MAX_MEMBERS, RATE_LIMIT_PER_MIN, FREE_THEMES, ALL_THEMES } from './config';
import { Env, HttpError, verifyInitData, tg, notify, claim, fmtDate, roleOf, proUntil, tzOk, todayIn, addDays, isDate, isScheduled, cors, json } from './lib';
import { adminRoute } from './admin';

// Rate limit (best effort, в пределах одного isolate). Для жёсткой защиты добавь правило Cloudflare Rate Limiting.
const hits = new Map<number, { n: number; t: number }>();
function rateLimit(id: number) {
  const now = Date.now(); const e = hits.get(id);
  if (!e || now - e.t > 60000) { hits.set(id, { n: 1, t: now }); return; }
  if (++e.n > RATE_LIMIT_PER_MIN) throw new HttpError(429, 'rate_limited');
}

const refCode = (tgId: number) => tgId.toString(36);

// ───────── Пользователь ─────────
async function upsertUser(db: SupabaseClient, tgUser: any, startParam: string | null, tzHeader: string | null) {
  const tz = tzOk(tzHeader) ? tzHeader! : null;
  const { data: existing } = await db.from('users').select('*').eq('telegram_id', tgUser.id).maybeSingle();
  if (existing) {
    const patch: any = { username: tgUser.username ?? null, first_name: tgUser.first_name ?? null, photo_url: tgUser.photo_url ?? null, bot_blocked: false };
    if (tz && tz !== existing.timezone) patch.timezone = tz;
    await db.from('users').update(patch).eq('id', existing.id);
    return { ...existing, ...patch };
  }
  const { data: created, error } = await db.from('users').insert({
    telegram_id: tgUser.id, username: tgUser.username ?? null, first_name: tgUser.first_name ?? null,
    photo_url: tgUser.photo_url ?? null, locale: tgUser.language_code === 'ru' ? 'ru' : 'en', ...(tz ? { timezone: tz } : {}),
  }).select().single();
  if (error) {
    // гонка двух первых запросов: пользователь уже создан
    const { data: again } = await db.from('users').select('*').eq('telegram_id', tgUser.id).maybeSingle();
    if (again) return again;
    throw new HttpError(500, error.message);
  }
  // Реферал фиксируется только при создании аккаунта. Самореферал и повторная привязка невозможны (CHECK + UNIQUE).
  if (startParam?.startsWith('ref_')) {
    const inviterTg = Number.parseInt(startParam.slice(4), 36);
    if (inviterTg && inviterTg !== tgUser.id) {
      const { data: inviter } = await db.from('users').select('id').eq('telegram_id', inviterTg).maybeSingle();
      if (inviter) {
        await db.from('referrals').insert({ inviter_id: inviter.id, invited_user_id: created.id });
        await db.from('users').update({ referred_by: inviter.id }).eq('id', created.id);
      }
    }
  }
  return created;
}

// ───────── Привычки ─────────
async function activeHabitCount(db: SupabaseClient, userId: string) {
  const { count } = await db.from('habits').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null).eq('is_archived', false);
  return count ?? 0;
}
async function ownHabit(db: SupabaseClient, user: any, id: string) {
  const { data } = await db.from('habits').select('*').eq('id', id).eq('user_id', user.id).is('deleted_at', null).maybeSingle();
  if (!data) throw new HttpError(404, 'habit_not_found'); // чужая привычка неотличима от несуществующей
  return data;
}
async function ownGroup(db: SupabaseClient, user: any, id: string | null) {
  if (!id) return null;
  const { data } = await db.from('habit_groups').select('id').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!data) throw new HttpError(404, 'group_not_found');
  return id;
}
const HABIT_TYPES = ['boolean', 'quantity', 'duration', 'counter'];
function cleanSchedule(s: any) {
  if (!s || typeof s !== 'object') return { kind: 'daily' };
  if (s.kind === 'weekdays') return { kind: 'weekdays', days: (Array.isArray(s.days) ? s.days : []).map(Number).filter((n: number) => n >= 1 && n <= 7) };
  if (s.kind === 'interval') return { kind: 'interval', every: Math.min(365, Math.max(1, Math.floor(Number(s.every) || 1))) };
  if (s.kind === 'dates') return { kind: 'dates', dates: (Array.isArray(s.dates) ? s.dates : []).filter(isDate).slice(0, 400) };
  return { kind: 'daily' };
}
const time = (s: any) => (typeof s === 'string' && /^\d{2}:\d{2}$/.test(s) ? s : null);

async function createHabit(db: SupabaseClient, user: any, body: any) {
  const title = String(body.title ?? '').trim();
  if (!title || title.length > 100) throw new HttpError(400, 'bad_title');
  if (!(await proUntil(db, user.id)) && (await activeHabitCount(db, user.id)) >= FREE_LIMITS.activeHabits) throw new HttpError(402, 'free_limit_habits');
  const type = HABIT_TYPES.includes(body.type) ? body.type : 'boolean';
  const { data, error } = await db.from('habits').insert({
    user_id: user.id, title, description: body.description ? String(body.description).slice(0, 500) : null,
    icon: String(body.icon ?? 'check').slice(0, 40), color: String(body.color ?? 'violet').slice(0, 20), type,
    target_value: type === 'boolean' ? 1 : Math.min(1e7, Math.max(0.01, Number(body.target_value) || 1)),
    unit: body.unit ? String(body.unit).slice(0, 20) : null, schedule: cleanSchedule(body.schedule),
    group_id: await ownGroup(db, user, body.group_id ?? null), remind_at: time(body.remind_at),
    start_date: isDate(body.start_date) ? body.start_date : todayIn(user.timezone),
    sort_order: Date.now() % 1000000000,
  }).select().single();
  if (error) throw new HttpError(400, error.message);
  await evalAfter(db, user, false);
  return data;
}

async function patchHabit(db: SupabaseClient, user: any, id: string, body: any) {
  const h = await ownHabit(db, user, id);
  const p: any = {};
  if ('title' in body) { const t = String(body.title).trim(); if (!t || t.length > 100) throw new HttpError(400, 'bad_title'); p.title = t; }
  if ('description' in body) p.description = body.description ? String(body.description).slice(0, 500) : null;
  if ('icon' in body) p.icon = String(body.icon).slice(0, 40);
  if ('color' in body) p.color = String(body.color).slice(0, 20);
  if ('unit' in body) p.unit = body.unit ? String(body.unit).slice(0, 20) : null;
  if ('target_value' in body && h.type !== 'boolean') p.target_value = Math.min(1e7, Math.max(0.01, Number(body.target_value) || 1));
  if ('schedule' in body) p.schedule = cleanSchedule(body.schedule);
  if ('group_id' in body) p.group_id = await ownGroup(db, user, body.group_id);
  if ('remind_at' in body) p.remind_at = time(body.remind_at);
  if ('start_date' in body && isDate(body.start_date)) p.start_date = body.start_date;
  if ('sort_order' in body) p.sort_order = Math.floor(Number(body.sort_order) || 0);
  if ('is_archived' in body) {
    p.is_archived = !!body.is_archived;
    if (!p.is_archived && h.is_archived && !(await proUntil(db, user.id)) && (await activeHabitCount(db, user.id)) >= FREE_LIMITS.activeHabits) throw new HttpError(402, 'free_limit_habits');
  }
  const { data, error } = await db.from('habits').update(p).eq('id', id).eq('user_id', user.id).select().single();
  if (error) throw new HttpError(400, error.message);
  return data;
}

async function writeLog(db: SupabaseClient, user: any, habit: any, date: string, value: number) {
  const today = todayIn(user.timezone);
  if (!isDate(date) || date > addDays(today, 1)) throw new HttpError(400, 'bad_date');
  if (!(await proUntil(db, user.id)) && date < addDays(today, -(FREE_LIMITS.analyticsDays * 4))) throw new HttpError(402, 'free_limit_history');
  value = Math.min(1e7, Math.max(0, Number(value) || 0));
  const completed = habit.type === 'boolean' ? value > 0 : value >= Number(habit.target_value);
  const { data, error } = await db.from('habit_logs').upsert(
    { habit_id: habit.id, user_id: user.id, log_date: date, value, completed, updated_at: new Date().toISOString() },
    { onConflict: 'habit_id,log_date' }).select('habit_id,log_date,value,completed').single();
  if (error) throw new HttpError(400, error.message);
  return data;
}

// Достижения и активация реферала после действия пользователя
async function evalAfter(db: SupabaseClient, user: any, completed: boolean, env?: Env) {
  const { data: codes } = await db.rpc('eval_achievements', { p_user: user.id });
  let unlocked: any[] = [];
  if (codes?.length) {
    unlocked = (await db.from('achievements').select('code,title,icon').in('code', codes)).data ?? [];
    if (env && user.notifications) await notify(env, db, user.telegram_id, `🏆 Новое достижение: ${unlocked.map(a => a.title).join(', ')}`);
  }
  if (completed) {
    const { data: ref } = await db.rpc('activate_referral', { p_invited: user.id });
    if (ref?.days > 0 && env) await notify(env, db, ref.inviter_tg, `🎁 Ваш друг начал пользоваться TRAKROBOT. Вам начислено дней PRO: ${ref.days}.`);
  }
  return unlocked;
}

// ───────── Таймер (состояние хранится на сервере) ─────────
const timerView = (t: any) => ({
  id: t.id, habit_id: t.habit_id, status: t.status, duration: t.duration_sec,
  elapsed: t.elapsed_before_pause_sec + (t.status === 'running' ? (Date.now() - Date.parse(t.started_at)) / 1000 : 0),
});

// ───────── Платежи ─────────
async function createInvoice(env: Env, user: any, planCode: string) {
  const plan = PLANS[planCode];
  if (!plan) throw new HttpError(400, 'bad_plan');
  const res = await tg(env, 'createInvoiceLink', {
    title: `TRAKROBOT PRO — ${plan.title}`, description: `Доступ к TRAKROBOT PRO на ${plan.days} дн.`,
    payload: JSON.stringify({ u: user.telegram_id, p: planCode }), provider_token: '', currency: 'XTR',
    prices: [{ label: plan.title, amount: plan.stars }],
  });
  if (!res.ok) throw new HttpError(502, res.description ?? 'invoice_failed');
  return { invoiceLink: res.result };
}

async function handleUpdate(env: Env, db: SupabaseClient, update: any) {
  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    let ok = false;
    try { const p = JSON.parse(q.invoice_payload); const plan = PLANS[p.p]; ok = !!plan && q.currency === 'XTR' && q.total_amount === plan.stars && p.u === q.from.id; } catch { /* */ }
    await tg(env, 'answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'Неверный платёж' });
    return;
  }
  const msg = update.message;
  if (!msg) return;
  if (msg.successful_payment) {
    const sp = msg.successful_payment;
    let p: any; try { p = JSON.parse(sp.invoice_payload); } catch { return; }
    const plan = PLANS[p.p];
    if (!plan || sp.currency !== 'XTR' || sp.total_amount !== plan.stars || p.u !== msg.from.id) return; // сумма и валюта проверяются повторно
    const { data, error } = await db.rpc('record_stars_payment', {
      p_tg: msg.from.id, p_plan: p.p, p_days: plan.days, p_amount: sp.total_amount, p_currency: sp.currency,
      p_charge: sp.telegram_payment_charge_id, p_provider_charge: sp.provider_payment_charge_id ?? null,
    });
    if (error) { console.error('payment', error.message); throw new Error(error.message); } // Telegram повторит webhook
    if (!data.duplicate) await notify(env, db, msg.from.id, `✅ Оплата получена. TRAKROBOT PRO активен до ${fmtDate(data.expires_at)}.`);
    return;
  }
  const text: string = msg.text ?? '';
  if (text.startsWith('/start') || text === '/help') {
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: 'TRAKROBOT — Track everything. Control your progress.',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть TRAKROBOT', web_app: { url: env.MINIAPP_URL } }]] } });
    return;
  }
  if (text === '/admin') {
    if (!(await roleOf(env, db, msg.from.id))) return; // обычным пользователям бот не отвечает
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: 'Админ-панель TRAKROBOT',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть админку', web_app: { url: `${env.MINIAPP_URL}#admin` } }]] } });
  }
}

// ───────── Cron: напоминания, окончание PRO, завершение челленджей ─────────
async function runCron(env: Env, db: SupabaseClient) {
  // 1) напоминания о привычках (окно 15 минут, ключ защищает от дублей)
  const { data: hs } = await db.from('habits').select('id,title,schedule,start_date,remind_at,user_id, users!inner(telegram_id,timezone,notifications,bot_blocked)')
    .not('remind_at', 'is', null).is('deleted_at', null).eq('is_archived', false).limit(5000);
  const due: any[] = [];
  for (const h of hs ?? []) {
    const u = (h as any).users;
    if (!u.notifications || u.bot_blocked || !tzOk(u.timezone)) continue;
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: u.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const [nh, nm] = hhmm.split(':').map(Number); const [rh, rm] = String(h.remind_at).split(':').map(Number);
    const diff = nh * 60 + nm - (rh * 60 + rm);
    const date = todayIn(u.timezone);
    if (diff >= 0 && diff < 15 && isScheduled(h, date)) due.push({ h, u, date });
  }
  if (due.length) {
    const ids = due.map(d => d.h.id);
    const { data: done } = await db.from('habit_logs').select('habit_id,log_date').in('habit_id', ids).eq('completed', true).gte('log_date', addDays(new Date().toISOString().slice(0, 10), -2));
    const doneSet = new Set((done ?? []).map((l: any) => `${l.habit_id}|${l.log_date}`));
    for (const d of due) {
      if (doneSet.has(`${d.h.id}|${d.date}`)) continue;
      if (await claim(db, d.h.user_id, `rem:${d.h.id}:${d.date}`, 'habit_reminder')) await notify(env, db, d.u.telegram_id, `⏰ Напоминание: ${d.h.title}`);
    }
  }
  // 2) окончание PRO (один раз на подписку)
  const since = new Date(Date.now() - 2 * 864e5).toISOString(); const now = new Date().toISOString();
  const { data: ended } = await db.from('subscriptions').select('id,user_id, users(telegram_id,notifications)').is('revoked_at', null).lte('expires_at', now).gte('expires_at', since).limit(500);
  for (const s of ended ?? []) {
    if (await proUntil(db, s.user_id)) continue;
    if (await claim(db, s.user_id, `exp:${s.id}`, 'pro_expired')) await notify(env, db, (s as any).users.telegram_id, 'Ваш период TRAKROBOT PRO завершён.\n\nВы по-прежнему можете пользоваться бесплатной версией TRAKROBOT.');
  }
  // 3) завершение челленджей
  const { data: fin } = await db.from('challenges').select('id,title').eq('status', 'active').lte('ends_at', now).limit(200);
  for (const c of fin ?? []) {
    await db.from('challenges').update({ status: 'finished' }).eq('id', c.id);
    const { data: ms } = await db.from('challenge_members').select('user_id, users(telegram_id,notifications)').eq('challenge_id', c.id);
    for (const m of ms ?? []) if ((m as any).users.notifications && await claim(db, m.user_id, `chend:${c.id}`, 'challenge_end')) await notify(env, db, (m as any).users.telegram_id, `🏁 Челлендж «${c.title}» завершён!`);
  }
}

// ───────── Основной роутер ─────────
export default {
  async scheduled(_c: any, env: Env, ctx: any) {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    ctx.waitUntil(runCron(env, db).catch(e => console.error('cron', e)));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    try {
      if (url.pathname === '/bot/webhook') {
        if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
        await handleUpdate(env, db, await req.json());
        return new Response('ok');
      }
      if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found');

      const auth = req.headers.get('authorization') ?? '';
      if (!auth.startsWith('tma ')) throw new HttpError(401, 'no_auth');
      const { user: tgUser, startParam } = await verifyInitData(auth.slice(4), env.BOT_TOKEN);
      rateLimit(tgUser.id);
      const user = await upsertUser(db, tgUser, startParam, req.headers.get('x-tz'));
      const body: any = req.method === 'GET' || req.method === 'DELETE' ? {} : await req.json().catch(() => ({}));
      const p = url.pathname, m = req.method;
      const ok = (d: unknown, s = 200) => json(env, d, s);

      // ── админка
      if (p.startsWith('/api/admin/')) {
        const role = await roleOf(env, db, tgUser.id);
        if (!role) throw new HttpError(403, 'forbidden');
        return ok(await adminRoute(env, db, { id: tgUser.id, role }, p, m, body, url));
      }

      // ── профиль
      if (p === '/api/me' && m === 'GET') {
        const until = await proUntil(db, user.id);
        return ok({
          user: { telegram_id: user.telegram_id, username: user.username, first_name: user.first_name, photo_url: user.photo_url, timezone: user.timezone, theme: user.theme, notifications: user.notifications, created_at: user.created_at },
          isPro: !!until, proUntil: until, isAdmin: !!(await roleOf(env, db, tgUser.id)), refCode: refCode(tgUser.id),
          plans: PLANS, freeLimits: FREE_LIMITS, serverDate: todayIn(user.timezone),
        });
      }
      if (p === '/api/me' && m === 'PATCH') {
        const patch: any = {};
        if ('theme' in body) {
          if (!ALL_THEMES.includes(body.theme)) throw new HttpError(400, 'bad_theme');
          if (!FREE_THEMES.includes(body.theme) && !(await proUntil(db, user.id))) throw new HttpError(402, 'pro_required');
          patch.theme = body.theme;
        }
        if ('notifications' in body) patch.notifications = !!body.notifications;
        await db.from('users').update(patch).eq('id', user.id);
        return ok({ ok: true });
      }

      // ── привычки
      if (p === '/api/habits' && m === 'GET') {
        const archived = url.searchParams.get('archived') === '1';
        const { data } = await db.from('habits').select('*').eq('user_id', user.id).is('deleted_at', null).eq('is_archived', archived).order('sort_order');
        const { data: st } = await db.rpc('habit_streaks', { p_user: user.id });
        const streaks: Record<string, number> = {}; for (const s of st ?? []) streaks[s.habit_id] = s.streak;
        const { data: groups } = await db.from('habit_groups').select('*').eq('user_id', user.id).order('sort_order');
        return ok({ habits: data ?? [], streaks, groups: groups ?? [] });
      }
      if (p === '/api/habits' && m === 'POST') return ok(await createHabit(db, user, body), 201);
      const hm = p.match(/^\/api\/habits\/([0-9a-f-]{36})(\/log)?$/);
      if (hm && hm[2] && m === 'POST') {
        const h = await ownHabit(db, user, hm[1]);
        const log = await writeLog(db, user, h, String(body.date ?? ''), body.value);
        const unlocked = await evalAfter(db, user, log.completed, env);
        return ok({ log, unlocked });
      }
      if (hm && !hm[2] && m === 'PATCH') return ok(await patchHabit(db, user, hm[1], body));
      if (hm && !hm[2] && m === 'DELETE') { // мягкое удаление: история логов сохраняется
        await ownHabit(db, user, hm[1]);
        await db.from('habits').update({ deleted_at: new Date().toISOString() }).eq('id', hm[1]).eq('user_id', user.id);
        return ok({ ok: true });
      }

      // ── группы
      if (p === '/api/groups' && m === 'POST') {
        const title = String(body.title ?? '').trim().slice(0, 40); if (!title) throw new HttpError(400, 'bad_title');
        const { data } = await db.from('habit_groups').insert({ user_id: user.id, title, color: body.color ?? null, sort_order: Date.now() % 1000000000 }).select().single();
        return ok(data, 201);
      }
      const gm = p.match(/^\/api\/groups\/([0-9a-f-]{36})$/);
      if (gm && m === 'PATCH') {
        await ownGroup(db, user, gm[1]);
        const patch: any = {}; if ('title' in body) patch.title = String(body.title).trim().slice(0, 40) || 'Группа';
        const { data } = await db.from('habit_groups').update(patch).eq('id', gm[1]).eq('user_id', user.id).select().single();
        return ok(data);
      }
      if (gm && m === 'DELETE') { await ownGroup(db, user, gm[1]); await db.from('habit_groups').delete().eq('id', gm[1]).eq('user_id', user.id); return ok({ ok: true }); }

      // ── логи и статистика (FREE видит только 7 дней, PRO — до 730)
      if (p === '/api/logs' && m === 'GET') {
        const today = todayIn(user.timezone); const pro = !!(await proUntil(db, user.id));
        const minDay = addDays(today, -(pro ? PRO_MAX_HISTORY_DAYS : FREE_LIMITS.analyticsDays * 4 - 1));
        let from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if (!isDate(from)) from = addDays(today, -30); if (!isDate(to)) to = addDays(today, 3);
        if (from! < minDay) from = minDay;
        const { data } = await db.from('habit_logs').select('habit_id,log_date,value,completed').eq('user_id', user.id).gte('log_date', from!).lte('log_date', to!).limit(10000);
        return ok({ logs: data ?? [], pro, minDay });
      }
      if (p === '/api/stats' && m === 'GET') return ok((await db.rpc('user_stats', { p_user: user.id })).data);

      // ── достижения
      if (p === '/api/achievements' && m === 'GET') {
        const [all, mine] = await Promise.all([db.from('achievements').select('*').order('id'), db.from('user_achievements').select('achievement_id,unlocked_at').eq('user_id', user.id)]);
        const map = new Map((mine.data ?? []).map((u: any) => [u.achievement_id, u.unlocked_at]));
        return ok((all.data ?? []).map((a: any) => ({ ...a, unlocked_at: map.get(a.id) ?? null })));
      }

      // ── таймеры
      if (p === '/api/timers/active' && m === 'GET') {
        const { data } = await db.from('timer_sessions').select('*').eq('user_id', user.id).in('status', ['running', 'paused']).order('started_at', { ascending: false }).limit(1).maybeSingle();
        return ok(data ? timerView(data) : null);
      }
      if (p === '/api/timers' && m === 'POST') {
        const { data: ex } = await db.from('timer_sessions').select('*').eq('user_id', user.id).in('status', ['running', 'paused']).limit(1).maybeSingle();
        if (ex) return ok(timerView(ex));
        let habitId: string | null = null;
        if (body.habit_id) habitId = (await ownHabit(db, user, body.habit_id)).id;
        const dur = Math.min(86400, Math.max(60, Math.floor(Number(body.duration_sec) || 0)));
        const { data } = await db.from('timer_sessions').insert({ user_id: user.id, habit_id: habitId, started_at: new Date().toISOString(), duration_sec: dur }).select().single();
        return ok(timerView(data), 201);
      }
      const tm = p.match(/^\/api\/timers\/([0-9a-f-]{36})\/(pause|resume|adjust|finish|cancel)$/);
      if (tm && m === 'POST') {
        const { data: t } = await db.from('timer_sessions').select('*').eq('id', tm[1]).eq('user_id', user.id).maybeSingle();
        if (!t) throw new HttpError(404, 'timer_not_found');
        if (!['running', 'paused'].includes(t.status)) throw new HttpError(409, 'timer_closed');
        const now = new Date(); const view = timerView(t);
        if (tm[2] === 'pause' && t.status === 'running')
          await db.from('timer_sessions').update({ status: 'paused', elapsed_before_pause_sec: Math.floor(view.elapsed) }).eq('id', t.id);
        if (tm[2] === 'resume' && t.status === 'paused')
          await db.from('timer_sessions').update({ status: 'running', started_at: now.toISOString() }).eq('id', t.id);
        if (tm[2] === 'adjust') {
          const delta = Math.max(-3600, Math.min(3600, Math.floor(Number(body.delta_sec) || 0)));
          await db.from('timer_sessions').update({ duration_sec: Math.max(60, t.duration_sec + delta) }).eq('id', t.id);
        }
        if (tm[2] === 'cancel') { await db.from('timer_sessions').update({ status: 'cancelled' }).eq('id', t.id); return ok({ ok: true }); }
        if (tm[2] === 'finish') {
          const minutes = Math.round(Math.min(view.elapsed, t.duration_sec) / 60 * 100) / 100;
          await db.from('timer_sessions').update({ status: 'finished', completed_at: now.toISOString(), elapsed_before_pause_sec: Math.floor(view.elapsed) }).eq('id', t.id);
          let log = null, unlocked: any[] = [];
          if (t.habit_id && minutes > 0) {
            const h = await ownHabit(db, user, t.habit_id);
            const date = isDate(body.date) ? body.date : todayIn(user.timezone);
            const { data: ex } = await db.from('habit_logs').select('value').eq('habit_id', h.id).eq('log_date', date).maybeSingle();
            log = await writeLog(db, user, h, date, Number(ex?.value ?? 0) + minutes);
            unlocked = await evalAfter(db, user, log.completed, env);
          }
          return ok({ minutes, log, unlocked });
        }
        const { data: fresh } = await db.from('timer_sessions').select('*').eq('id', t.id).single();
        return ok(timerView(fresh));
      }

      // ── челленджи
      if (p === '/api/challenges' && m === 'GET') {
        const { data: mem } = await db.from('challenge_members').select('challenge_id').eq('user_id', user.id);
        const ids = (mem ?? []).map((x: any) => x.challenge_id);
        if (!ids.length) return ok([]);
        const [chs, cnt, prog] = await Promise.all([
          db.from('challenges').select('id,title,icon,color,target_value,duration_days,starts_at,ends_at,status,creator_id').in('id', ids).order('created_at', { ascending: false }),
          db.from('challenge_members').select('challenge_id').in('challenge_id', ids),
          db.from('challenge_progress').select('challenge_id,value').eq('user_id', user.id).in('challenge_id', ids),
        ]);
        return ok((chs.data ?? []).map((c: any) => ({ ...c, members: (cnt.data ?? []).filter((x: any) => x.challenge_id === c.id).length,
          myTotal: (prog.data ?? []).filter((x: any) => x.challenge_id === c.id).reduce((s: number, x: any) => s + Number(x.value), 0), isMine: c.creator_id === user.id })));
      }
      if (p === '/api/challenges' && m === 'POST') {
        const title = String(body.title ?? '').trim().slice(0, 80); if (!title) throw new HttpError(400, 'bad_title');
        const duration = Math.floor(Number(body.duration_days)); if (!(duration >= 1 && duration <= 365)) throw new HttpError(400, 'bad_duration');
        if (!(await proUntil(db, user.id))) {
          const { data: last } = await db.from('challenges').select('created_at').eq('creator_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
          const next = last ? Date.parse(last.created_at) + FREE_LIMITS.freeChallengeCooldownDays * 864e5 : 0; // откат считается от времени создания
          if (next > Date.now()) throw new HttpError(429, 'challenge_cooldown:' + new Date(next).toISOString());
        }
        const ends = new Date(Date.now() + duration * 864e5).toISOString();
        const { data: c, error } = await db.from('challenges').insert({ creator_id: user.id, title, description: body.description ? String(body.description).slice(0, 500) : null,
          icon: String(body.icon ?? 'trophy').slice(0, 40), color: String(body.color ?? 'violet').slice(0, 20), target_value: Math.min(1e6, Math.max(0.01, Number(body.target_value) || 1)), duration_days: duration, ends_at: ends }).select().single();
        if (error) throw new HttpError(400, error.message);
        await db.from('challenge_members').insert({ challenge_id: c.id, user_id: user.id });
        return ok({ id: c.id }, 201);
      }
      if (p === '/api/challenges/join' && m === 'POST') {
        const { data: c } = await db.from('challenges').select('id,title,creator_id,status,ends_at').eq('invite_code', String(body.code ?? '')).maybeSingle();
        if (!c) throw new HttpError(404, 'challenge_not_found');
        if (c.status !== 'active' || Date.parse(c.ends_at) < Date.now()) throw new HttpError(410, 'challenge_finished');
        const { data: already } = await db.from('challenge_members').select('user_id').eq('challenge_id', c.id).eq('user_id', user.id).maybeSingle();
        if (!already) {
          const { count } = await db.from('challenge_members').select('user_id', { count: 'exact', head: true }).eq('challenge_id', c.id);
          if ((count ?? 0) >= CHALLENGE_MAX_MEMBERS) throw new HttpError(409, 'challenge_full');
          await db.from('challenge_members').insert({ challenge_id: c.id, user_id: user.id });
          const { data: cr } = await db.from('users').select('telegram_id,notifications').eq('id', c.creator_id).single();
          if (cr?.notifications && cr.telegram_id !== user.telegram_id) await notify(env, db, cr.telegram_id, `👥 В челлендже «${c.title}» новый участник: ${user.first_name ?? user.username ?? 'пользователь'}`);
        }
        return ok({ id: c.id });
      }
      const cm = p.match(/^\/api\/challenges\/([0-9a-f-]{36})(\/progress)?$/);
      if (cm) {
        const { data: c } = await db.from('challenges').select('*').eq('id', cm[1]).maybeSingle();
        const { data: me } = c ? await db.from('challenge_members').select('user_id').eq('challenge_id', c.id).eq('user_id', user.id).maybeSingle() : { data: null };
        if (!c || !me) throw new HttpError(404, 'challenge_not_found'); // посторонние не видят и не меняют чужие челленджи
        if (!cm[2] && m === 'GET') {
          const [ms, pr] = await Promise.all([
            db.from('challenge_members').select('user_id, users(first_name,username,photo_url)').eq('challenge_id', c.id),
            db.from('challenge_progress').select('user_id,log_date,value').eq('challenge_id', c.id),
          ]);
          const today = todayIn(user.timezone);
          const members = (ms.data ?? []).map((x: any) => {
            const rows = (pr.data ?? []).filter((r: any) => r.user_id === x.user_id);
            return { name: x.users.first_name ?? x.users.username ?? 'Участник', me: x.user_id === user.id,
              total: rows.reduce((s: number, r: any) => s + Number(r.value), 0), today: Number(rows.find((r: any) => r.log_date === today)?.value ?? 0) };
          }).sort((a: any, b: any) => b.total - a.total);
          return ok({ challenge: { id: c.id, title: c.title, description: c.description, icon: c.icon, color: c.color, target_value: c.target_value, duration_days: c.duration_days, starts_at: c.starts_at, ends_at: c.ends_at, status: c.status, invite_code: c.invite_code, isMine: c.creator_id === user.id }, members, today });
        }
        if (cm[2] && m === 'POST') {
          if (c.status !== 'active' || Date.parse(c.ends_at) < Date.now()) throw new HttpError(410, 'challenge_finished');
          const today = todayIn(user.timezone);
          const date = isDate(body.date) ? body.date : today;
          if (date !== today && date !== addDays(today, -1)) throw new HttpError(400, 'bad_date');
          const value = Math.min(1e6, Math.max(0, Number(body.value) || 0));
          await db.from('challenge_progress').upsert({ challenge_id: c.id, user_id: user.id, log_date: date, value }, { onConflict: 'challenge_id,user_id,log_date' });
          return ok({ ok: true });
        }
      }

      // ── рефералы
      if (p === '/api/referrals' && m === 'GET') {
        const { data: refs } = await db.from('referrals').select('status,created_at, invited:users!referrals_invited_user_id_fkey(id,first_name,username)').eq('inviter_id', user.id).order('created_at', { ascending: false }).limit(200);
        const activatedIds = (refs ?? []).filter((r: any) => r.status === 'activated').map((r: any) => r.invited.id);
        let invitedPro = 0;
        if (activatedIds.length) {
          const { data: subs } = await db.from('subscriptions').select('user_id').in('user_id', activatedIds).is('revoked_at', null).gt('expires_at', new Date().toISOString());
          invitedPro = new Set((subs ?? []).map((s: any) => s.user_id)).size;
        }
        const { data: rewards } = await db.from('referral_rewards').select('reward_days,milestone,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
        return ok({ code: refCode(tgUser.id), invited: refs?.length ?? 0, activated: activatedIds.length, invitedPro,
          rewardDays: (rewards ?? []).reduce((s: number, r: any) => s + r.reward_days, 0), rewards: rewards ?? [],
          list: (refs ?? []).slice(0, 50).map((r: any) => ({ name: r.invited.first_name ?? r.invited.username ?? 'Друг', status: r.status, created_at: r.created_at })) });
      }

      // ── оплата
      if (p === '/api/pay/invoice' && m === 'POST') return ok(await createInvoice(env, user, body.plan));
      if (p === '/api/payments' && m === 'GET') return ok((await db.from('payments').select('plan_code,amount,currency,status,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)).data ?? []);

      throw new HttpError(404, 'not_found');
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json(env, { error: status === 500 ? 'server_error' : e.message }, status);
    }
  },
};
