'use strict';
// ───────── Ядро: утилиты, API, состояние, роутер ─────────
const WA = window.Telegram && window.Telegram.WebApp;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const z = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addD = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const dowOf = s => ((parseD(s).getDay() + 6) % 7) + 1; // Пн=1
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtNum = n => { n = +n; return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10).replace('.', ','); };
const fmtDateRu = iso => new Date(iso).toLocaleDateString('ru-RU');
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const m = n % 10; return n > 10 && n < 20 ? c : m > 1 && m < 5 ? b : m === 1 ? a : c; };

function isScheduled(h, date) {
  if (date < h.start_date) return false;
  const s = h.schedule || { kind: 'daily' };
  if (s.kind === 'weekdays') return (s.days || []).includes(dowOf(date));
  if (s.kind === 'interval') return daysBetween(h.start_date, date) % Math.max(1, s.every || 1) === 0;
  if (s.kind === 'dates') return (s.dates || []).includes(date);
  return true;
}
function schedText(h) {
  const s = h.schedule || { kind: 'daily' };
  if (s.kind === 'weekdays') return (s.days || []).map(d => WD[d - 1]).join(', ') || 'Дни не выбраны';
  if (s.kind === 'interval') return `Раз в ${s.every} ${plural(s.every, 'день', 'дня', 'дней')}`;
  if (s.kind === 'dates') return 'Выбранные даты';
  return 'Каждый день';
}

// ───────── Палитры, иконки, темы ─────────
const COLORS = {
  violet: { hex: '#8172F5', name: 'Фиолетовый' }, cyan: { hex: '#22A7E0', name: 'Голубой' }, blue: { hex: '#2F80FF', name: 'Синий' },
  teal: { hex: '#14B8A6', name: 'Бирюзовый' }, green: { hex: '#2FBF5B', name: 'Зелёный' }, yellow: { hex: '#E0A800', name: 'Жёлтый' },
  orange: { hex: '#FF8A00', name: 'Оранжевый' }, pink: { hex: '#EC5BA0', name: 'Розовый' }, red: { hex: '#F0383A', name: 'Красный' },
};
const ICON_SETS = {
  'Здоровье': ['heart', 'heart-pulse', 'activity', 'pill', 'stethoscope', 'smile'],
  'Спорт': ['dumbbell', 'bike', 'footprints', 'trophy', 'medal', 'timer'],
  'Вода': ['droplet', 'droplets', 'glass-water', 'waves', 'cup-soda', 'shower-head'],
  'Сон': ['moon', 'bed', 'bed-double', 'alarm-clock', 'sunrise', 'cloud-moon'],
  'Работа': ['briefcase', 'laptop', 'code', 'mail', 'calendar-check', 'presentation'],
  'Образование': ['book-open', 'graduation-cap', 'languages', 'pencil', 'brain', 'library'],
  'Питание': ['apple', 'salad', 'utensils', 'carrot', 'egg', 'coffee'],
  'Отдых': ['music', 'gamepad-2', 'tv', 'headphones', 'popcorn', 'camera'],
  'Финансы': ['wallet', 'piggy-bank', 'banknote', 'credit-card', 'coins', 'trending-up'],
  'Личные задачи': ['sparkles', 'shirt', 'flower-2', 'dog', 'cat', 'leaf'],
  'Прочее': ['check', 'star', 'flame', 'target', 'zap', 'bookmark'],
};
const THEMES = {
  'default-dark': { name: 'Default Dark', pro: false, v: { bg: '#101114', bg2: '#191A20', card: '#22232B', text: '#FFFFFF', text2: '#9B9DA8', accent: '#8172F5' } },
  'default-light': { name: 'Default Light', pro: false, v: { bg: '#F7F7FA', bg2: '#ECECF2', card: '#FFFFFF', text: '#17171B', text2: '#858590', accent: '#7565EF' } },
  midnight: { name: 'Midnight', pro: true, v: { bg: '#070B1A', bg2: '#0E1530', card: '#16203F', text: '#FFFFFF', text2: '#98A2C3', accent: '#5B8CFF' } },
  violet: { name: 'Violet', pro: true, v: { bg: '#120B1F', bg2: '#1B1230', card: '#271A44', text: '#FFFFFF', text2: '#A99BC4', accent: '#A855F7' } },
  ocean: { name: 'Ocean', pro: true, v: { bg: '#06161C', bg2: '#0B242E', card: '#12333F', text: '#FFFFFF', text2: '#8FB2BD', accent: '#22C7E8' } },
  emerald: { name: 'Emerald', pro: true, v: { bg: '#07150F', bg2: '#0D2218', card: '#143225', text: '#FFFFFF', text2: '#8DB5A2', accent: '#34D399' } },
  sunset: { name: 'Sunset', pro: true, v: { bg: '#1A0F0B', bg2: '#26150F', card: '#36201A', text: '#FFFFFF', text2: '#C0A093', accent: '#FB923C' } },
  rose: { name: 'Rose', pro: true, v: { bg: '#1A0B12', bg2: '#26111B', card: '#361A28', text: '#FFFFFF', text2: '#C49AAE', accent: '#FB7185' } },
  graphite: { name: 'Graphite', pro: true, v: { bg: '#0F0F10', bg2: '#171718', card: '#232325', text: '#FFFFFF', text2: '#A0A0A6', accent: '#A1A1AA' } },
};
function applyTheme(id, vars) {
  const t = vars || (THEMES[id] || THEMES['default-dark']).v;
  const r = document.documentElement.style;
  for (const k of ['bg', 'bg2', 'card', 'text', 'text2', 'accent']) r.setProperty('--' + k, t[k]);
  r.setProperty('--line', t.text === '#FFFFFF' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)');
  try { WA && WA.setHeaderColor(t.bg); WA && WA.setBackgroundColor(t.bg); WA && WA.setBottomBarColor && WA.setBottomBarColor(t.bg); } catch (e) { /* старые клиенты */ }
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t.bg;
}

// ───────── API ─────────
async function api(path, opts) {
  opts = opts || {};
  const r = await fetch(CONFIG.API_URL + path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', authorization: 'tma ' + (WA ? WA.initData : ''), 'x-tz': TZ },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'error'); e.status = r.status; throw e; }
  return j;
}

// ───────── UI-хелперы ─────────
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
const hap = (k) => { try { k === 'ok' ? WA.HapticFeedback.notificationOccurred('success') : WA.HapticFeedback.impactOccurred('light'); } catch (e) { /* */ } };
function sheet(html) { // → Promise<{v, vals}>; кнопки с data-v закрывают лист, поля с name попадают в vals
  return new Promise(res => {
    const o = $('#overlay');
    o.innerHTML = `<div class="sheet">${html}</div>`; o.classList.add('show'); lucide.createIcons();
    const close = v => {
      const vals = {}; o.querySelectorAll('[name]').forEach(el => { vals[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
      o.classList.remove('show'); o.innerHTML = ''; o.onclick = null; res({ v, vals });
    };
    o.onclick = e => { if (e.target === o) return close(null); const b = e.target.closest('[data-v]'); if (b) close(b.dataset.v); };
  });
}
async function confirmBox(text, label, danger) {
  const r = await sheet(`<h2 style="margin-top:0">${esc(text)}</h2><button class="btn ${danger ? 'danger' : ''}" data-v="ok">${esc(label || 'Подтвердить')}</button><div class="gap"></div><button class="btn sec" data-v="no">Отмена</button>`);
  return r.v === 'ok';
}
async function askNumber(title, def, unit) {
  const r = await sheet(`<h2 style="margin-top:0">${esc(title)}</h2><div class="field"><input name="n" type="number" inputmode="decimal" step="any" value="${def == null ? '' : def}" placeholder="${esc(unit || '')}"></div><button class="btn" data-v="ok">Готово</button>`);
  if (r.v !== 'ok') return null; const n = parseFloat(String(r.vals.n).replace(',', '.')); return isNaN(n) ? null : n;
}
const lockHtml = '<i data-lucide="lock"></i>';
const empty = (icon, title, sub, btn) => `<div class="empty"><i data-lucide="${icon}" style="width:42px;height:42px"></i><div><b style="color:var(--text)">${esc(title)}</b></div><div class="small" style="margin:4px 0 14px">${esc(sub || '')}</div>${btn || ''}</div>`;
const skeleton = n => Array.from({ length: n || 4 }, () => '<div class="skel"></div>').join('');
const errBox = (msg, retry) => `<div class="empty"><i data-lucide="wifi-off"></i><div>${esc(msg)}</div><div class="gap"></div><button class="btn sm" data-act="${retry || 'reload'}">Повторить</button></div>`;

function errToast(e) {
  const m = String(e && e.message || '');
  if (m === 'free_limit_habits') return proPrompt(`В бесплатной версии доступно до ${S.me ? S.me.freeLimits.activeHabits : 7} активных привычек.`);
  if (m === 'pro_required' || m === 'free_limit_history') return proPrompt('Эта возможность доступна в Трекер PRO.');
  if (m.startsWith('challenge_cooldown:')) return toast('Следующий бесплатный челлендж можно создать ' + fmtDateRu(m.split(':').slice(1).join(':')));
  const map = { user_not_found: 'Пользователь не найден', rate_limited: 'Слишком часто, подождите', challenge_finished: 'Челлендж уже завершён', challenge_full: 'В челлендже нет мест', challenge_not_found: 'Челлендж не найден', forbidden: 'Нет доступа', owner_only: 'Только для владельца', bad_params: 'Проверьте введённые данные', db_update_failed: 'Не удалось сохранить изменения, попробуйте ещё раз' };
  toast(map[m] || (e.status === 401 ? 'Откройте приложение через Telegram' : 'Ошибка: ' + m));
}
async function proPrompt(text) {
  const r = await sheet(`<h2 style="margin-top:0">Трекер PRO</h2><p class="muted">${esc(text)}</p><button class="btn" data-v="go">Посмотреть PRO</button><div class="gap"></div><button class="btn sec" data-v="no">Не сейчас</button>`);
  if (r.v === 'go') nav('pro');
}

// ───────── Состояние и роутер ─────────
const S = {
  ready: false, loadErr: null, tab: 'habits', view: null, stack: [], me: null, date: today(), habits: [], groups: [], streaks: {}, logs: {}, logFrom: null,
  collapsed: {}, q: '', searchOpen: false, timer: null, form: null,
};
const TABS = {}, VIEWS = {}, AFTER = {}, ACT = {};
function nav(name, params) { S.stack.push(S.view); S.view = Object.assign({ name }, params || {}); S.scrollKey = null; render(); window.scrollTo(0, 0); }
function back() { S.view = S.stack.pop() || null; S.scrollKey = null; render(); }
function setTab(t) { S.tab = t; S.view = null; S.stack = []; render(); window.scrollTo(0, 0); }
const NAV = [['habits', 'list-checks', 'Привычки'], ['analytics', 'bar-chart-3', 'Аналитика'], ['challenges', 'trophy', 'Челленджи'], ['referrals', 'gift', 'Рефералы'], ['profile', 'user-round', 'Профиль']];
const navHtml = () => `<nav class="nav">${NAV.map(n => `<button class="${S.tab === n[0] ? 'on' : ''}" data-act="tab" data-t="${n[0]}"><i data-lucide="${n[1]}"></i>${n[2]}</button>`).join('')}</nav>`;
let tickTimer = null;
function render() {
  const key = S.view ? S.view.name : S.tab; const y = window.scrollY;
  let html;
  try { html = S.view ? VIEWS[S.view.name](S.view) : TABS[S.tab](); } catch (e) { console.error(e); html = errBox('Ошибка отображения'); }
  $('#app').innerHTML = html + (S.view ? '' : navHtml());
  lucide.createIcons();
  if (WA) { try { S.view ? WA.BackButton.show() : WA.BackButton.hide(); } catch (e) { /* */ } }
  if (S.scrollKey === key) window.scrollTo(0, y); S.scrollKey = key;
  clearInterval(tickTimer); tickTimer = null;
  if (AFTER[key]) AFTER[key]();
}
const topBar = (title, right) => `<div class="top"><button class="icon-btn" data-act="back"><i data-lucide="chevron-left"></i></button><div class="title">${esc(title)}</div>${right || '<div style="width:38px"></div>'}</div>`;

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  // Кнопки с сетевыми действиями сразу «нажимаются» (затемнение) и защищены от двойного клика
  const lock = el.classList.contains('btn') || el.classList.contains('icon-btn');
  if (lock) { if (el.dataset.busy) return; el.dataset.busy = '1'; el.classList.add('busy'); }
  try { await fn(el.dataset, el, e); } catch (err) { console.error(err); errToast(err); }
  finally { if (lock) { delete el.dataset.busy; el.classList.remove('busy'); } }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f && S.form) { S.form[t.dataset.f] = t.value; if (ACT.formPreview) ACT.formPreview(); }
  if (t.dataset.q !== undefined) { S.q = t.value; const l = $('#hl'); if (l) { l.innerHTML = habitListHtml(); lucide.createIcons(); } }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.f && S.form) { S.form[t.dataset.f] = t.value; if (t.dataset.re) render(); else if (ACT.formPreview) ACT.formPreview(); }
});
ACT.tab = d => { hap(); setTab(d.t); };
ACT.back = () => back();
ACT.reload = () => boot();
