'use strict';
// ───────── Запуск ─────────
async function boot() {
  if (!WA || !WA.initData) {
    $('#app').innerHTML = empty('send', 'Откройте через Telegram', 'Трекер работает как Telegram Mini App. Откройте @' + CONFIG.BOT_USERNAME);
    lucide.createIcons(); return;
  }
  try { WA.ready(); WA.expand(); WA.BackButton.onClick(() => ACT.back()); WA.disableVerticalSwipes && WA.disableVerticalSwipes(); } catch (e) { /* */ }
  S.loadErr = null; S.ready = false; render();
  try {
    S.me = await api('/api/me');
    const th = S.me.user.theme; applyTheme(THEMES[th] && THEMES[th].pro && !S.me.isPro ? 'default-dark' : th);
    const t = today();
    await Promise.all([loadHabits(), loadLogs(addD(t, -30), addD(t, 3)), loadTimer(), api('/api/stats').then(s => { S.stats = s; })]);
    S.logFrom = addD(t, -30); S.ready = true; render();
    const sp = WA.initDataUnsafe && WA.initDataUnsafe.start_param;
    if (sp && sp.startsWith('ch_') && !S.joined) {
      S.joined = true;
      try { const r = await api('/api/challenges/join', { method: 'POST', body: { code: sp.slice(3) } }); toast('Вы присоединились к челленджу'); S.tab = 'challenges'; S.chs = null; await openChallenge(r.id); } catch (e) { errToast(e); }
    } else if (location.hash === '#admin' && S.me.isAdmin) nav('admin');
  } catch (e) {
    console.error(e);
    S.loadErr = e.status === 401 ? 'Не удалось авторизоваться. Откройте приложение из Telegram.' : 'Нет связи с сервером. Проверьте интернет.';
    render();
  }
}
boot();
