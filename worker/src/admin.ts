import type { SupabaseClient } from '@supabase/supabase-js';
import { Env, HttpError, notify, fmtDate, proUntil, tg } from './lib';

type Admin = { id: number; role: 'OWNER' | 'ADMIN' };

export async function adminRoute(env: Env, db: SupabaseClient, admin: Admin, path: string, method: string, body: any, url: URL) {
  const ownerOnly = () => { if (admin.role !== 'OWNER') throw new HttpError(403, 'owner_only'); };

  if (path === '/api/admin/me') return { role: admin.role };

  if (path === '/api/admin/dashboard') {
    const cnt = async (q: any) => (await q).count ?? 0;
    const d7 = new Date(Date.now() - 7 * 864e5), d30 = new Date(Date.now() - 30 * 864e5);
    const now = new Date().toISOString();
    const [total, new7, new30, paid, gifts] = await Promise.all([
      cnt(db.from('users').select('id', { count: 'exact', head: true })),
      cnt(db.from('users').select('id', { count: 'exact', head: true }).gte('created_at', d7.toISOString())),
      cnt(db.from('users').select('id', { count: 'exact', head: true }).gte('created_at', d30.toISOString())),
      cnt(db.from('subscriptions').select('id', { count: 'exact', head: true }).eq('source', 'TELEGRAM_STARS')),
      cnt(db.from('subscriptions').select('id', { count: 'exact', head: true }).eq('source', 'ADMIN_GIFT')),
    ]);
    const { data: proRows } = await db.from('subscriptions').select('user_id').is('revoked_at', null).gt('expires_at', now).limit(50000);
    const pro = new Set((proRows ?? []).map((r: any) => r.user_id)).size;
    const { data: act } = await db.from('habit_logs').select('user_id').gte('log_date', d7.toISOString().slice(0, 10)).limit(50000);
    const active = new Set((act ?? []).map((r: any) => r.user_id)).size;
    const [lu, lg, lp, ll] = await Promise.all([
      db.from('users').select('telegram_id,username,first_name,created_at').order('created_at', { ascending: false }).limit(5),
      db.from('subscriptions').select('days,expires_at,reason,created_at, users(telegram_id,username)').eq('source', 'ADMIN_GIFT').order('created_at', { ascending: false }).limit(5),
      db.from('payments').select('amount,plan_code,status,created_at, users(telegram_id,username)').order('created_at', { ascending: false }).limit(5),
      db.from('admin_action_log').select('*').order('created_at', { ascending: false }).limit(5),
    ]);
    return { total, active, pro, free: total - pro, paidSubscriptions: paid, giftSubscriptions: gifts, new7, new30,
      lastUsers: lu.data, lastGifts: lg.data, lastPayments: lp.data, lastLogs: admin.role === 'OWNER' ? ll.data : [] };
  }

  if (path === '/api/admin/users' && method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().replace(/[%,()*]/g, '').slice(0, 64);
    let query = db.from('users').select('telegram_id,username,first_name,created_at').order('created_at', { ascending: false }).limit(25);
    if (q) query = /^\d+$/.test(q) ? query.eq('telegram_id', Number(q)) : query.or(`username.ilike.%${q.replace('@', '')}%,first_name.ilike.%${q}%`);
    return (await query).data ?? [];
  }

  const um = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (um) {
    const { data: u } = await db.from('users').select('id,telegram_id,username,first_name,created_at').eq('telegram_id', Number(um[1])).maybeSingle();
    if (!u) throw new HttpError(404, 'user_not_found');
    const [habits, ach, subs, refs, ch] = await Promise.all([
      db.from('habits').select('id', { count: 'exact', head: true }).eq('user_id', u.id).is('deleted_at', null),
      db.from('user_achievements').select('achievement_id', { count: 'exact', head: true }).eq('user_id', u.id),
      db.from('subscriptions').select('source,days,started_at,expires_at,revoked_at,reason,created_at').eq('user_id', u.id).order('created_at', { ascending: false }).limit(50),
      db.from('referrals').select('status').eq('inviter_id', u.id),
      db.from('challenge_members').select('challenge_id', { count: 'exact', head: true }).eq('user_id', u.id),
    ]);
    const { id, ...pub } = u;
    return { user: pub, proUntil: await proUntil(db, id), habits: habits.count, achievements: ach.count, subscriptions: subs.data,
      referrals: { total: refs.data?.length ?? 0, activated: (refs.data ?? []).filter((r: any) => r.status === 'activated').length }, challenges: ch.count };
  }

  if (path === '/api/admin/subscriptions' && method === 'GET') {
    const filter = url.searchParams.get('filter') ?? 'all';
    const now = new Date().toISOString();
    let q = db.from('subscriptions').select('days,started_at,expires_at,revoked_at,reason,granted_by_telegram_id,created_at, users(telegram_id,username)')
      .eq('source', 'ADMIN_GIFT').order('created_at', { ascending: false }).limit(100);
    if (filter === 'active') q = q.is('revoked_at', null).gt('expires_at', now);
    if (filter === 'expired') q = q.or(`expires_at.lte.${now},revoked_at.not.is.null`);
    return (await q).data ?? [];
  }

  // Выдача и продление — одна атомарная операция (extend = grant): срок всегда прибавляется
  if ((path === '/api/admin/subscriptions/grant' || path === '/api/admin/subscriptions/extend') && method === 'POST') {
    const tgId = Number(body.telegramId);
    let days = Number(body.days);
    if (body.untilDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.untilDate)) throw new HttpError(400, 'bad_date');
      days = Math.ceil((Date.parse(body.untilDate + 'T23:59:59Z') - Date.now()) / 864e5);
    }
    if (!Number.isInteger(tgId) || !Number.isInteger(days) || days < 1 || days > 3650) throw new HttpError(400, 'bad_params');
    const idem = String(body.idempotencyKey ?? '');
    if (idem.length < 8 || idem.length > 80) throw new HttpError(400, 'idempotency_key_required');
    const reason = body.reason ? String(body.reason).slice(0, 300) : null;
    const { data, error } = await db.rpc('admin_grant_pro', { p_target_tg: tgId, p_days: days, p_admin_tg: admin.id, p_reason: reason, p_idem: `grant:${idem}` });
    if (error) throw new HttpError(error.message.includes('user_not_found') ? 404 : 400, error.message.includes('user_not_found') ? 'user_not_found' : error.message);
    if (!data.duplicate) { // уведомление — только после успешного коммита
      const until = fmtDate(data.pro_until ?? data.expires_at);
      await notify(env, db, tgId, data.extended
        ? `✨ Ваш Трекер PRO продлён!\n\nНовая дата окончания подписки: ${until}.`
        : `🎉 Вам подарили Трекер PRO!\n\nТеперь вам доступны расширенные возможности приложения.\n\nВаш Premium действует до: ${until}.\n\nПриятного использования!`);
    }
    return data;
  }

  if (path === '/api/admin/subscriptions/revoke' && method === 'POST') {
    const { data, error } = await db.rpc('admin_revoke_gifts', { p_target_tg: Number(body.telegramId), p_admin_tg: admin.id, p_reason: body.reason ? String(body.reason).slice(0, 300) : null });
    if (error) throw new HttpError(error.message.includes('user_not_found') ? 404 : 400, error.message.includes('user_not_found') ? 'user_not_found' : error.message);
    return data;
  }

  if (path === '/api/admin/logs') {
    ownerOnly();
    return (await db.from('admin_action_log').select('*').order('created_at', { ascending: false }).limit(200)).data ?? [];
  }

  if (path === '/api/admin/payments' && method === 'GET') {
    return (await db.from('payments').select('amount,currency,plan_code,status,telegram_charge_id,created_at, users(telegram_id,username)').order('created_at', { ascending: false }).limit(100)).data ?? [];
  }

  // Возврат Stars через официальный метод refundStarPayment (только OWNER)
  if (path === '/api/admin/payments/refund' && method === 'POST') {
    ownerOnly();
    const { data: pay } = await db.from('payments').select('id,status,telegram_charge_id, users(telegram_id)').eq('telegram_charge_id', String(body.chargeId ?? '')).maybeSingle();
    if (!pay) throw new HttpError(404, 'payment_not_found');
    if (pay.status === 'refunded') throw new HttpError(400, 'already_refunded');
    const uid = (pay as any).users.telegram_id;
    const r = await tg(env, 'refundStarPayment', { user_id: uid, telegram_payment_charge_id: pay.telegram_charge_id });
    if (!r.ok) throw new HttpError(502, r.description ?? 'refund_failed');
    await db.from('payments').update({ status: 'refunded' }).eq('id', pay.id);
    await db.from('subscriptions').update({ revoked_at: new Date().toISOString() }).eq('telegram_charge_id', pay.telegram_charge_id);
    await db.from('admin_action_log').insert({ admin_telegram_id: admin.id, target_telegram_id: uid, action_type: 'REFUND_PAYMENT', new_state: { charge: pay.telegram_charge_id } });
    return { ok: true };
  }

  if (path === '/api/admin/administrators') {
    ownerOnly();
    if (method === 'GET') return (await db.from('admins').select('*')).data ?? [];
    if (method === 'POST') {
      const id = Number(body.telegramId);
      if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'bad_id');
      await db.from('admins').upsert({ telegram_id: id, role: 'ADMIN', added_by: admin.id });
      await db.from('admin_action_log').insert({ admin_telegram_id: admin.id, target_telegram_id: id, action_type: 'ADD_ADMIN', new_state: { role: 'ADMIN' } });
      return { ok: true };
    }
  }
  const da = path.match(/^\/api\/admin\/administrators\/(\d+)$/);
  if (da && method === 'DELETE') {
    ownerOnly();
    await db.from('admins').delete().eq('telegram_id', Number(da[1]));
    await db.from('admin_action_log').insert({ admin_telegram_id: admin.id, target_telegram_id: Number(da[1]), action_type: 'REMOVE_ADMIN' });
    return { ok: true };
  }
  throw new HttpError(404, 'not_found');
}
