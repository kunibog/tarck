import type { SupabaseClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  ADMIN_OWNER_ID: string;
  ADMIN_TELEGRAM_IDS: string;
  MINIAPP_URL: string;
  ALLOWED_ORIGIN: string;
  BOT_USERNAME: string;
}

export class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

// ───────── Telegram initData ─────────
const enc = new TextEncoder();
async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}

export async function verifyInitData(initData: string, botToken: string, maxAgeSec = 86400) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new HttpError(401, 'no_hash');
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  if (!timingSafeEqual(hex(await hmac(secret, check)), hash)) throw new HttpError(401, 'bad_signature');
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) throw new HttpError(401, 'initdata_expired');
  let user: any = null;
  try { user = JSON.parse(params.get('user') ?? 'null'); } catch { /* */ }
  if (!user?.id) throw new HttpError(401, 'no_user');
  return { user, startParam: params.get('start_param') };
}

// ───────── Telegram Bot API ─────────
export async function tg(env: Env, method: string, body: unknown): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

// Ошибка доставки (бот заблокирован и т.п.) никогда не откатывает основную операцию
// opts.button — подпись кнопки «открыть приложение» под сообщением; opts.html — текст с HTML-разметкой (<b>…</b>)
export async function notify(env: Env, db: SupabaseClient, tgId: number, text: string, opts?: { button?: string; html?: boolean }): Promise<boolean> {
  try {
    const body: any = { chat_id: tgId, text };
    if (opts?.html) body.parse_mode = 'HTML';
    if (opts?.button) body.reply_markup = { inline_keyboard: [[{ text: opts.button, web_app: { url: env.MINIAPP_URL } }]] };
    const res = await tg(env, 'sendMessage', body);
    if (!res.ok && res.error_code === 403) await db.from('users').update({ bot_blocked: true }).eq('telegram_id', tgId);
    return !!res.ok;
  } catch { return false; }
}
export const escHtml = (s: string) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

// Защита от повторных уведомлений: ключ уникален
export async function claim(db: SupabaseClient, userId: string, key: string, type: string) {
  const { error } = await db.from('notifications').insert({ user_id: userId, type, dedupe_key: key, status: 'sent', sent_at: new Date().toISOString() });
  return !error;
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'UTC' });

// ───────── Роли ─────────
export async function roleOf(env: Env, db: SupabaseClient, tgId: number): Promise<'OWNER' | 'ADMIN' | null> {
  if (String(tgId) === String(env.ADMIN_OWNER_ID).trim()) return 'OWNER';
  if ((env.ADMIN_TELEGRAM_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(String(tgId))) return 'ADMIN';
  const { data } = await db.from('admins').select('role').eq('telegram_id', tgId).maybeSingle();
  return (data?.role as any) ?? null;
}

export async function proUntil(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db.rpc('pro_until', { p_user: userId });
  return data ?? null;
}

// ───────── Даты и расписание ─────────
export const tzOk = (tz?: string | null) => { if (!tz) return false; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
export const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const isDate = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

export function isScheduled(h: any, date: string): boolean {
  if (date < h.start_date) return false;
  const s = h.schedule ?? { kind: 'daily' };
  const dow = ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1; // Пн=1
  switch (s.kind) {
    case 'weekdays': return (s.days ?? []).includes(dow);
    case 'interval': {
      const diff = Math.round((Date.parse(date) - Date.parse(h.start_date)) / 864e5);
      return diff % Math.max(1, Number(s.every) || 1) === 0;
    }
    case 'dates': return (s.dates ?? []).includes(date);
    default: return true;
  }
}

// ───────── HTTP ─────────
export function cors(env: Env) {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN,
    'access-control-allow-headers': 'content-type,authorization,x-tz',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'vary': 'origin',
  };
}
export const json = (env: Env, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors(env) } });
