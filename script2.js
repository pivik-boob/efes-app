// script2.js — кнопка/тряска, звук/анимации, отправка userId/insta/initData на сервер
(function () {
  const API_BASE = window.__API_BASE__ || '';
  const BOT_USERNAME = window.__BOT_USERNAME__ || '';

  // --- DOM ---
  const els = {
    username: document.getElementById('username'),
    score: document.getElementById('score'),
    status: document.getElementById('status'),
    partner: document.getElementById('partner'),
    bottle: document.getElementById('bottle'),
    cap: document.getElementById('cap'),
    foam: document.getElementById('foam'),
    shakeBtn: document.getElementById('shakeBtn'),
    openFromBotBtn: document.getElementById('openFromBotBtn'),
    themeSel: document.getElementById('themeSel'),
    sfxBottle: document.getElementById('sfx-bottle'),
    sfxCan: document.getElementById('sfx-can'),
    instaInput: document.getElementById('instaInput'),
    saveInstaBtn: document.getElementById('saveInstaBtn'),
  };

  // --- Telegram WebApp detection ---
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const inTelegram = Boolean(tg && tg.initDataUnsafe);

  // --- Instagram helpers ---
  function getInsta() {
    return localStorage.getItem('insta') || '';
  }
  function saveInsta(nick) {
    if (!nick) return;
    const clean = String(nick).trim().replace(/^@/, '');
    if (clean.length === 0) return;
    localStorage.setItem('insta', clean);
    els.status.textContent = 'Instagram сохранён';
    setTimeout(() => (els.status.textContent = 'Готов к чок 🥂'), 1200);
    if (els.instaInput) els.instaInput.value = '@' + clean;
  }

  // Показ имени / fallback‑кнопки / автозаполнение инсты
  (function initHeader() {
    if (inTelegram) {
      try {
        tg.ready();
        const user = tg.initDataUnsafe && tg.initDataUnsafe.user;
        els.username.textContent = user?.first_name
          ? `Привет, ${user.first_name}!`
          : 'Готов к чок 🥂';
      } catch (_) {
        els.username.textContent = 'Готов к чок 🥂';
      }
    } else {
      els.username.textContent = 'Открой из Telegram 👇';
      if (els.openFromBotBtn && BOT_USERNAME) {
        els.openFromBotBtn.style.display = 'inline-block';
        els.openFromBotBtn.onclick = () => {
          const url = `https://t.me/${BOT_USERNAME}?startapp=home`;
          window.open(url, '_blank');
        };
      }
    }
    // заполним поле инсты
    if (els.instaInput) {
      const cur = getInsta();
      els.instaInput.value = cur ? '@' + cur : '';
    }
    if (els.saveInstaBtn) {
      els.saveInstaBtn.addEventListener('click', () => {
        const val = els.instaInput?.value || '';
        if (val) saveInsta(val);
      });
    }
  })();

  // --- Аудио: разблокировка (iOS) ---
  let audioUnlocked = false;
  function unlockAudioOnce() {
    if (audioUnlocked) return;
    [els.sfxBottle, els.sfxCan].forEach(a => {
      try { a.play().then(() => a.pause()).catch(() => {}); } catch(_) {}
    });
    audioUnlocked = true;
    window.removeEventListener('touchstart', unlockAudioOnce, { passive: true });
    window.removeEventListener('click', unlockAudioOnce);
  }
  window.addEventListener('touchstart', unlockAudioOnce, { passive: true });
  window.addEventListener('click', unlockAudioOnce);

  // --- Очки/состояние на клиенте (MVP) ---
  let score = 0;
  let busy = false;
  let lastShakeAt = 0;

  // --- Звук + анимации ---
  function playSfx() {
    const useBottle = Math.random() > 0.35;
    const node = useBottle ? els.sfxBottle : els.sfxCan;
    try { node.currentTime = 0; node.play().catch(() => {}); } catch(_) {}
  }
  function animateBottle() {
    // классы из style.css: .cap.pop, .foam.spray, .bottle-img.bump
    els.cap.classList.remove('pop');    void els.cap.offsetWidth;    els.cap.classList.add('pop');
    els.foam.classList.remove('spray'); void els.foam.offsetWidth;   els.foam.classList.add('spray');
    els.bottle.classList.remove('bump');void els.bottle.offsetWidth; els.bottle.classList.add('bump');
  }

  // --- Отправка события на сервер ---
  async function sendShake(source) {
    const user = inTelegram && tg.initDataUnsafe ? tg.initDataUnsafe.user : null;
    const payload = {
      userId: user?.id || null,
      username: user?.username || null,
      insta: getInsta(),
      clientTs: Date.now(),
      source,
      device: navigator.userAgent || '',
      initData: inTelegram ? (tg.initData || '') : '' // строка для HMAC-проверки (если включишь на бэке)
    };

    try {
      const res = await fetch(`${API_BASE}/shake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        // очки (локально), статус и партнёр
        score += Number(data.bonus || 1);
        els.score.textContent = String(score);
        els.status.textContent = data.message || 'Чок засчитан!';
        if (data.partner) {
          const nick = data.partner.username || data.partner.userId || 'гость';
          const instaTxt = data.partner.insta ? ` (insta: @${data.partner.insta})` : '';
          els.partner.textContent = `Ты чокнулся с @${nick}${instaTxt}`;
        }
      } else {
        els.status.textContent = (data && data.message) || 'Попробуй ещё раз';
      }
    } catch {
      els.status.textContent = 'Нет связи. Проверь интернет';
    }
  }

  async function doCheers(source) {
    if (busy) return;
    busy = true;
    playSfx();
    animateBottle();
    await sendShake(source);
    setTimeout(() => { busy = false; }, 600);
  }

  // --- Кнопка "Чок!" ---
  if (els.shakeBtn) {
    els.shakeBtn.addEventListener('click', () => doCheers('button'));
  }

  // --- Детектор тряски (мобильные) ---
  let lastAccel = { x: null, y: null, z: null };
  const THRESHOLD = 14;      // чувствительность
  const MIN_INTERVAL = 1200; // не чаще 1.2с

  function onMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration || {};
    const { x, y, z } = a;
    if ([x, y, z].some(v => typeof v !== 'number')) return;

    if (lastAccel.x === null) {
      lastAccel = { x, y, z };
      return;
    }
    const dx = Math.abs(x - lastAccel.x);
    const dy = Math.abs(y - lastAccel.y);
    const dz = Math.abs(z - lastAccel.z);
    lastAccel = { x, y, z };

    const magnitude = dx + dy + dz;
    const now = Date.now();

    if (magnitude > THRESHOLD && (now - lastShakeAt) > MIN_INTERVAL) {
      lastShakeAt = now;
      doCheers('shake');
      if (navigator.vibrate) { try { navigator.vibrate(40); } catch(_) {} }
    }
  }

  async function enableShake() {
    const Sensor = window.DeviceMotionEvent;
    if (!Sensor) return;
    try {
      if (typeof Sensor.requestPermission === 'function') {
        const p = await Sensor.requestPermission().catch(() => 'denied');
        if (p !== 'granted') return;
      }
      window.addEventListener('devicemotion', onMotion, { passive: true });
    } catch {}
  }
  enableShake();

  // --- Тема (пример) ---
  if (els.themeSel) {
    els.themeSel.innerHTML = `
      <option value="light">Светлая</option>
      <option value="dark">Тёмная</option>
    `;
    els.themeSel.addEventListener('change', () => {
      document.documentElement.dataset.theme = els.themeSel.value;
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) els.status.textContent = 'Готов к чок 🥂';
  });
})();