(function () {
  // ======== ENV / TG ========
  const API = window.__API_BASE__ || location.origin;
  const tg = window.Telegram?.WebApp;
  tg && tg.ready();
  const TG_INIT_DATA = tg?.initData || '';

  function getUid() {
    const fromTG = tg?.initDataUnsafe?.user?.id;
    if (fromTG) return String(fromTG);
    const q = new URLSearchParams(location.search);
    return q.get('uid') || 'debug-user';
  }
  const UID = getUid();

  // ======== HELPERS ========
  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, tgInitData: TG_INIT_DATA })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return [...document.querySelectorAll(sel)]; }
  function show(el) { if (el) el.style.display = ''; }
  function hide(el) { if (el) el.style.display = 'none'; }

  // ======== DOM HOOKS (проверь, что эти id есть в index.html) ========
  const elName = $('#username');      // текст: имя/статус
  const elStatus = $('#status');      // текст: статус процесса
  const elPartner = $('#partner');    // текст: последний матч
  const elScore = $('#score');        // опционально (если используешь)

  const btnShake = $('#shakeBtn');    // кнопка "Чок!"
  const btnFriends = $('#friendsBtn');// "Мои знакомства"
  const btnGift = $('#giftBtn');      // "Угостить 🍺"

  // Анкета (1 раз)
  const formWrap = $('#profileForm'); // контейнер анкеты
  const inName = $('#nameInput');
  const inAge = $('#ageInput');
  const inMood = $('#moodInput');
  const inContact = $('#contactInput');
  const btnSaveProfile = $('#saveProfileBtn');

  // Дизайн (выбор из карточек или кнопок)
  const designWrap = $('#designSection');
  const designList = $('#designOptions'); // элементы с data-design="classic|fest|ornament"
  const btnSaveDesign = $('#saveDesignBtn');

  // ======== STATE ========
  let selectedDesign = null;
  let motionEnabled = false;
  let lastShakeTs = 0;

  // ======== PROFILE (один раз) ========
  async function loadProfile() {
    try {
      const r = await getJSON(`${API}/api/profile?uid=${UID}`);
      if (!r.exists) {
        // Профиля нет — показываем анкету
        show(formWrap);
        hide(designWrap);
        if (elStatus) elStatus.textContent = 'Заполни анкету и выбери бутылочку';
      } else {
        // Профиль есть — скрываем анкету
        hide(formWrap);
        const p = r.profile || {};
        if (elName) elName.textContent = p.name || 'Гость';
        if (elScore) elScore.textContent = p.score || 0;
        if (elStatus) elStatus.textContent = 'Готов к знакомству 🥂';
        // Если не выбран дизайн — покажем секцию выбора или предложим пройти квиз
        if (!p.design) {
          show(designWrap);
        } else {
          hide(designWrap);
          selectedDesign = p.design;
        }
      }
    } catch (e) {
      console.error(e);
      if (elStatus) elStatus.textContent = 'Ошибка загрузки профиля';
    }
  }

  async function saveProfile() {
    const name = inName?.value?.trim();
    const age = Number(inAge?.value || 0);
    const mood = inMood?.value?.trim();
    const contact = inContact?.value?.trim();
    if (!name || !age || !mood || !contact || age < 16) {
      alert('Заполни все поля (возраст >= 16).');
      return;
    }
    try {
      await postJSON(`${API}/api/profile/save`, { uid: UID, name, age, mood, contact });
      hide(formWrap);
      if (elName) elName.textContent = name;
      if (elStatus) elStatus.textContent = 'Профиль сохранён ✔ Выбери дизайн или пройди квиз';
      // После анкеты — если нет дизайна, покажем выбор
      show(designWrap);
    } catch (e) {
      console.error(e);
      alert('Не удалось сохранить анкету. Попробуй ещё раз.');
    }
  }

  // ======== DESIGN ========
  function initDesignPicker() {
    if (!designList) return;
    // клик по карточке дизайна
    designList.addEventListener('click', (ev) => {
      const card = ev.target.closest('[data-design]');
      if (!card) return;
      $all('#designOptions [data-design]').forEach(el => el.classList.remove('selected'));
      card.classList.add('selected');
      selectedDesign = card.getAttribute('data-design');
    });
    btnSaveDesign?.addEventListener('click', async () => {
      if (!selectedDesign) return alert('Выбери дизайн (или пройди тест /quiz).');
      try {
        await postJSON(`${API}/api/save_design`, { uid: UID, design: selectedDesign });
        if (elStatus) elStatus.textContent = 'Дизайн сохранён ✔ Можешь чокаться!';
        hide(designWrap);
      } catch (e) {
        console.error(e);
        alert('Не удалось сохранить дизайн.');
      }
    });
  }

  // ======== SHAKE (встряхивание) ========
  // Детектор встряхивания: делаем просто, как в ТЗ — смотрим модуль ускорения.
  // Если акселерометра нет — можно нажать кнопку "Чок!" (кнопка всегда работает).
  const SHAKE_THRESHOLD = 20; // эмпирический порог
  function onDeviceMotion(ev) {
    const acc = ev.accelerationIncludingGravity;
    if (!acc) return;
    const m = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
    const now = Date.now();
    if (m > SHAKE_THRESHOLD && now - lastShakeTs > 800) {
      lastShakeTs = now;
      doShake(now);
    }
  }
  function enableMotion() {
    if (motionEnabled) return;
    if (window.DeviceMotionEvent) {
      window.addEventListener('devicemotion', onDeviceMotion);
      motionEnabled = true;
    }
  }
  function disableMotion() {
    if (!motionEnabled) return;
    window.removeEventListener('devicemotion', onDeviceMotion);
    motionEnabled = false;
  }

  async function doShake(ts) {
    if (elStatus) elStatus.textContent = 'Ищем пару...';
    try {
      const r = await postJSON(`${API}/api/shake`, { uid: UID, ts: ts || Date.now() });
      if (r.status === 'waiting') {
        if (elStatus) elStatus.textContent = 'Ждём партнёра (встряхните вместе в течение 2 сек)…';
        // Небольшая подсказка вибрацией на поддерживаемых устройствах
        if (navigator.vibrate) navigator.vibrate(50);
      } else if (r.status === 'matched') {
        if (elStatus) elStatus.textContent = 'Познакомились! 🎉';
        const otherName = r.other?.name || r.partner_id;
        if (elPartner) elPartner.textContent = `Новый контакт: ${otherName}`;
        // визуальная "анимация чока": добавить класс на бутылку, если у тебя он есть в CSS
        document.body.classList.add('cheers');
        setTimeout(() => document.body.classList.remove('cheers'), 1200);
      } else {
        if (elStatus) elStatus.textContent = 'Не получилось. Попробуйте ещё раз.';
      }
    } catch (e) {
      console.error(e);
      if (elStatus) elStatus.textContent = 'Ошибка соединения 🙈';
    }
  }

  // ======== FRIENDS TODAY ========
  async function showFriends() {
    try {
      const r = await getJSON(`${API}/api/friends/today?uid=${UID}`);
      const list = r.list || [];
      if (!list.length) {
        alert('Сегодня знакомств пока нет.');
        return;
      }
      const msg = list.map((f, i) => `${i + 1}) ${f.profile?.name || f.user_id} — ${f.profile?.contact || ''}`).join('\n');
      alert(`Мои знакомства за сегодня:\n${msg}`);
    } catch (e) {
      console.error(e);
      alert('Ошибка загрузки списка.');
    }
  }

  // ======== GIFTS (подарить пиво) ========
  async function createGift() {
    try {
      // Запросим ID получателя (лучше выбрать из "Моих знакомств", но сделаем просто)
      const toUser = prompt('Введи user_id получателя (или открой "Мои знакомства" и скопируй):');
      if (!toUser) return;
      const message = prompt('Короткое сообщение к подарку (необязательно):') || '';
      const r = await postJSON(`${API}/api/gift/create`, { from: UID, to: toUser, message });
      if (!r.ok) throw new Error('gift create failed');
      // Показать QR и ссылку для бармена
      const w = window.open('', '_blank');
      w.document.write(`
        <html><head><title>Подарок создан</title></head><body style="font-family:Arial">
          <h3>Подарок создан!</h3>
          <p><b>Код:</b> ${r.voucher}</p>
          <p><img src="${r.qr}" alt="QR" /></p>
          <p><a href="${r.targetUrl}" target="_blank">Открыть страницу проверки</a></p>
          <p>Покажи это бармену для выдачи пива.</p>
        </body></html>
      `);
    } catch (e) {
      console.error(e);
      alert('Не удалось создать подарок.');
    }
  }

  // ======== INIT ========
  function bindUI() {
    btnSaveProfile?.addEventListener('click', saveProfile);
    btnShake?.addEventListener('click', () => doShake(Date.now()));
    btnFriends?.addEventListener('click', showFriends);
    btnGift?.addEventListener('click', createGift);

    // Включим акселерометр (если браузер позволит). На iOS может потребоваться жест/разрешение;
    // поэтому ещё оставляем рабочей кнопку "Чок!" (она всегда доступна).
    enableMotion();

    initDesignPicker();
  }

  // старт
  bindUI();
  loadProfile();
})();