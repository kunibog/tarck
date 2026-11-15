'use strict';
// ───────── Аналитика ─────────
S.an = { period: 7, data: null };
const pctOf = (d, e) => e ? Math.round(d / e * 100) : 0;
function calc(logs, from, to) {
  const lm = {}; logs.forEach(l => { lm[l.habit_id + '|' + l.log_date] = l; });
  const days = [], wd = Array.from({ length: 7 }, () => ({ e: 0, d: 0 })), ph = {}; let E = 0, D = 0;
  for (let d = from; d <= to; d = addD(d, 1)) {
    let e = 0, dn = 0;
    for (const h of S.habits) {
      if (!isScheduled(h, d)) continue; e++; const ok = !!(lm[h.id + '|' + d] && lm[h.id + '|' + d].completed); if (ok) dn++;
      const p = ph[h.id] || (ph[h.id] = { e: 0, d: 0 }); p.e++; if (ok) p.d++;
    }
    days.push({ date: d, e, d: dn }); E += e; D += dn; const w = wd[dowOf(d) - 1]; w.e += e; w.d += dn;
  }
  return { days, E, D, wd, ph };
}
async function loadAnalytics() {
  const t = today(), span = S.me.isPro ? Math.max(S.an.period * 2, 84) : 7;
  const [lg, st] = await Promise.all([api(`/api/logs?from=${addD(t, -(span - 1))}&to=${t}`), api('/api/stats')]);
  S.an.data = { logs: lg.logs }; S.stats = st;
}
function lineChart(days, p) {
  let pts = days.map(d => pctOf(d.d, d.e));
  if (p > 90) { const w = []; for (let i = 0; i < days.length; i += 7) { const s = days.slice(i, i + 7); w.push(pctOf(s.reduce((a, x) => a + x.d, 0), s.reduce((a, x) => a + x.e, 0))); } pts = w; }
  const W = 320, H = 100, n = Math.max(1, pts.length - 1);
  const xy = pts.map((v, i) => `${(i / n * W).toFixed(1)},${(H - v / 100 * H).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H + 4}" style="width:100%;height:120px"><polyline points="${xy}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
TABS.analytics = () => {
  if (!S.an.data) return `<h1>Аналитика</h1>${S.an.err ? errBox('Не удалось загрузить', 'anreload') : skeleton(4)}`;
  const t = today(), p = S.an.period, pro = S.me.isPro;
  const cur = calc(S.an.data.logs, addD(t, -(p - 1)), t), prev = pro ? calc(S.an.data.logs, addD(t, -(2 * p - 1)), addD(t, -p)) : null;
  const pc = pctOf(cur.D, cur.E), pp = prev ? pctOf(prev.D, prev.E) : null, st = S.stats || {};
  const wdp = cur.wd.map(w => w.e ? pctOf(w.d, w.e) : null), valid = wdp.map((v, i) => [v, i]).filter(x => x[0] !== null);
  const best = valid.length ? valid.reduce((a, b) => b[0] > a[0] ? b : a) : null, worst = valid.length ? valid.reduce((a, b) => b[0] < a[0] ? b : a) : null;
  const habs = S.habits.filter(h => cur.ph[h.id]).map(h => ({ h, e: cur.ph[h.id].e, d: cur.ph[h.id].d })).sort((a, b) => pctOf(b.d, b.e) - pctOf(a.d, a.e));
  const lock = (txt) => `<div class="card center"><i data-lucide="lock" style="color:var(--accent)"></i><div class="muted small" style="margin:6px 0 10px">${txt}</div><button class="btn sm" style="width:auto;display:inline-flex" data-act="gopro">Открыть в PRO</button></div>`;
  let heat = '';
  if (pro) {
    const start = addD(t, -83), off = dowOf(start) - 1, byD = {}; calc(S.an.data.logs, start, t).days.forEach(d => { byD[d.date] = d; });
    heat = `<div class="heat" style="grid-template-columns:none;grid-template-rows:repeat(7,1fr);grid-auto-flow:column;grid-auto-columns:1fr">${'<i style="background:none"></i>'.repeat(off)}${Array.from({ length: 84 }, (_, i) => { const d = byD[addD(start, i)]; return `<i style="background:${d && d.e ? `color-mix(in srgb,var(--accent) ${Math.max(12, pctOf(d.d, d.e))}%,var(--bg2))` : 'var(--bg2)'}" title="${addD(start, i)}"></i>`; }).join('')}</div>`;
  }
  return `<h1>Аналитика</h1>
  <div class="seg" style="margin-bottom:12px">${[7, 30, 90, 365].map(n => `<button class="${p === n ? 'on' : ''}" data-act="anp" data-n="${n}">${n === 7 ? '7 дней' : n + (pro ? '' : ' 🔒')}${n === 7 || pro ? (n === 7 ? '' : ' дн.') : ''}</button>`).join('')}</div>
  <div class="card"><div class="row"><div class="stat sp"><span class="muted small">Процент выполнения</span><b>${pc}%</b></div>${pp !== null ? `<span class="badge" style="background:${pc >= pp ? 'var(--ok)' : 'var(--danger)'}">${pc >= pp ? '▲' : '▼'} ${Math.abs(pc - pp)}%</span>` : ''}</div>
    <div class="bar" style="margin:10px 0 6px"><i style="width:${pc}%;background:var(--ok)"></i></div><div class="muted small">${cur.D} выполнено · ${cur.E - cur.D} пропущено${pp !== null ? ` · прошлый период: ${pp}%` : ''}</div></div>
  <div class="grid g2"><div class="card stat"><span class="muted small">Текущая серия</span><b>${st.current || 0} <span style="font-size:14px">${plural(st.current || 0, 'день', 'дня', 'дней')}</span></b></div>
    <div class="card stat"><span class="muted small">Лучшая серия</span><b>${st.best || 0} <span style="font-size:14px">${plural(st.best || 0, 'день', 'дня', 'дней')}</span></b></div></div>
  <h2>По дням недели</h2><div class="card"><div class="row" style="align-items:flex-end;height:120px">${wdp.map((v, i) => `<div class="sp center"><div class="small muted">${v === null ? '' : v + '%'}</div><div style="height:${v === null ? 4 : Math.max(4, v)}px;background:${best && best[1] === i ? 'var(--accent)' : 'color-mix(in srgb,var(--accent) 35%,var(--card))'};border-radius:6px;margin:3px 2px"></div><div class="small muted">${WD[i]}</div></div>`).join('')}</div>
    ${best ? `<div class="grid g2" style="margin-top:10px"><div class="card" style="background:var(--bg2);margin:0"><b style="color:var(--accent)">${WD_FULL[best[1]]}</b><div class="small muted">Лучший день · ${best[0]}%</div></div><div class="card" style="background:var(--bg2);margin:0"><b style="color:#FF9500">${WD_FULL[worst[1]]}</b><div class="small muted">Худший день · ${worst[0]}%</div></div></div>` : ''}</div>
  <h2>Динамика</h2>${pro ? `<div class="card">${S.habits.length ? lineChart(cur.days, p) : '<div class="muted small">Нет данных</div>'}</div>` : lock('График динамики выполнения')}
  <h2>Привычки</h2>${pro ? (habs.length ? `<div class="card">${habs.map(x => `<div class="row" style="margin-bottom:10px"><i data-lucide="${esc(x.h.icon)}" style="color:${hexOf(x.h.color)}"></i><div class="sp"><div>${esc(x.h.title)}</div><div class="bar" style="margin-top:4px"><i style="width:${pctOf(x.d, x.e)}%;background:${hexOf(x.h.color)}"></i></div></div><b>${pctOf(x.d, x.e)}%</b></div>`).join('')}
    <div class="muted small">Чаще всего пропускаете: ${habs.slice().sort((a, b) => (b.e - b.d) - (a.e - a.d)).filter(x => x.e - x.d > 0).slice(0, 3).map(x => esc(x.h.title)).join(', ') || '—'}</div></div>` : '<div class="empty">Нет данных</div>') : lock('Статистика по каждой привычке')}
  <h2>Календарь активности</h2>${pro ? `<div class="card">${heat}</div>` : lock('Календарь активности за 12 недель')}`;
};
AFTER.analytics = () => { if (!S.an.data && !S.an.loading && !S.an.err) { S.an.loading = true; loadAnalytics().then(() => { S.an.loading = false; render(); }).catch(e => { S.an.loading = false; S.an.err = e.message; render(); }); } };
ACT.anreload = () => { S.an.err = null; S.an.data = null; render(); };
ACT.anp = d => { const n = +d.n; if (n !== 7 && !S.me.isPro) return proPrompt('Периоды 30, 90 и 365 дней доступны в PRO.'); S.an.period = n; if (S.me.isPro && S.an.data) { S.an.data = null; } render(); };
ACT.gopro = () => nav('pro');

// ───────── Достижения ─────────
VIEWS.achievements = () => {
  if (!S.achs) return topBar('Достижения') + skeleton(4);
  const cats = [['streak', 'Самая длинная серия'], ['completions', 'Выполнения'], ['activity', 'Активность']];
  const clr = { streak: '#FF8A00', completions: '#22A7E0', activity: '#2FBF5B' };
  return topBar('Достижения') + cats.map(c => `<h2 class="center">${c[1]}</h2><div class="grid" style="grid-template-columns:repeat(4,1fr)">${S.achs.filter(a => a.category === c[0]).map(a => `<div class="ach" data-act="achinfo" data-id="${a.id}"><div class="hex ${a.unlocked_at ? (a.rarity !== 'common' ? a.rarity : 'on') : 'off'}" style="--c:${clr[c[0]]}"><i data-lucide="${a.icon}"></i></div>${esc(a.title)}</div>`).join('')}</div>`).join('');
};
AFTER.achievements = () => { if (!S.achs) api('/api/achievements').then(a => { S.achs = a; render(); }).catch(errToast); };
ACT.achinfo = d => { const a = S.achs.find(x => x.id == d.id); sheet(`<h2 style="margin-top:0">${esc(a.title)}</h2><p>${esc(a.description)}</p><p class="muted small">${a.unlocked_at ? 'Открыто ' + fmtDateRu(a.unlocked_at) : 'Ещё не открыто'}${a.rarity !== 'common' ? ' · ' + a.rarity : ''}</p><button class="btn sec" data-v="x">Закрыть</button>`); };

// ───────── Челленджи ─────────
TABS.challenges = () => {
  const head = `<div class="top"><h1 class="sp" style="margin:0">Челленджи</h1><button class="icon-btn" style="background:var(--accent)" data-act="chnew"><i data-lucide="plus"></i></button></div>`;
  if (!S.chs) return head + (S.chErr ? errBox('Не удалось загрузить', 'chreload') : skeleton(3));
  if (!S.chs.length) return head + empty('trophy', 'Нет активных челленджей', 'Создайте челлендж и пригласите друзей', '<button class="btn" style="width:auto;display:inline-flex" data-act="chnew">Создать челлендж</button>');
  return head + S.chs.map(c => { const tot = c.target_value * c.duration_days, left = Math.max(0, Math.ceil((Date.parse(c.ends_at) - Date.now()) / 864e5));
    return `<button class="hcard" style="--c:${hexOf(c.color)};--p:${Math.min(100, c.myTotal / tot * 100)}%;width:100%;text-align:left" data-act="chopen" data-id="${c.id}"><i data-lucide="${esc(c.icon)}" style="width:26px;height:26px;flex:none"></i><div class="body"><div class="t">${esc(c.title)}</div><div class="s">${c.members} ${plural(c.members, 'участник', 'участника', 'участников')} · ${c.status === 'active' ? 'осталось ' + left + ' дн.' : 'завершён'}</div></div></button>`; }).join('');
};
AFTER.challenges = () => { if (!S.chs && !S.chErr) api('/api/challenges').then(c => { S.chs = c; render(); }).catch(() => { S.chErr = true; render(); }); };
ACT.chreload = () => { S.chErr = false; render(); };
ACT.chopen = d => openChallenge(d.id);
async function openChallenge(id) { S.chd = null; nav('challenge', { id }); S.chd = await api('/api/challenges/' + id); render(); }
VIEWS.challenge = () => {
  const d = S.chd; if (!d) return topBar('Челлендж') + skeleton(3);
  const c = d.challenge, tot = c.target_value * c.duration_days, active = c.status === 'active' && Date.parse(c.ends_at) > Date.now(), me = d.members.find(m => m.me);
  const left = Math.max(0, Math.ceil((Date.parse(c.ends_at) - Date.now()) / 864e5)), all = d.members.reduce((s, m) => s + m.total, 0);
  return `${topBar(c.title)}<div class="hcard" style="--c:${hexOf(c.color)};--p:${Math.min(100, all / (tot * d.members.length) * 100)}%"><i data-lucide="${esc(c.icon)}" style="width:26px;height:26px"></i><div class="body"><div class="t">Общий прогресс</div><div class="s">${d.members.length} уч. · ${active ? 'осталось ' + left + ' дн.' : 'завершён'}</div></div></div>
  ${c.description ? `<p class="muted">${esc(c.description)}</p>` : ''}
  <div class="card"><div class="muted small">Цель: ${fmtNum(c.target_value)} в день, ${c.duration_days} дн. · Ваш прогресс: ${fmtNum(me.total)} из ${fmtNum(tot)}</div><div class="bar" style="margin:8px 0"><i style="width:${Math.min(100, me.total / tot * 100)}%"></i></div>
    ${active ? `<div class="row"><input id="chv" type="number" inputmode="decimal" step="any" value="${me.today}" placeholder="Сегодня выполнено"><button class="btn sm" data-act="chprog">Сохранить</button></div>` : ''}</div>
  <h2>Рейтинг</h2><div class="card">${d.members.map((m, i) => `<div class="row" style="margin-bottom:8px"><b style="width:22px">${i + 1}</b><div class="sp ${m.me ? '' : ''}">${esc(m.name)}${m.me ? ' (вы)' : ''}</div><b>${fmtNum(m.total)}</b></div>`).join('')}</div>
  ${active ? '<button class="btn" data-act="chinvite"><i data-lucide="user-plus"></i>Пригласить друзей</button>' : ''}`;
};
ACT.chprog = async () => { const v = parseFloat(String($('#chv').value).replace(',', '.')); if (isNaN(v) || v < 0) return toast('Введите число'); await api(`/api/challenges/${S.chd.challenge.id}/progress`, { method: 'POST', body: { value: v, date: today() } }); hap('ok'); S.chd = await api('/api/challenges/' + S.chd.challenge.id); S.chs = null; render(); };
ACT.chinvite = () => { const l = `https://t.me/${CONFIG.BOT_USERNAME}/${CONFIG.APP_SHORT_NAME}?startapp=ch_${S.chd.challenge.invite_code}`; shareLink(l, `Присоединяйся к челленджу «${S.chd.challenge.title}» в TRAKROBOT!`); };
function shareLink(link, text) { const u = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text); WA && WA.openTelegramLink ? WA.openTelegramLink(u) : window.open(u, '_blank'); }
ACT.chnew = () => { S.cf = { title: '', description: '', icon: 'trophy', color: 'violet', target_value: 1, duration_days: 7 }; nav('chform'); };
VIEWS.chform = () => { const f = S.cf; return `${topBar('Новый челлендж')}
  <div class="field"><label>Название</label><input id="cf_title" maxlength="80" value="${esc(f.title)}" placeholder="7 дней зарядки"></div>
  <div class="field"><label>Описание</label><textarea id="cf_desc" rows="2" maxlength="500">${esc(f.description)}</textarea></div>
  <div class="grid g2"><div class="field"><label>Цель в день</label><input id="cf_target" type="number" step="any" min="0" value="${f.target_value}"></div><div class="field"><label>Длительность (дней)</label><input id="cf_dur" type="number" min="1" max="365" value="${f.duration_days}"></div></div>
  <div class="field"><label>Цвет</label><div class="grid g9">${Object.entries(COLORS).map(([k, c]) => `<button class="dot ${f.color === k ? 'on' : ''}" style="background:${c.hex}" data-act="chset" data-k="color" data-v="${k}"></button>`).join('')}</div></div>
  <div class="field"><label>Иконка</label><div class="grid g6">${['trophy', 'dumbbell', 'book-open', 'languages', 'moon', 'droplet', 'bike', 'flame', 'target', 'heart', 'brain', 'footprints'].map(i => `<button class="pick ${f.icon === i ? 'on' : ''}" data-act="chset" data-k="icon" data-v="${i}"><i data-lucide="${i}"></i></button>`).join('')}</div></div>
  ${S.me.isPro ? '' : '<p class="muted small">Бесплатно можно создавать один челлендж раз в 7 дней. В PRO ограничения нет.</p>'}<button class="btn" data-act="chsave">Создать</button>`; };
const chRead = () => { Object.assign(S.cf, { title: $('#cf_title').value, description: $('#cf_desc').value, target_value: $('#cf_target').value, duration_days: $('#cf_dur').value }); };
ACT.chset = d => { chRead(); S.cf[d.k] = d.v; render(); };
ACT.chsave = async () => {
  chRead(); const f = S.cf; if (!f.title.trim()) return toast('Введите название');
  const r = await api('/api/challenges', { method: 'POST', body: { title: f.title, description: f.description, icon: f.icon, color: f.color, target_value: parseFloat(String(f.target_value).replace(',', '.')) || 1, duration_days: parseInt(f.duration_days) } });
  S.chs = null; S.stack.pop(); S.view = null; S.tab = 'challenges'; hap('ok'); await openChallenge(r.id);
};

// ───────── Рефералы ─────────
TABS.referrals = () => {
  const r = S.ref; const head = '<h1>Рефералы</h1><p class="muted" style="margin-top:-6px">Приглашай друзей — развивай TRAKROBOT вместе с нами</p>';
  if (!r) return head + (S.refErr ? errBox('Не удалось загрузить', 'refreload') : skeleton(3));
  return head + `<div class="card"><div class="grid g2">${[['Приглашено', r.invited], ['Активировано', r.activated], ['Из них с PRO', r.invitedPro], ['Дней PRO получено', r.rewardDays]].map(x => `<div class="stat"><span class="muted small">${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div></div>
  <button class="btn" data-act="refshare"><i data-lucide="share-2"></i>Пригласить друзей</button><div class="gap"></div>
  <div class="card small muted">Друг считается приглашённым после того, как зарегистрируется по вашей ссылке и отметит первую привычку.<br>1 активный друг — 1 день PRO · 5 друзей — ещё +5 дней · 10 друзей — ещё +10 дней.</div>
  <h2>Приглашённые</h2>${r.list.length ? `<div class="card">${r.list.map(x => `<div class="row" style="margin-bottom:8px"><div class="sp">${esc(x.name)}</div><span class="badge ${x.status === 'activated' ? '' : 'free'}">${x.status === 'activated' ? 'активирован' : 'ожидает'}</span></div>`).join('')}</div>` : empty('users', 'Пока никого', 'Поделитесь ссылкой с друзьями')}
  <h2>История начислений</h2>${r.rewards.length ? `<div class="card">${r.rewards.map(x => `<div class="row" style="margin-bottom:6px"><div class="sp">${x.milestone ? 'Бонус за ' + x.milestone + ' друзей' : 'Активный друг'}</div><b>+${x.reward_days} дн.</b><span class="muted small">${fmtDateRu(x.created_at)}</span></div>`).join('')}</div>` : '<div class="muted small">Начислений пока нет</div>'}`;
};
AFTER.referrals = () => { if (!S.ref && !S.refErr) api('/api/referrals').then(r => { S.ref = r; render(); }).catch(() => { S.refErr = true; render(); }); };
ACT.refreload = () => { S.refErr = false; render(); };
ACT.refshare = () => shareLink(`https://t.me/${CONFIG.BOT_USERNAME}/${CONFIG.APP_SHORT_NAME}?startapp=ref_${S.me.refCode}`, 'Я использую TRAKROBOT для привычек и целей. Присоединяйся!');

// ───────── Профиль ─────────
TABS.profile = () => {
  const m = S.me, u = m.user, st = S.stats || {};
  return `<div class="row" style="margin:6px 0 14px">${u.photo_url ? `<img class="avatar" src="${esc(u.photo_url)}" alt="">` : '<div class="avatar"></div>'}<div class="sp"><div style="font-size:20px;font-weight:700">${esc(u.first_name || 'Пользователь')}</div><div class="muted small">${u.username ? '@' + esc(u.username) : ''} · с ${fmtDateRu(u.created_at)}</div></div><span class="badge ${m.isPro ? '' : 'free'}">${m.isPro ? 'PRO' : 'FREE'}</span></div>
  <button class="card row" style="width:100%;text-align:left;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 50%,#000))" data-act="gopro"><i data-lucide="crown"></i><div class="sp"><b>TRAKROBOT PRO</b><div class="small" style="opacity:.85">${m.isPro ? 'Действует до ' + fmtDateRu(m.proUntil) : 'Без ограничений и расширенная аналитика'}</div></div><i data-lucide="chevron-right"></i></button>
  <div class="grid g3" style="margin-bottom:10px">${[['Серия', st.current || 0], ['Привычек', S.habits.length], ['Выполнений', st.completions || 0]].map(x => `<div class="card stat center" style="margin:0"><b>${x[1]}</b><span class="muted small">${x[0]}</span></div>`).join('')}</div>
  <div class="card" style="padding:4px 14px">${[['achievements', 'award', 'Достижения'], ['themes', 'palette', 'Темы оформления'], ['archive', 'archive', 'Архив привычек'], ['payments', 'receipt', 'История платежей']].map(x => `<button class="item row" style="width:100%;padding:13px 0;border-bottom:1px solid var(--line)" data-act="go" data-v="${x[0]}"><i data-lucide="${x[1]}"></i><span class="sp" style="text-align:left">${x[2]}</span><i data-lucide="chevron-right" class="muted"></i></button>`).join('')}
    <div class="row" style="padding:13px 0;border-bottom:1px solid var(--line)"><i data-lucide="bell"></i><span class="sp">Уведомления</span><input type="checkbox" style="width:22px;height:22px" ${u.notifications ? 'checked' : ''} data-act="notif"></div>
    <div class="row" style="padding:13px 0"><i data-lucide="globe"></i><span class="sp">Часовой пояс</span><span class="muted small">${esc(u.timezone)}</span></div></div>
  <div class="card" style="padding:4px 14px">${[['support', 'life-buoy', 'Поддержка'], ['privacy', 'shield', 'Политика конфиденциальности'], ['terms', 'file-text', 'Пользовательское соглашение']].map(x => `<button class="row" style="width:100%;padding:13px 0;border-bottom:1px solid var(--line)" data-act="${x[0]}"><i data-lucide="${x[1]}"></i><span class="sp" style="text-align:left">${x[2]}</span></button>`).join('')}</div>
  ${m.isAdmin ? '<button class="btn sec" data-act="go" data-v="admin"><i data-lucide="shield-check"></i>Админ-панель</button>' : ''}`;
};
ACT.go = d => nav(d.v);
ACT.notif = async (d, el) => { await api('/api/me', { method: 'PATCH', body: { notifications: el.checked } }); S.me.user.notifications = el.checked; toast(el.checked ? 'Уведомления включены' : 'Уведомления выключены'); };
ACT.support = () => WA.openTelegramLink ? WA.openTelegramLink(CONFIG.SUPPORT_URL) : window.open(CONFIG.SUPPORT_URL);
const legal = (t, body) => sheet(`<h2 style="margin-top:0">${t}</h2><div class="muted" style="font-size:14px">${body}</div><div class="gap"></div><button class="btn sec" data-v="x">Закрыть</button>`);
ACT.privacy = () => legal('Политика конфиденциальности', 'TRAKROBOT хранит только данные, необходимые для работы: ваш Telegram ID, имя, username, часовой пояс, а также созданные вами привычки и отметки. Мы не запрашиваем номер телефона, геолокацию и другие личные данные и не передаём данные третьим лицам. Оплата проходит через Telegram Stars; платёжных данных мы не получаем. Чтобы удалить данные, напишите в поддержку.');
ACT.terms = () => legal('Пользовательское соглашение', 'Приложение предоставляется «как есть». TRAKROBOT PRO — цифровая услуга, оплачиваемая Telegram Stars. Возвраты рассматриваются через поддержку в соответствии с правилами Telegram. Используя приложение, вы соглашаетесь не злоупотреблять сервисом, реферальной и подарочной системами.');

// ───────── PRO ─────────
S.plan = 'pro_12m';
VIEWS.pro = () => {
  const m = S.me, plans = Object.entries(m.plans), per = p => Math.round(p.stars / (p.days / 30));
  const feats = [['infinity', 'Неограниченное число привычек'], ['bar-chart-3', 'Расширенная аналитика и все периоды'], ['history', 'Полная история статистики'], ['palette', 'Персональные темы оформления'], ['trophy', 'Челленджи без недельного лимита'], ['file-text', 'Расширенные отчёты']];
  return `${topBar('TRAKROBOT PRO')}${m.isPro ? `<div class="card center"><b>PRO активен до ${fmtDateRu(m.proUntil)}</b><div class="muted small">Покупка продлит срок</div></div>` : ''}
  <div class="card">${feats.map(f => `<div class="row" style="padding:7px 0"><i data-lucide="${f[0]}" style="color:var(--accent)"></i><span>${f[1]}</span></div>`).join('')}</div>
  <h2>Тариф</h2>${plans.map(([k, p]) => `<button class="plan ${S.plan === k ? 'on' : ''}" data-act="plan" data-k="${k}"><div class="sp"><b>${p.title}</b><div class="muted small">≈ ${per(p)} ⭐ в месяц</div></div><b>${p.stars} ⭐</b></button>`).join('')}
  <button class="btn" data-act="buy">Оплатить ${m.plans[S.plan].stars} ⭐ Telegram Stars</button><p class="muted small center">Оплата проходит внутри Telegram. PRO активируется автоматически после подтверждения платежа сервером.</p>`;
};
ACT.plan = d => { S.plan = d.k; render(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function refreshMe() { S.me = await api('/api/me'); const t = S.me.user.theme; applyTheme(THEMES[t] && THEMES[t].pro && !S.me.isPro ? 'default-dark' : t); }
ACT.buy = async () => {
  const r = await api('/api/pay/invoice', { method: 'POST', body: { plan: S.plan } });
  if (!WA || !WA.openInvoice) return toast('Обновите Telegram, чтобы оплатить Stars');
  WA.openInvoice(r.invoiceLink, async st => {
    if (st === 'paid') { toast('Оплата прошла, активируем PRO…'); for (let i = 0; i < 10; i++) { await sleep(1500); try { await refreshMe(); } catch (e) { /* */ } if (S.me.isPro) break; } S.an.data = null; render(); }
    else if (st === 'failed') toast('Платёж не прошёл');
  });
};

// ───────── Темы ─────────
VIEWS.themes = () => `${topBar('Темы оформления')}<div class="grid g2">${Object.entries(THEMES).map(([k, t]) => `<button class="card" style="margin:0;text-align:left;border:2px solid ${S.me.user.theme === k ? 'var(--accent)' : 'transparent'}" data-act="themepick" data-k="${k}"><div class="row" style="gap:4px;margin-bottom:8px">${['bg', 'card', 'accent'].map(c => `<span style="width:26px;height:26px;border-radius:8px;background:${t.v[c]};border:1px solid var(--line)"></span>`).join('')}</div><b>${t.name}</b> <span class="badge ${t.pro ? '' : 'free'}">${t.pro ? 'PRO' : 'FREE'}</span></button>`).join('')}</div>`;
ACT.themepick = async d => {
  const t = THEMES[d.k]; applyTheme(d.k);
  const r = await sheet(`<h2 style="margin-top:0">${t.name}</h2><p class="muted small">Предпросмотр применён. ${t.pro && !S.me.isPro ? 'Эта тема доступна в PRO.' : ''}</p><button class="btn" data-v="ok">${t.pro && !S.me.isPro ? 'Открыть PRO' : 'Применить'}</button><div class="gap"></div><button class="btn sec" data-v="no">Отмена</button>`);
  if (r.v === 'ok') {
    if (t.pro && !S.me.isPro) { applyTheme(S.me.user.theme); return nav('pro'); }
    await api('/api/me', { method: 'PATCH', body: { theme: d.k } }); S.me.user.theme = d.k; hap('ok'); render();
  } else applyTheme(S.me.user.theme);
};
const _back = ACT.back; ACT.back = () => { if (S.view && S.view.name === 'themes') applyTheme(S.me.user.theme); _back(); };

// ───────── Архив и платежи ─────────
VIEWS.archive = () => { if (!S.arch) return topBar('Архив') + skeleton(3); return topBar('Архив привычек') + (S.arch.length ? S.arch.map(h => `<div class="hcard" style="--c:${hexOf(h.color)};--p:0%"><i data-lucide="${esc(h.icon)}" style="margin-left:6px"></i><div class="body"><div class="t">${esc(h.title)}</div><div class="s">${schedText(h)}</div></div><button class="act" data-act="unarch" data-id="${h.id}"><i data-lucide="archive-restore"></i></button></div>`).join('') : empty('archive', 'Архив пуст', '')); };
AFTER.archive = () => { if (!S.arch) api('/api/habits?archived=1').then(d => { S.arch = d.habits; render(); }).catch(errToast); };
ACT.unarch = async d => { await api('/api/habits/' + d.id, { method: 'PATCH', body: { is_archived: false } }); S.arch = null; await loadHabits(); toast('Привычка восстановлена'); render(); };
VIEWS.payments = () => { if (!S.pays) return topBar('Платежи') + skeleton(3); return topBar('История платежей') + (S.pays.length ? `<div class="card">${S.pays.map(p => `<div class="row" style="margin-bottom:8px"><div class="sp">${esc((S.me.plans[p.plan_code] || {}).title || p.plan_code)}<div class="muted small">${fmtDateRu(p.created_at)}</div></div><b>${p.amount} ⭐</b>${p.status === 'refunded' ? '<span class="badge free">возврат</span>' : ''}</div>`).join('')}</div>` : empty('receipt', 'Платежей пока нет', '')); };
AFTER.payments = () => { if (!S.pays) api('/api/payments').then(p => { S.pays = p; render(); }).catch(errToast); };

// ───────── Админ-панель ─────────
S.ad = { tab: 'dash', q: '', g: { tg: '', found: null, days: 30, custom: '', until: '', preset: 'Подарок другу', text: '', idem: null }, filter: 'all' };
document.addEventListener('input', e => { const t = e.target; if (t.dataset.ag) S.ad.g[t.dataset.ag] = t.value; if (t.dataset.aq !== undefined) S.ad.q = t.value; });
const AD_TABS = [['dash', 'Dashboard'], ['users', 'Users'], ['grant', 'Grant PRO'], ['subs', 'Subscriptions'], ['pay', 'Payments'], ['logs', 'Logs'], ['admins', 'Settings']];
const uname = u => u ? (u.username ? '@' + esc(u.username) : esc(u.first_name || '—')) + ' <span class="muted small">' + u.telegram_id + '</span>' : '—';
const reasons = ['Подарок другу', 'Бесплатный доступ для тестировщика', 'Партнёрство', 'Компенсация', 'Бонус', 'Другое'];
VIEWS.admin = () => {
  const a = S.ad, tabs = `<div class="scroll-x">${AD_TABS.map(t => `<button class="chip ${a.tab === t[0] ? 'on' : ''}" data-act="adtab" data-t="${t[0]}">${t[1]}</button>`).join('')}</div>`;
  const d = a.data && a.data[a.tab]; let body = '';
  if (a.tab === 'dash') body = !d ? skeleton(3) : `<div class="grid g2">${[['Пользователей', d.total], ['Активных за 7 дн.', d.active], ['PRO', d.pro], ['FREE', d.free], ['Подарочных', d.giftSubscriptions], ['Платных', d.paidSubscriptions], ['Новых за 7 дн.', d.new7], ['Новых за 30 дн.', d.new30]].map(x => `<div class="card stat" style="margin:0"><span class="muted small">${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div>
    <h2>Последние регистрации</h2><div class="card small">${d.lastUsers.map(u => `<div>${uname(u)} · ${fmtDateRu(u.created_at)}</div>`).join('') || '—'}</div>
    <h2>Последние подарки PRO</h2><div class="card small">${d.lastGifts.map(g => `<div>${uname(g.users)} · ${g.days} дн. · ${esc(g.reason || '')}</div>`).join('') || '—'}</div>
    <h2>Последние покупки</h2><div class="card small">${d.lastPayments.map(p => `<div>${uname(p.users)} · ${p.amount} ⭐ · ${p.status}</div>`).join('') || '—'}</div>
    ${d.lastLogs.length ? `<h2>Последние действия</h2><div class="card small">${d.lastLogs.map(l => `<div>${l.action_type} · ${l.admin_telegram_id} → ${l.target_telegram_id || ''}</div>`).join('')}</div>` : ''}`;
  if (a.tab === 'users') body = `<div class="row"><input data-aq placeholder="Telegram ID, @username или имя" value="${esc(a.q)}"><button class="btn sm" data-act="adsearch">Найти</button></div><div class="gap"></div>${!d ? '' : d.length ? d.map(u => `<button class="card row" style="width:100%;text-align:left" data-act="aduser" data-id="${u.telegram_id}"><div class="sp">${uname(u)}</div><span class="muted small">${fmtDateRu(u.created_at)}</span></button>`).join('') : empty('search-x', 'Не найдено', '')}`;
  if (a.tab === 'grant') {
    const g = a.g, f = g.found;
    body = `<div class="row"><input data-ag="tg" inputmode="numeric" placeholder="Telegram ID" value="${esc(g.tg)}"><button class="btn sm" data-act="adfind">Найти</button></div><div class="gap"></div>
    ${f ? `<div class="card"><b>${uname(f.user)}</b><div class="small muted">Статус: ${f.proUntil ? 'PRO до ' + fmtDateRu(f.proUntil) : 'FREE'} · привычек: ${f.habits}</div></div>
      <div class="field"><label>Срок</label><div class="chips">${[1, 3, 7, 14, 30, 60, 90, 180, 365].map(n => `<button class="chip ${g.days === n && !g.custom && !g.until ? 'on' : ''}" data-act="adday" data-n="${n}">${n} дн.</button>`).join('')}</div></div>
      <div class="grid g2"><div class="field"><label>Своё число дней</label><input data-ag="custom" type="number" min="1" value="${esc(g.custom)}"></div><div class="field"><label>Или до даты</label><input data-ag="until" type="date" value="${esc(g.until)}"></div></div>
      <div class="field"><label>Причина выдачи</label><select data-ag="preset">${reasons.map(r => `<option ${g.preset === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field"><input data-ag="text" placeholder="Комментарий (необязательно)" value="${esc(g.text)}"></div><button class="btn" data-act="adgrant">Выдать PRO</button>` : ''}`;
  }
  if (a.tab === 'subs') body = `<div class="seg" style="margin-bottom:10px">${[['all', 'Все'], ['active', 'Активные'], ['expired', 'Истёкшие']].map(x => `<button class="${a.filter === x[0] ? 'on' : ''}" data-act="adfilter" data-f="${x[0]}">${x[1]}</button>`).join('')}</div>${!d ? skeleton(2) : d.length ? d.map(s => { const live = !s.revoked_at && Date.parse(s.expires_at) > Date.now(); return `<div class="card small"><div class="row"><b class="sp">${uname(s.users)}</b><span class="badge ${live ? '' : 'free'}">${s.revoked_at ? 'отозвана' : live ? 'активна' : 'истекла'}</span></div><div class="muted">${s.days} дн. · выдана ${fmtDateRu(s.created_at)} · до ${fmtDateRu(s.expires_at)}<br>${esc(s.reason || '')} · админ ${s.granted_by_telegram_id}</div>${live ? `<div class="row" style="margin-top:8px"><button class="btn sec sm" data-act="adextend" data-id="${s.users.telegram_id}">Продлить</button><button class="btn danger sm" data-act="adrevoke" data-id="${s.users.telegram_id}">Отозвать</button></div>` : ''}</div>`; }).join('') : empty('inbox', 'Подписок нет', '')}`;
  if (a.tab === 'pay') body = !d ? skeleton(2) : d.length ? d.map(p => `<div class="card small"><div class="row"><b class="sp">${uname(p.users)}</b><b>${p.amount} ⭐</b></div><div class="muted">${p.plan_code} · ${fmtDateRu(p.created_at)} · ${p.status}</div>${p.status === 'paid' && S.ad.role === 'OWNER' ? `<button class="btn sec sm" style="margin-top:8px" data-act="adrefund" data-c="${esc(p.telegram_charge_id)}">Вернуть Stars</button>` : ''}</div>`).join('') : empty('receipt', 'Платежей нет', '');
  if (a.tab === 'logs') body = a.role !== 'OWNER' ? '<div class="empty">Журнал доступен только владельцу</div>' : !d ? skeleton(2) : `<div class="card small">${d.map(l => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${l.action_type}</b> · админ ${l.admin_telegram_id} → ${l.target_telegram_id || '—'} · ${new Date(l.created_at).toLocaleString('ru-RU')}<div class="muted">${esc(l.reason || '')} ${l.new_state ? esc(JSON.stringify(l.new_state)) : ''}</div></div>`).join('') || '—'}</div>`;
  if (a.tab === 'admins') body = a.role !== 'OWNER' ? '<div class="empty">Только для владельца</div>' : `<div class="row"><input data-ag="newadmin" inputmode="numeric" placeholder="Telegram ID нового администратора" value="${esc(a.g.newadmin || '')}"><button class="btn sm" data-act="adaddadmin">Добавить</button></div><div class="gap"></div>${!d ? skeleton(1) : d.map(x => `<div class="card row"><div class="sp">${x.telegram_id} <span class="badge">${x.role}</span></div><button class="btn danger sm" data-act="addeladmin" data-id="${x.telegram_id}">Убрать</button></div>`).join('')}<p class="muted small">Администраторы из переменных окружения (ADMIN_OWNER_ID, ADMIN_TELEGRAM_IDS) здесь не показываются и не удаляются.</p>`;
  return topBar('Admin Panel') + tabs + (a.err ? errBox(a.err, 'adreload') : body);
};
async function adLoad(tab) {
  const a = S.ad; a.err = null;
  const url = { dash: '/api/admin/dashboard', users: '/api/admin/users?q=' + encodeURIComponent(a.q), subs: '/api/admin/subscriptions?filter=' + a.filter, pay: '/api/admin/payments', logs: '/api/admin/logs', admins: '/api/admin/administrators' }[tab];
  if (!url) return render();
  a.data = a.data || {}; a.data[tab] = null; render();
  try { a.data[tab] = await api(url); } catch (e) { if (e.status === 403) { a.err = 'Нет доступа'; } else if (tab === 'logs' || tab === 'admins') a.data[tab] = []; else a.err = e.message; }
  render();
}
AFTER.admin = () => { if (!S.ad.role) { api('/api/admin/me').then(r => { S.ad.role = r.role; adLoad(S.ad.tab); }).catch(() => { S.ad.err = 'Нет доступа'; render(); }); } };
ACT.adtab = d => { S.ad.tab = d.t; adLoad(d.t); };
ACT.adreload = () => adLoad(S.ad.tab);
ACT.adsearch = () => adLoad('users');
ACT.adfilter = d => { S.ad.filter = d.f; adLoad('subs'); };
ACT.aduser = async d => {
  const r = await api('/api/admin/users/' + d.id); const u = r.user;
  const x = await sheet(`<h2 style="margin-top:0">${uname(u)}</h2><div class="small muted" style="margin-bottom:10px">Регистрация: ${fmtDateRu(u.created_at)}<br>Статус: ${r.proUntil ? 'PRO до ' + fmtDateRu(r.proUntil) : 'FREE'}<br>Привычек: ${r.habits} · достижений: ${r.achievements} · челленджей: ${r.challenges}<br>Рефералы: ${r.referrals.total} (активных ${r.referrals.activated})</div>
    <div class="small" style="margin-bottom:10px"><b>История подписок</b>${r.subscriptions.map(s => `<div class="muted">${s.source} · ${s.days} дн. · до ${fmtDateRu(s.expires_at)}${s.revoked_at ? ' · отозвана' : ''}</div>`).join('') || '<div class="muted">—</div>'}</div>
    <button class="btn" data-v="grant">Выдать / продлить PRO</button><div class="gap"></div><button class="btn danger" data-v="revoke">Отозвать подарочный PRO</button>`);
  if (x.v === 'grant') { S.ad.g = Object.assign(S.ad.g, { tg: String(u.telegram_id), found: r, idem: null }); S.ad.tab = 'grant'; render(); }
  if (x.v === 'revoke') ACT.adrevoke({ id: u.telegram_id });
};
ACT.adfind = async () => { const tg = (S.ad.g.tg || '').trim(); if (!/^\d+$/.test(tg)) return toast('Введите числовой Telegram ID'); try { S.ad.g.found = await api('/api/admin/users/' + tg); S.ad.g.idem = null; } catch (e) { S.ad.g.found = null; errToast(e); } render(); };
ACT.adday = d => { Object.assign(S.ad.g, { days: +d.n, custom: '', until: '', idem: null }); render(); };
ACT.adgrant = async () => {
  const g = S.ad.g; let days = g.days, label = days + ' дн.';
  if (g.until) { days = null; label = 'до ' + fmtDateRu(g.until); } else if (g.custom) { days = parseInt(g.custom); label = days + ' дн.'; }
  if (!g.until && !(days >= 1)) return toast('Укажите срок');
  const reason = g.preset + (g.text ? ': ' + g.text : '');
  const ok = await confirmBox(`Выдать TRAKROBOT PRO\n${uname(g.found.user).replace(/<[^>]+>/g, '')}\nID: ${g.found.user.telegram_id}\nСрок: ${label}\nПричина: ${reason}`, 'Подтвердить выдачу');
  if (!ok) return;
  g.idem = g.idem || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  const r = await api('/api/admin/subscriptions/grant', { method: 'POST', body: { telegramId: g.found.user.telegram_id, days, untilDate: g.until || undefined, reason, idempotencyKey: g.idem } });
  g.idem = null; toast(`PRO ${r.extended ? 'продлён' : 'выдан'} до ${fmtDateRu(r.pro_until || r.expires_at)}`); hap('ok'); ACT.adfind();
};
ACT.adextend = d => { S.ad.g = Object.assign(S.ad.g, { tg: String(d.id), idem: null }); S.ad.tab = 'grant'; ACT.adfind(); };
ACT.adrevoke = async d => { if (!(await confirmBox('Отозвать подарочный PRO у пользователя ' + d.id + '? Оплаченная подписка не пострадает.', 'Отозвать', true))) return; const r = await api('/api/admin/subscriptions/revoke', { method: 'POST', body: { telegramId: +d.id } }); toast(`Отозвано записей: ${r.revoked}`); if (S.ad.tab === 'subs') adLoad('subs'); };
ACT.adrefund = async d => { if (!(await confirmBox('Вернуть Stars за платёж и отозвать связанную подписку?', 'Вернуть', true))) return; await api('/api/admin/payments/refund', { method: 'POST', body: { chargeId: d.c } }); toast('Возврат выполнен'); adLoad('pay'); };
ACT.adaddadmin = async () => { const id = (S.ad.g.newadmin || '').trim(); if (!/^\d+$/.test(id)) return toast('Введите Telegram ID'); await api('/api/admin/administrators', { method: 'POST', body: { telegramId: +id } }); S.ad.g.newadmin = ''; adLoad('admins'); };
ACT.addeladmin = async d => { if (await confirmBox('Убрать администратора ' + d.id + '?', 'Убрать', true)) { await api('/api/admin/administrators/' + d.id, { method: 'DELETE' }); adLoad('admins'); } };
