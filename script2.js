(function () {
  // ====== настроики ======
  const API_BASE = (window.__API_BASE__ || location.origin).replace(/\/+$/,'');
  const SHAKE_THRESHOLD = 15;       // чувствительность встряски
  const MIN_SHAKE_INTERVAL = 1500;  // мс между "чоками"

  // ====== состояние ======
  let tg = null;
  let telegramUser = null;
  let lastShakeTime = 0;
  let lastAccel = { x: null, y: null, z: null };
  let contactStr = '';

  // ====== утилиты ======
  const $ = (id) => document.getElementById(id);
  const setStatus = (txt) => { const el = $('status'); if (el) el.textContent = txt; };
  const text = (node, s) => node && node.replaceChildren(document.createTextNode(s));

  // ====== темы (фон + картинка + звук) ======
  const THEMES = {
    classic: { title: 'Классика', bottle: 'efes-bottle.png', sfx: 'bottle', body: 'classic' },
    can:     { title: 'Банка',    bottle: 'efes-can.png',    sfx: 'can',     body: 'can' },
    gold:    { title: 'Gold',     bottle: 'efes-bottle.png', sfx: 'bottle',  body: 'gold' },
    dark:    { title: 'Dark',     bottle: 'efes-bottle.png', sfx: 'bottle',  body: 'dark' },
  };
  let currentTheme = localStorage.getItem('efes_theme') || 'classic';

  function applyTheme(key){
    if (!THEMES[key]) key = 'classic';
    currentTheme = key;
    localStorage.setItem('efes_theme', key);

    // фон/цвета через data-theme
    document.body.setAttribute('data-theme', THEMES[key].body || 'classic');

    // картинка бутылки/банки
    const img = $('bottle');
    if (img && THEMES[key].bottle) img.src = THEMES[key].bottle;
  }

  function mountThemeSelector(){
    const sel = $('themeSel');
    if (!sel) return; // если селектора нет в HTML — всё равно ок
    sel.innerHTML = Object.entries(THEMES)
      .map(([k,v]) => `<option value="${k}">${v.title}</option>`).join('');
    sel.value = currentTheme;
    sel.addEventListener('change', ()=> applyTheme(sel.value));
  }

  // ====== Telegram SDK ======
  async function ensureTgReady() {
    if (!window.Telegram || !window.Telegram.WebApp) {
      setStatus('Откройте мини-апп из бота по кнопке.');
      throw new Error('No Telegram.WebApp');
    }
    tg = window.Telegram.WebApp;
    try { tg.ready(); tg.expand?.(); } catch {}
    return tg;
  }

  // получаем user: сначала из initDataUnsafe.user, иначе парсим строку initData
  function extractUser() {
    const u = tg?.initDataUnsafe?.user;
    if (u && u.id) return u;
    const str = tg?.initData;
    if (typeof str === 'string' && str.length) {
      try {
        const p = new URLSearchParams(str);
        const j = p.get('user');
        if (j) {
          const parsed = JSON.parse(j);
          if (parsed?.id) return parsed;
        }
      } catch {}
    }
    return null;
  }

  async function waitForUser(ms = 2000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const u = extractUser();
      if (u?.id) return u;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  // ====== UI ======
  function showUser(u) {
    const name = u.username ? `@${u.username}` : (u.first_name || `user_${u.id}`);
    text($('username'), `${name}  #${u.id}`);
    setStatus('Готово! Нажмите «Чок!» и разрешите доступ к датчику движения.');
  }

  function showOpenFromBot() {
    text($('username'), 'Загрузка...');
    setStatus('Откройте мини-апп из бота по кнопке.');
    // Показать кнопку «Открыть из бота», если задан username бота
    const bot = (window.__BOT_USERNAME__ || '').trim();
    const btn = $('openFromBotBtn');
    if (btn && bot && tg?.openTelegramLink) {
      btn.style.display = 'inline-block';
      btn.onclick = () => tg.openTelegramLink(`https://t.me/${bot}?startapp=1`);
    }
  }

  // ====== разрешение на датчики (iOS) ======
  async function ensureMotionPermission() {
    if (typeof DeviceMotionEvent === 'undefined') return true;
    if (typeof DeviceMotionEvent.requestPermission !== 'function') return true;
    const st = await DeviceMotionEvent.requestPermission().catch(() => 'denied');
    if (st !== 'granted') {
      setStatus('Разрешите доступ к движению (нажмите «Чок!» и выберите Разрешить).');
      throw new Error('motion permission denied');
    }
    return true;
  }

  // ====== анимация бутылки ======
  function animateBottle() {
    const img = $('bottle'); if (!img) return;
    img.style.transition = 'transform 0.2s ease';
    img.style.transform = 'rotate(15deg) scale(1.05)';
    setTimeout(() => { img.style.transform = 'rotate(-10deg)'; }, 200);
    setTimeout(() => { img.style.transform = 'rotate(0deg) scale(1)'; }, 400);
  }

  // ====== аудио/эффект «открытия» ======
  let audioPrimed = false;
  function primeAudio() {
    if (audioPrimed) return;
    ['sfx-bottle','sfx-can'].forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      el.volume = 0.95;
      try { el.play().then(()=>{ el.pause(); el.currentTime = 0; audioPrimed = true; }).catch(()=>{}); } catch {}
    });
  }

  function playOpenFx() {
    const sfx = (THEMES[currentTheme]?.sfx === 'can') ? 'sfx-can' : 'sfx-bottle';
    const a = document.getElementById(sfx);
    try { a && (a.currentTime = 0, a.play()); } catch {}
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');

    const b = $('bottle'), c = $('cap'), f = $('foam');
    if (b){ b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    if (c){ c.classList.remove('pop');  void c.offsetWidth; c.classList.add('pop'); }
    if (f){ f.classList.remove('spray');void f.offsetWidth; f.classList.add('spray'); }
  }

  // ====== контакт в бота (1 раз, опционально) ======
  function sendContactToBot() {
    if (!tg || !telegramUser) return;
    const c = telegramUser.username ? '@'+telegramUser.username : (telegramUser.first_name || ('id:'+telegramUser.id));
    contactStr = c;
    try { tg.sendData(JSON.stringify({ contact: c })); } catch {}
  }

  // ====== отправка «чока» ======
  async function sendShake() {
    const now = Date.now();
    if (now - lastShakeTime < MIN_SHAKE_INTERVAL) return;
    lastShakeTime = now;

    animateBottle();
    setStatus('Отправляем чок…');

    const u = telegramUser;
    const name = u.username ? '@'+u.username : (u.first_name || `user_${u.id}`);
    const body = { telegramId: u.id, name, contact: contactStr || name };

    try {
      const r = await fetch(`${API_BASE}/shake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok) { setStatus(data.message || 'Ошибка сервера'); return; }

      setStatus(data.message || 'Чок засчитан!');
      const scoreEl = $('score');
      if (scoreEl && typeof data.bonus === 'number') {
        scoreEl.textContent = String((+scoreEl.textContent || 0) + data.bonus);
      }
      if (data.youGot) $('partner') && ($('partner').textContent = `Собеседник: ${data.youGot}`);

      playOpenFx();
    } catch {
      setStatus('Не удалось отправить чок. Проверьте интернет.');
    }
  }

  // ====== обработка движения (встряска) ======
  function onMotion(ev) {
    const a = ev.accelerationIncludingGravity || ev.acceleration;
    if (!a) return;
    const dx = (lastAccel.x == null ? 0 : Math.abs(a.x - lastAccel.x));
    const dy = (lastAccel.y == null ? 0 : Math.abs(a.y - lastAccel.y));
    const dz = (lastAccel.z == null ? 0 : Math.abs(a.z - lastAccel.z));
    lastAccel = { x: a.x, y: a.y, z: a.z };
    const m = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (m > SHAKE_THRESHOLD) sendShake();
  }

  // ====== старт ======
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      // применяем тему заранее (чтобы не мигало)
      applyTheme(currentTheme);
      mountThemeSelector();

      await ensureTgReady();
      setStatus('Загрузка...');

      telegramUser = extractUser() || await waitForUser(2000);
      if (!telegramUser) { showOpenFromBot(); return; }

      showUser(telegramUser);

      // «Чок!» — праймим аудио, просим доступ к датчикам, отправляем контакт
      $('shakeBtn')?.addEventListener('click', async () => {
        primeAudio();
        try {
          await ensureMotionPermission();
          if (!contactStr) sendContactToBot();
          setStatus('Готово! Встряхните телефоны рядом.');
        } catch {}
      });

      window.addEventListener('devicemotion', onMotion, { passive: true });
    } catch {
      showOpenFromBot();
    }
  });
})();
