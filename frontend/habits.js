'use strict';
// ───────── Привычки: список, форма, таймер ─────────
async function loadHabits() {
  const d = await api('/api/habits');
  S.habits = d.habits; S.streaks = d.streaks; S.groups = d.groups;
}
async function loadLogs(from, to) {
  const d = await api(`/api/logs?from=${from}&to=${to}`);
  for (const l of d.logs) S.logs[l.habit_id + '|' + l.log_date] = l;
  return d;
}
async function loadTimer() { const t = await api('/api/timers/active'); setTimer(t); }
function setTimer(t) { S.timer = t ? Object.assign({}, t, { elapsed0: t.elapsed, fetchedAt: Date.now() }) : null; }
const timerElapsed = () => S.timer.elapsed0 + (S.timer.status === 'running' ? (Date.now() - S.timer.fetchedAt) / 1000 : 0);

const hexOf = c => (COLORS[c] || COLORS.violet).hex;
function cardHtml(h, opt) {
  opt = opt || {};
  const l = opt.preview ? null : S.logs[h.id + '|' + S.date];
  const v = l ? +l.value : 0, done = !!(l && l.completed);
  const pct = h.type === 'boolean' ? (done ? 100 : 0) : Math.min(100, v / (h.target_value || 1) * 100);
  const sched = h.schedKind ? schedText({ schedule: schedFromForm(h) }) : schedText(h);
  const unit = h.type === 'duration' ? 'мин' : (h.unit || '');
  const sub = sched + (h.type === 'boolean' ? '' : `, ${fmtNum(v)}/${fmtNum(h.target_value || 1)} ${esc(unit)}`);
  const st = (S.streaks[h.id] || 0);
  let btn;
  if (opt.preview) btn = '<div class="act"><i data-lucide="check"></i></div>';
  else if (h.type === 'boolean') btn = `<button class="act ${done ? 'done' : ''}" style="${done ? '' : 'opacity:.55'}" data-act="toggle" data-id="${h.id}"><i data-lucide="check"></i></button>`;
  else if (done) btn = `<button class="act done" data-act="card" data-id="${h.id}"><i data-lucide="check"></i></button>`;
  else if (h.type === 'duration') btn = `<button class="act" data-act="timer" data-id="${h.id}"><i data-lucide="play"></i></button>`;
  else if (h.type === 'counter') btn = `<button class="act" data-act="inc" data-id="${h.id}"><i data-lucide="plus"></i></button>`;
  else btn = `<button class="act" data-act="add" data-id="${h.id}"><i data-lucide="plus"></i></button>`;
  return `<div class="hcard" style="--c:${hexOf(h.color)};--p:${pct}%" ${opt.preview ? '' : `data-act="card" data-id="${h.id}"`}>
    ${st > 0 && !opt.preview ? `<span class="streak"><i data-lucide="flame"></i>${st}</span>` : ''}
    <i data-lucide="${esc(h.icon || 'check')}" style="width:26px;height:26px;flex:none;margin-left:6px"></i>
    <div class="body"><div class="t">${esc(h.title || 'Новая привычка')}</div><div class="s">${esc(sub)}</div></div>${btn}</div>`;
}

function habitListHtml() {
  const d = S.date, q = S.q.trim().toLowerCase();
  const list = S.habits.filter(h => isScheduled(h, d) && (!q || h.title.toLowerCase().includes(q)));
  if (!S.habits.length) return empty('sparkles', 'Привычек пока нет', 'Создайте первую — это займёт полминуты', '<button class="btn" data-act="new" style="width:auto;display:inline-flex">Создать привычку</button>');
  if (!list.length) return empty('calendar-x', q ? 'Ничего не найдено' : 'На этот день привычек нет', q ? 'Попробуйте другой запрос' : 'Выберите другой день');
  const groups = [...S.groups.map(g => ({ id: g.id, title: g.title })), { id: null, title: 'Без группы' }];
  return groups.map(g => {
    const items = list.filter(h => (h.group_id || null) === g.id); if (!items.length) return '';
    if (g.id === null && S.groups.length === 0) return items.map(cardHtml).join('');
    const closed = S.collapsed[g.id || 'none'];
    const doneN = items.filter(h => (S.logs[h.id + '|' + d] || {}).completed).length;
    return `<div class="group"><div class="group-h"><button class="row sp" data-act="gtoggle" data-g="${g.id || 'none'}" style="text-align:left"><b>${esc(g.title)}</b><span class="muted small">${doneN}/${items.length}</span></button>
      ${g.id ? `<button data-act="gmenu" data-g="${g.id}"><i data-lucide="more-horizontal"></i></button>` : ''}
      <button data-act="gtoggle" data-g="${g.id || 'none'}"><i data-lucide="${closed ? 'chevron-down' : 'chevron-up'}"></i></button></div>${closed ? '' : items.map(cardHtml).join('')}</div>`;
  }).join('');
}

TABS.habits = () => {
  if (S.loadErr) return errBox(S.loadErr);
  if (!S.ready) return `<h1>TRAKROBOT</h1>${skeleton(5)}`;
  const t = today(), maxStreak = Math.max(0, ...Object.values(S.streaks));
  const days = []; for (let i = -20; i <= 3; i++) days.push(addD(t, i));
  const has = new Set(Object.values(S.logs).filter(l => l.completed).map(l => l.log_date));
  const nm = (S.me.user.first_name || '').trim();
  const dd = parseD(S.date);
  return `<div class="top"><div class="sp"><div class="muted small">${S.date === t ? 'Сегодня' : WD_FULL[dowOf(S.date) - 1]}, ${dd.getDate()} ${MONTHS[dd.getMonth()]}</div>
      <div style="font-size:20px;font-weight:700">${nm ? 'Привет, ' + esc(nm) : 'Привычки'} <span style="color:#FF9500;font-size:15px"><i data-lucide="flame" style="width:15px;height:15px"></i> ${maxStreak}</span></div></div>
    <button class="icon-btn" data-act="search"><i data-lucide="search"></i></button><button class="icon-btn" style="background:var(--accent)" data-act="new"><i data-lucide="plus"></i></button></div>
    ${S.searchOpen ? `<div class="field"><input data-q placeholder="Поиск привычек" value="${esc(S.q)}" autofocus></div>` : ''}
    ${S.timer ? `<button class="card row" style="width:100%;text-align:left" data-act="opentimer"><i data-lucide="timer"></i><span class="sp">Идёт таймер: ${esc((S.habits.find(h => h.id === S.timer.habit_id) || {}).title || 'без привычки')}</span><i data-lucide="chevron-right"></i></button>` : ''}
    <div class="scroll-x" id="days">${days.map(x => `<button class="day ${x === S.date ? 'sel' : ''} ${has.has(x) ? 'has' : ''}" data-act="day" data-d="${x}" ${x === S.date ? 'id="seld"' : ''}>${WD[dowOf(x) - 1]}<b>${parseD(x).getDate()}</b></button>`).join('')}</div>
    <div id="hl">${habitListHtml()}</div>`;
};
AFTER.habits = () => { const s = $('#seld'); if (s && $('#days')) $('#days').scrollLeft = s.offsetLeft - $('#days').clientWidth / 2 + 23; };

ACT.search = () => { S.searchOpen = !S.searchOpen; if (!S.searchOpen) S.q = ''; render(); };
ACT.gtoggle = d => { S.collapsed[d.g] = !S.collapsed[d.g]; render(); };
ACT.day = async d => {
  S.date = d.d; hap();
  if (S.logFrom && d.d < S.logFrom) { const from = addD(d.d, -14); await loadLogs(from, S.logFrom); S.logFrom = from; }
  render();
};
ACT.opentimer = () => nav('timer', { habitId: S.timer.habit_id });

async function setValue(h, value, date) {
  date = date || S.date; const key = h.id + '|' + date;
  const completed = h.type === 'boolean' ? value > 0 : value >= h.target_value;
  const prev = S.logs[key]; S.logs[key] = { habit_id: h.id, log_date: date, value, completed }; render(); hap(completed ? 'ok' : 'l');
  try {
    const r = await api(`/api/habits/${h.id}/log`, { method: 'POST', body: { date, value } });
    S.logs[key] = r.log;
    if (r.unlocked && r.unlocked.length) toast('🏆 Достижение: ' + r.unlocked.map(a => a.title).join(', '));
    loadHabits().then(render).catch(() => { });
  } catch (e) { if (prev) S.logs[key] = prev; else delete S.logs[key]; render(); throw e; }
  render();
}
const hById = id => S.habits.find(h => h.id === id);
const curVal = h => +((S.logs[h.id + '|' + S.date] || {}).value || 0);
ACT.toggle = d => { const h = hById(d.id); return setValue(h, curVal(h) > 0 ? 0 : 1); };
ACT.inc = d => { const h = hById(d.id); return setValue(h, curVal(h) + 1); };
ACT.add = async d => {
  const h = hById(d.id); const n = await askNumber(`Сколько добавить? (${h.unit || 'ед.'})`, '', h.unit); if (n == null || n <= 0) return;
  return setValue(h, curVal(h) + n);
};
ACT.card = async d => {
  const h = hById(d.id); if (!h) return;
  const items = [['edit', 'pencil', 'Изменить']];
  if (h.type !== 'boolean') items.push(['setv', 'hash', 'Ввести значение']);
  if (h.type === 'duration') items.push(['timer', 'play', 'Запустить таймер']);
  items.push(['reset', 'rotate-ccw', 'Отменить выполнение за день'], ['up', 'arrow-up', 'Выше'], ['down', 'arrow-down', 'Ниже'], ['arch', 'archive', 'В архив'], ['del', 'trash-2', 'Удалить']);
  const r = await sheet(`<h2 style="margin-top:0">${esc(h.title)}</h2>${items.map(i => `<button class="item" data-v="${i[0]}"><i data-lucide="${i[1]}"></i>${i[2]}</button>`).join('')}`);
  switch (r.v) {
    case 'edit': return openForm(h);
    case 'setv': { const n = await askNumber(`Значение за день (${h.type === 'duration' ? 'мин' : h.unit || 'ед.'})`, curVal(h)); if (n != null && n >= 0) return setValue(h, n); return; }
    case 'timer': return ACT.timer({ id: h.id });
    case 'reset': return setValue(h, 0);
    case 'up': case 'down': return moveHabit(h, r.v === 'up' ? -1 : 1);
    case 'arch': await api('/api/habits/' + h.id, { method: 'PATCH', body: { is_archived: true } }); await loadHabits(); toast('Привычка в архиве'); return render();
    case 'del':
      if (await confirmBox(`Удалить «${h.title}»? История выполнений сохранится.`, 'Удалить', true)) { await api('/api/habits/' + h.id, { method: 'DELETE' }); await loadHabits(); render(); }
  }
};
async function moveHabit(h, dir) {
  const peers = S.habits.filter(x => (x.group_id || null) === (h.group_id || null)).sort((a, b) => a.sort_order - b.sort_order);
  const i = peers.findIndex(x => x.id === h.id), j = i + dir; if (j < 0 || j >= peers.length) return;
  const o = peers[j]; const a = h.sort_order, b = o.sort_order;
  const [sa, sb] = a === b ? [a + dir, b] : [b, a];
  await Promise.all([api('/api/habits/' + h.id, { method: 'PATCH', body: { sort_order: sa } }), api('/api/habits/' + o.id, { method: 'PATCH', body: { sort_order: sb } })]);
  await loadHabits(); render();
}
ACT.gmenu = async d => {
  const g = S.groups.find(x => x.id === d.g);
  const r = await sheet(`<h2 style="margin-top:0">${esc(g.title)}</h2><button class="item" data-v="ren"><i data-lucide="pencil"></i>Переименовать</button><button class="item" data-v="del"><i data-lucide="trash-2"></i>Удалить группу (привычки останутся)</button>`);
  if (r.v === 'ren') { const x = await sheet(`<h2 style="margin-top:0">Название группы</h2><div class="field"><input name="t" value="${esc(g.title)}" maxlength="40"></div><button class="btn" data-v="ok">Сохранить</button>`); if (x.v === 'ok' && x.vals.t.trim()) { await api('/api/groups/' + g.id, { method: 'PATCH', body: { title: x.vals.t } }); await loadHabits(); render(); } }
  if (r.v === 'del' && await confirmBox('Удалить группу?', 'Удалить', true)) { await api('/api/groups/' + g.id, { method: 'DELETE' }); await loadHabits(); render(); }
};
async function newGroup() {
  const x = await sheet(`<h2 style="margin-top:0">Новая группа</h2><div class="chips" style="margin-bottom:12px">${['Утро', 'Здоровье', 'Работа', 'Образование', 'Вечер'].map(n => `<button class="chip" data-v="p:${n}">${n}</button>`).join('')}</div><div class="field"><input name="t" maxlength="40" placeholder="Своё название"></div><button class="btn" data-v="ok">Создать</button>`);
  let title = null; if (x.v && x.v.startsWith('p:')) title = x.v.slice(2); else if (x.v === 'ok') title = x.vals.t.trim();
  if (title) { await api('/api/groups', { method: 'POST', body: { title } }); await loadHabits(); render(); }
  return title;
}

// ───────── Форма привычки ─────────
function schedFromForm(f) {
  if (f.schedKind === 'weekdays') return { kind: 'weekdays', days: f.days };
  if (f.schedKind === 'interval') return { kind: 'interval', every: Math.max(1, parseInt(f.every) || 1) };
  if (f.schedKind === 'dates') return { kind: 'dates', dates: f.dates };
  return { kind: 'daily' };
}
function openForm(h) {
  const s = h && h.schedule || { kind: 'daily' };
  S.form = h ? { id: h.id, title: h.title, description: h.description || '', icon: h.icon, color: h.color, type: h.type, target_value: h.target_value, unit: h.unit || '', schedKind: s.kind, days: s.days || [1, 2, 3, 4, 5, 6, 7], every: s.every || 2, dates: s.dates || [], remind_at: (h.remind_at || '').slice(0, 5), group_id: h.group_id || '', start_date: h.start_date }
    : { title: '', description: '', icon: 'check', color: 'violet', type: 'boolean', target_value: 1, unit: '', schedKind: 'daily', days: [1, 2, 3, 4, 5, 6, 7], every: 2, dates: [], remind_at: '', group_id: '', start_date: today() };
  nav('form');
}
ACT.new = () => {
  if (S.me && !S.me.isPro && S.habits.length >= S.me.freeLimits.activeHabits) return proPrompt(`В бесплатной версии доступно до ${S.me.freeLimits.activeHabits} активных привычек.`);
  openForm(null);
};
ACT.formPreview = () => { const p = $('#prev'); if (p) { p.innerHTML = cardHtml(formHabit(), { preview: true }); lucide.createIcons(); } };
function formHabit() { const f = S.form; return Object.assign({}, f, { target_value: f.type === 'boolean' ? 1 : (parseFloat(String(f.target_value).replace(',', '.')) || 1), unit: f.type === 'duration' ? 'мин' : f.unit }); }

VIEWS.form = () => {
  const f = S.form, cat = f.cat || 'Прочее';
  const seg = (key, opts) => `<div class="seg">${opts.map(o => `<button class="${f[key] === o[0] ? 'on' : ''}" data-act="fset" data-k="${key}" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>`;
  return `${top(f.id ? 'Изменить привычку' : 'Новая привычка', '<button class="icon-btn" style="background:var(--accent)" data-act="fsave"><i data-lucide="check"></i></button>')}
  <div id="prev">${cardHtml(formHabit(), { preview: true })}</div><div class="gap"></div>
  <div class="field"><label>Название</label><input data-f="title" maxlength="100" value="${esc(f.title)}" placeholder="Например: Читать книгу"></div>
  <div class="field"><label>Цвет</label><div class="grid g9">${Object.entries(COLORS).map(([k, c]) => `<button class="dot ${f.color === k ? 'on' : ''}" style="background:${c.hex}" data-act="fset" data-k="color" data-v="${k}" title="${c.name}"></button>`).join('')}</div></div>
  <div class="field"><label>Иконка</label><div class="scroll-x">${Object.keys(ICON_SETS).map(k => `<button class="chip ${k === cat ? 'on' : ''}" data-act="fset" data-k="cat" data-v="${k}">${k}</button>`).join('')}</div>
    <div class="grid g6">${ICON_SETS[cat].map(i => `<button class="pick ${f.icon === i ? 'on' : ''}" data-act="fset" data-k="icon" data-v="${i}"><i data-lucide="${i}"></i></button>`).join('')}</div></div>
  <div class="field"><label>Тип</label>${seg('type', [['boolean', 'Выполнено'], ['quantity', 'Количество'], ['duration', 'Время'], ['counter', 'Счётчик']])}</div>
  ${f.type !== 'boolean' ? `<div class="grid g2"><div class="field"><label>Цель${f.type === 'duration' ? ' (минут)' : ''}</label><input data-f="target_value" type="number" inputmode="decimal" step="any" min="0" value="${esc(f.target_value)}"></div>
    ${f.type === 'duration' ? '' : `<div class="field"><label>Единица</label><input data-f="unit" maxlength="20" value="${esc(f.unit)}" placeholder="мл, раз, стр."></div>`}</div>` : ''}
  <div class="field"><label>Расписание</label>${seg('schedKind', [['daily', 'Каждый день'], ['weekdays', 'Дни недели'], ['interval', 'Через N дней'], ['dates', 'Даты']]).replace(/data-act="fset"/g, 'data-act="fset" data-re="1"')}</div>
  ${f.schedKind === 'weekdays' ? `<div class="chips" style="margin-bottom:12px">${WD.map((n, i) => `<button class="chip ${f.days.includes(i + 1) ? 'on' : ''}" data-act="fdow" data-d="${i + 1}">${n}</button>`).join('')}</div>` : ''}
  ${f.schedKind === 'interval' ? `<div class="field"><label>Повторять каждые N дней</label><input data-f="every" type="number" min="1" max="365" value="${esc(f.every)}"></div>` : ''}
  ${f.schedKind === 'dates' ? `<div class="field"><div class="row"><input id="dpick" type="date"><button class="btn sm" data-act="fadddate">Добавить</button></div><div class="chips" style="margin-top:8px">${f.dates.map(d => `<button class="chip" data-act="fdeldate" data-d="${d}">${fmtDateRu(d)} ✕</button>`).join('')}</div></div>` : ''}
  <div class="grid g2"><div class="field"><label>Начало</label><input data-f="start_date" type="date" value="${esc(f.start_date)}"></div><div class="field"><label>Напоминание</label><input data-f="remind_at" type="time" value="${esc(f.remind_at)}"></div></div>
  <div class="field"><label>Группа</label><select data-f="group_id"><option value="">Без группы</option>${S.groups.map(g => `<option value="${g.id}" ${f.group_id === g.id ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}</select>
    <button class="btn sec sm" style="margin-top:8px" data-act="fnewgroup">+ Новая группа</button></div>
  <div class="field"><label>Описание</label><textarea data-f="description" rows="2" maxlength="500">${esc(f.description)}</textarea></div>
  <button class="btn" data-act="fsave">${f.id ? 'Сохранить' : 'Создать привычку'}</button>`;
};
ACT.fset = (d, el) => {
  const f = S.form;
  if (d.k === 'type') { f.type = d.v; if (d.v === 'duration' && f.target_value <= 1) f.target_value = 30; if (d.v === 'boolean') f.target_value = 1; if (d.v === 'counter' && !f.unit) f.unit = 'раз'; if (d.v === 'quantity' && f.target_value <= 1) f.target_value = 2000; }
  else f[d.k] = d.v;
  render();
};
ACT.fdow = d => { const f = S.form, n = +d.d; f.days = f.days.includes(n) ? f.days.filter(x => x !== n) : [...f.days, n].sort(); render(); };
ACT.fadddate = () => { const v = $('#dpick').value; if (v && !S.form.dates.includes(v)) { S.form.dates.push(v); S.form.dates.sort(); render(); } };
ACT.fdeldate = d => { S.form.dates = S.form.dates.filter(x => x !== d.d); render(); };
ACT.fnewgroup = async () => { const t = await newGroup(); if (t) { const g = S.groups.find(x => x.title === t); if (g) S.form.group_id = g.id; render(); } };
ACT.fsave = async () => {
  const f = formHabit(); if (!f.title.trim()) return toast('Введите название');
  if (S.form.schedKind === 'weekdays' && !S.form.days.length) return toast('Выберите дни недели');
  if (S.form.schedKind === 'dates' && !S.form.dates.length) return toast('Добавьте хотя бы одну дату');
  const body = { title: f.title.trim(), description: f.description, icon: f.icon, color: f.color, type: f.type, target_value: f.target_value, unit: f.unit, schedule: schedFromForm(S.form), remind_at: f.remind_at || null, group_id: f.group_id || null, start_date: f.start_date || today() };
  if (S.form.id) await api('/api/habits/' + S.form.id, { method: 'PATCH', body }); else await api('/api/habits', { method: 'POST', body });
  await loadHabits(); hap('ok'); toast(S.form.id ? 'Сохранено' : 'Привычка создана'); back();
};

// ───────── Таймер ─────────
ACT.timer = async d => {
  const h = hById(d.id);
  if (S.timer && S.timer.habit_id !== h.id) return nav('timer', { habitId: S.timer.habit_id });
  S.tmSel = Math.max(1, Math.round(h.target_value - curVal(h))) || 10; nav('timer', { habitId: h.id });
};
const RING_C = 2 * Math.PI * 54;
VIEWS.timer = v => {
  const h = hById(v.habitId) || {}, c = hexOf(h.color), t = S.timer;
  const dur = t ? t.duration : S.tmSel * 60;
  const rem = t ? Math.max(0, t.duration - timerElapsed()) : dur;
  const mm = Math.floor(rem / 60), ss = Math.floor(rem % 60);
  const ctl = !t ? `<div class="row" style="justify-content:center;margin-bottom:12px"><button class="btn sec sm" data-act="tmsel" data-n="-1">− 1 мин</button><button class="btn sec sm" data-act="tmsel" data-n="1">+ 1 мин</button><button class="btn sm" style="background:${c}" data-act="tmsel" data-n="5">+ 5 мин</button></div><button class="btn" style="background:${c}" data-act="tmstart"><i data-lucide="play"></i>Запустить таймер</button>`
    : `<div class="row" style="margin-bottom:10px"><button class="btn sec sm sp" data-act="tmadj" data-n="-60">− 1 мин</button><button class="btn sec sm sp" data-act="tmadj" data-n="60">+ 1 мин</button><button class="btn sm sp" style="background:${c}" data-act="tmadj" data-n="300">+ 5 мин</button></div>
       <div class="row"><button class="btn sec" data-act="tmcancel"><i data-lucide="x"></i>Сброс</button>${t.status === 'running' ? `<button class="btn" style="background:${c}" data-act="tmpause"><i data-lucide="pause"></i>Пауза</button>` : `<button class="btn" style="background:${c}" data-act="tmresume"><i data-lucide="play"></i>Продолжить</button>`}</div>
       <div class="gap"></div><button class="btn sec" data-act="tmfinish"><i data-lucide="flag"></i>Завершить и засчитать</button>`;
  return `${top(h.title || 'Таймер')}<div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="var(--card)" stroke-width="9"/><circle id="tmring" cx="60" cy="60" r="54" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C * (1 - rem / dur)}"/></svg><div class="tm" id="tmtext">${z(mm)}:${z(ss)}</div></div>
  <div class="center muted small" style="margin-bottom:14px">Таймер хранится на сервере и продолжит идти, даже если вы закроете приложение</div>${ctl}`;
};
AFTER.timer = () => {
  if (!S.timer) return; S.tmAuto = false;
  tickTimer = setInterval(() => {
    if (!S.timer) return; const rem = Math.max(0, S.timer.duration - timerElapsed());
    const tx = $('#tmtext'), rg = $('#tmring'); if (!tx) return;
    tx.textContent = `${z(Math.floor(rem / 60))}:${z(Math.floor(rem % 60))}`; rg.setAttribute('stroke-dashoffset', RING_C * (1 - rem / S.timer.duration));
    if (rem <= 0 && S.timer.status === 'running' && !S.tmAuto) { S.tmAuto = true; hap('ok'); ACT.tmfinish().catch(errToast); }
  }, 250);
};
ACT.tmsel = d => { S.tmSel = Math.min(600, Math.max(1, S.tmSel + +d.n)); render(); };
ACT.tmstart = async () => { setTimer(await api('/api/timers', { method: 'POST', body: { habit_id: S.view.habitId, duration_sec: S.tmSel * 60 } })); hap(); render(); };
const tmCall = async (a, body) => { setTimer(await api(`/api/timers/${S.timer.id}/${a}`, { method: 'POST', body: body || {} })); render(); };
ACT.tmpause = () => tmCall('pause'); ACT.tmresume = () => tmCall('resume');
ACT.tmadj = d => tmCall('adjust', { delta_sec: +d.n });
ACT.tmcancel = async () => { if (!(await confirmBox('Сбросить таймер?', 'Сбросить', true))) return; await api(`/api/timers/${S.timer.id}/cancel`, { method: 'POST' }); S.timer = null; render(); };
ACT.tmfinish = async () => {
  const r = await api(`/api/timers/${S.timer.id}/finish`, { method: 'POST', body: { date: today() } });
  S.timer = null; if (r.log) S.logs[r.log.habit_id + '|' + r.log.log_date] = r.log;
  toast(`Засчитано: ${fmtNum(r.minutes)} мин`); hap('ok');
  if (r.unlocked && r.unlocked.length) toast('🏆 ' + r.unlocked.map(a => a.title).join(', '));
  loadHabits().then(render).catch(() => { }); back();
};
