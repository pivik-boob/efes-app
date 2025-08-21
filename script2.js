// script2.js — устойчивый старт в Telegram Mini App + чок по встряске
(function () {
  // ------------- настройки/состояние -------------
  const API_BASE = (window.__API_BASE__ || 'https://efes-app.onrender.com').replace(/\/+$/,'');
  const SHAKE_THRESHOLD = 15;        // чувствительность встряски
  const MIN_SHAKE_INTERVAL = 1500;   // мс между «чоками», чтобы не спамить

  let tg = null;              // Telegram.WebApp
  let telegramUser = null;    // объект пользователя из initDataUnsafe
  let hasMotionPermission = false;
  let lastShakeTime = 0;
  let lastAccel = { x: null, y: null, z: null };
  let contactStr = '';        // что шлём как "contact" на бэк

  // ------------- утилиты -------------
  const $ = (id) => document.getElementById(id);
  const safe = (s) => (s == null ? '' : String(s));

  const log = async (msg, extra = {}) => {
    try {
      await fetch(`${API_BASE}/debug-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg, ...extra })
      });
    } catch (_) { /* тихо */ }
  };
  // === АУДИО + ЭФФЕКТ ОТКРЫТИЯ ===
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
  // звук
  const audio = document.getElementById(kind === 'can' ? 'sfx-can' : 'sfx-bottle');
  try { audio && (audio.currentTime = 0, audio.play()); } catch {}

  // хаптик (в вебвью Телеги)
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');

  // анимации (работают даже если cap/foam не добавлены — просто пропустятся)
  const bottle = document.getElementById('bottle');
  const cap    = document.getElementById('cap');
  const foam   = document.getElementById('foam');
  if (bottle){ bottle.classList.remove('bump'); void bottle.offsetWidth; bottle.classList.add('bump'); }

  if (cap){   cap.classList.remove('pop');   void cap.offsetWidth;   cap.classList.add('pop'); }
  if (foam){  foam.classList.remove('spray');void foam.offsetWidth;  foam.classList.add('spray'); }
}

  // ------------- инициализация Telegram -------------
  const ensureTgReady = async () => {
    if (!window.Telegram || !window.Telegram.WebApp) {
      await log('No Telegram.WebApp on window');
      throw new Error('Откройте мини-апп из бота Telegram');
    }
    tg = window.Telegram.WebApp;
    try { tg.ready(); } catch (_) {}
    await log('TG ready', { platform: tg.platform });
    return tg;
  };

  // ------------- получаем пользователя -------------
  const getTgUser = () => {
    const u = tg?.initDataUnsafe?.user;
    return u && u.id ? u : null;
  };

  // ------------- UI заполнение -------------
  const showUser = (u) => {
    const name = u.first_name || u.username || `user_${u.id}`;
    $('username') && ($('username').textContent = `${name}  #${u.id}`);
    $('status') && ($('status').textContent = 'Готов! Теперь дайте доступ к датчикам и встряхните телефон.');
  };

  const showOpenFromBot = () => {
    $('username') && ($('username').textContent = 'Загрузка…');
    $('status') && ($('status').textContent = 'Нет данных пользователя. Откройте мини-апп из бота.');
  };

  // ------------- разрешение на акселерометр (iOS) -------------
  const ensureMotionPermission = async () => {
    if (typeof DeviceMotionEvent === 'undefined') return true;
    if (typeof DeviceMotionEvent.requestPermission !== 'function') return true;

    const st = await DeviceMotionEvent.requestPermission().catch(() => 'denied');
    hasMotionPermission = (st === 'granted');
    if (!hasMotionPermission) {
      $('status') && ($('status').textContent =
        'Разрешите доступ к движению/акселерометру (нажмите "Чок!" и выберите Разрешить).');
      throw new Error('motion permission denied');
    }
    return true;
  };

  // ------------- анимация бутылки -------------
  const animateBottle = () => {
    const img = $('bottle');
    if (!img) return;
    img.style.transition = 'transform 0.2s ease';
    img.style.transform = 'rotate(15deg) scale(1.05)';
    setTimeout(() => { img.style.transform = 'rotate(-10deg)'; }, 200);
    setTimeout(() => { img.style.transform = 'rotate(0deg) scale(1)'; }, 400);
  };

  // ------------- отправка контакта боту (1 раз) -------------
  const sendContactToBot = () => {
    // @username если есть, иначе first_name#id
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

  // ------------- отправка чока на backend -------------
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
      // у тебя учёт очков на бэке; на фронте просто показываем инкремент визуально
      scoreEl.textContent = String((+scoreEl.textContent || 0) + data.bonus);
    }
    if (data.youGot) {
      $('partner') && ($('partner').textContent = `Собеседник: ${data.youGot}`);
    }

    // 🔊✨ эффект (звук + мини-анимация)
    playOpenFx('bottle'); // ← добавленная строка

  } catch (e) {
    await log('shake fetch error', { err: safe(e?.message) });
    $('status') && ($('status').textContent = 'Не удалось отправить чок. Проверьте интернет.');
  }
};
// === АУДИО + ЭФФЕКТ ОТКРЫТИЯ ===
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
  // звук
  const audio = document.getElementById(kind === 'can' ? 'sfx-can' : 'sfx-bottle');
  try { audio && (audio.currentTime = 0, audio.play()); } catch {}

  // хаптик
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');

  // лёгкая анимация (работает даже если нет cap/foam)
  const bottle = document.getElementById('bottle');
  const cap    = document.getElementById('cap');
  const foam   = document.getElementById('foam');
  if (bottle){ bottle.classList.remove('bump'); void bottle.offsetWidth; bottle.classList.add('bump'); }
  if (cap){    cap.classList.remove('pop');     void cap.offsetWidth;    cap.classList.add('pop'); }
  if (foam){   foam.classList.remove('spray');  void foam.offsetWidth;   foam.classList.add('spray'); }
}
  // ------------- обработка движения (встряска) -------------
  const onMotion = (ev) => {
    const a = ev.accelerationIncludingGravity || ev.acceleration;
    if (!a) return;

    const dx = (lastAccel.x == null ? 0 : Math.abs(a.x - lastAccel.x));
    const dy = (lastAccel.y == null ? 0 : Math.abs(a.y - lastAccel.y));
    const dz = (lastAccel.z == null ? 0 : Math.abs(a.z - lastAccel.z));
    lastAccel = { x: a.x, y: a.y, z: a.z };

    const magnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (magnitude > SHAKE_THRESHOLD) sendShake();
  };

  // ------------- старт приложения -------------
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      await ensureTgReady();
      telegramUser = getTgUser();

      if (!telegramUser) {
        showOpenFromBot();
        return;
      }

      showUser(telegramUser);
      await log('user ok', { id: telegramUser.id });

      // Кнопка «Чок!» — просим разрешение + шлём контакт боту (1 раз)
    $('shakeBtn')?.addEventListener('click', async () => {
  primeAudio();
  try {
    await ensureMotionPermission();
    if (!contactStr) sendContactToBot();
    $('status') && ($('status').textContent = 'Готово! Теперь встряхните телефоны вместе.');
  } catch (_) {
    // ...
  }
});

      // Подписка на движение — после первого разрешения
      window.addEventListener('devicemotion', onMotion);

    } catch (e) {
      await log('init error', { err: safe(e?.message) });
      showOpenFromBot();
    }
  });
})();