// script2.js — стабильный старт в Telegram Mini App + чок по встряске + звук/анимация
(function () {
  // -------- настройки --------
  const API_BASE = (window.__API_BASE__ || 'https://efes-app.onrender.com').replace(/\/+$/,'');
  const SHAKE_THRESHOLD = 15;
  const MIN_SHAKE_INTERVAL = 1500;

  // -------- состояние --------
  let tg = null;
  let telegramUser = null;
  let hasMotionPermission = false;
  let lastShakeTime = 0;
  let lastAccel = { x: null, y: null, z: null };
  let contactStr = '';

  // -------- утилиты --------
  const $ = (id) => document.getElementById(id);
  const safe = (s) => (s == null ? '' : String(s));

  function setStatusLine(parts = {}) {
    const el = $('status');
    if (!el) return;
    const p = [];
    if (parts.msg) p.push(parts.msg);
    if (parts.tg != null)     p.push(`TG:${parts.tg ? 'yes' : 'no'}`);
    if (parts.platform)       p.push(`plat:${parts.platform}`);
    if (parts.initLen != null)p.push(`initLen:${parts.initLen}`);
    el.textContent = p.join(' · ');
  }

  const log = async (msg, extra = {}) => {
    try {
      await fetch(`${API_BASE}/debug-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg, ...extra })
      });
    } catch (_) {}
  };

  // -------- Telegram SDK --------
  const ensureTgReady = async () => {
    if (!window.Telegram || !window.Telegram.WebApp) {
      setStatusLine({ msg: 'нет Telegram.WebApp', tg:false });
      await log('No Telegram.WebApp on window');
      throw new Error('Откройте мини-апп из бота Telegram (web_app)');
    }
    tg = window.Telegram.WebApp;
    try { tg.ready(); tg.expand?.(); } catch (_) {}
    setStatusLine({
      msg:'init',
      tg: true,
      platform: tg.platform || 'n/a',
      initLen: (tg.initData || '').length
    });
    await log('TG ready', { platform: tg.platform, initLen: (tg.initData||'').length });
    return tg;
  };

  // Берём юзера: сначала из initDataUnsafe.user, иначе — из строки initData (старые клиенты)
  function extractUserSmart() {
    const u = tg?.initDataUnsafe?.user;
    if (u && u.id) return u;

    const str = tg?.initData;
    if (typeof str === 'string' && str.length) {
      try {
        const p = new URLSearchParams(str);
        const userJson = p.get('user');
        if (userJson) {
          const parsed = JSON.parse(userJson);
          if (parsed?.id) return parsed;
        }
      } catch (e) {
        // ignore
      }
    }
    return null;
  }

  async function waitForUser(maxMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const u = extractUserSmart();
      if (u?.id) return u;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  // -------- UI --------
  const showUser = (u) => {
    const name = u.username ? `@${u.username}` : (u.first_name || `user_${u.id}`);
    $('username') && ($('username').textContent = `${name}  #${u.id}`);
    $('status') && ($('status').textContent = 'Готов! Дайте доступ к датчикам и встряхните телефон.');
  };

  const showOpenFromBot = () => {
    $('username') && ($('username').textContent = 'Загрузка…');
    $('status') && ($('status').textContent =
      'Нет данных пользователя. Откройте мини-апп из бота ПО КНОПКЕ (web_app), не по обычной ссылке.');
  };

  // -------- разрешение на акселерометр --------
  const ensureMotionPermission = async () => {
    if (typeof DeviceMotionEvent === 'undefined') return true;
    if (typeof DeviceMotionEvent.requestPermission !== 'function') return true;
    const st = await DeviceMotionEvent.requestPermission().catch(() => 'denied');
    hasMotionPermission = (st === 'granted');
    if (!hasMotionPermission) {
      $('status') && ($('status').textContent =
        'Разрешите доступ к движению (нажмите «Чок!» и выберите Разрешить).');
      throw new Error('motion permission denied');
    }
    return true;
  };

  // -------- лёгкая качка бутылки --------
  const animateBottle = () => {
    const img = $('bottle');
    if (!img) return;
    img.style.transition = 'transform 0.2s ease';
    img.style.transform = 'rotate(15deg) scale(1.05)';
    setTimeout(() => { img.style.transform = 'rotate(-10deg)'; }, 200);
    setTimeout(() => { img.style.transform = 'rotate(0deg) scale(1)'; }, 400);
  };

  // -------- аудио/эффект «открытия» --------
  let __audioPrimed = false;
  function primeAudio(){
    if (__audioPrimed) return;
    ['sfx-bottle','sfx-can'].forEach(id=>{
      const el = document.getElementById(id);
      if (!el) return;
      el.volume = 0.95;
      try {
        el.play().then(()=>{ el.pause(); el.currentTime = 0; __audioPrimed = true; }).catch(()=>{});
      } catch {}
    });
  }
  function playOpenFx(kind='bottle'){
    const audio = document.getElementById(kind === 'can' ? 'sfx-can' : 'sfx-bottle');
    try { audio && (audio.currentTime = 0, audio.play()); } catch {}
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
    const bottle = document.getElementById('bottle');
    const cap    = document.getElementById('cap');
    const foam   = document.getElementById('foam');
    if (bottle){ bottle.classList.remove('bump'); void bottle.offsetWidth; bottle.classList.add('bump'); }
    if (cap){    cap.classList.remove('pop');     void cap.offsetWidth;    cap.classList.add('pop'); }
    if (foam){   foam.classList.remove('spray');  void foam.offsetWidth;   foam.classList.add('spray'); }
  }

  // -------- контакт в бота (1 раз) --------
  const sendContactToBot = () => {
    contactStr = telegramUser.username
      ? `@${telegramUser.username}`
      : `${telegramUser.first_name || 'user'}#${telegramUser.id}`;
    try {
      tg.sendData(JSON.stringify({ contact: contactStr }));
      log('sendData sent', { contact: contactStr });
    } catch (e) {
      log('sendData error', { err: safe(e?.message) });
    }
  };

  // -------- отправка «чока» на backend --------
  const sendShake = async () => {
    const now = Date.now();
    if (now - lastShakeTime < MIN_SHAKE_INTERVAL) return;
    lastShakeTime = now;

    animateBottle();
    $('status') && ($('status').textContent = 'Отправляем чок…');

    const name = telegramUser.first_name || telegramUser.username || `user_${telegramUser.id}`;
    const body = { telegramId: telegramUser.id, name, contact: contactStr || name };

    try {
      const r = await fetch(`${API_BASE}/shake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await r.json().catch(() => ({}));
      await log('shake resp', { ok: r.ok, data });

      if (!r.ok) {
        $('status') && ($('status').textContent = safe(data.message) || 'Ошибка сервера');
        return;
      }

      $('status') && ($('status').textContent = data.message || 'Чок засчитан!');
      const scoreEl = $('score');
      if (scoreEl && typeof data.bonus === 'number') {
        scoreEl.textContent = String((+scoreEl.textContent || 0) + data.bonus);
      }
      if (data.youGot) $('partner') && ($('partner').textContent = `Собеседник: ${data.youGot}`);

      // эффект «открытия»
      playOpenFx('bottle');
    } catch (e) {
      await log('shake fetch error', { err: safe(e?.message) });
      $('status') && ($('status').textContent = 'Не удалось отправить чок. Проверьте интернет.');
    }
  };

  // -------- обработка движения --------
  const onMotion = (ev) => {
    const a = ev.accelerationIncludingGravity || ev.acceleration;
    if (!a) return;
    const dx = (lastAccel.x == null ? 0 : Math.abs(a.x - lastAccel.x));
    const dy = (lastAccel.y == null ? 0 : Math.abs(a.y - lastAccel.y));
    const dz = (lastAccel.z == null ? 0 : Math.abs(a.z - lastAccel.z));
    lastAccel = { x: a.x, y: a.y, z: a.z };
    const magnitude = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (magnitude > SHAKE_THRESHOLD) sendShake();
  };

  // -------- старт --------
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      await ensureTgReady();

      // диагностика: видно, что Telegram есть и длина initData какая
      setStatusLine({
        msg: 'ready',
        tg: !!window.Telegram?.WebApp,
        platform: window.Telegram?.WebApp?.platform || 'n/a',
        initLen: (window.Telegram?.WebApp?.initData || '').length
      });

      telegramUser = extractUserSmart() || await waitForUser(2000);
      if (!telegramUser) {
        showOpenFromBot();
        return;
      }

      showUser(telegramUser);
      await log('user ok', { id: telegramUser.id });

      // кнопка «Чок!»: разблокируем звук, просим пермишн, шлём контакт
      $('shakeBtn')?.addEventListener('click', async () => {
        primeAudio(); // важно для iOS/Android
        try {
          await ensureMotionPermission();
          if (!contactStr) sendContactToBot();
          $('status') && ($('status').textContent = 'Готово! Теперь встряхните телефоны вместе.');
        } catch (_) {}
      });

      // события движения
      window.addEventListener('devicemotion', onMotion, { passive: true });

    } catch (e) {
      await log('init error', { err: safe(e?.message) });
      showOpenFromBot();
    }
  });
})();