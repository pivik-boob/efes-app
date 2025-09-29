const tg = window.Telegram?.WebApp;
if (tg) tg.ready();

const API = window.__API_BASE__ || '';
const BOT = window.__BOT_USERNAME__ || '';

// elements
const usernameEl = document.getElementById('username');
const scoreEl = document.getElementById('score');
const statusEl = document.getElementById('status');
const partnerEl = document.getElementById('partner');
const bottleEl = document.getElementById('bottle');
const capEl = document.getElementById('cap');
const foamEl = document.getElementById('foam');

const profileForm = document.getElementById('profileForm');
const nameInput = document.getElementById('nameInput');
const ageInput = document.getElementById('ageInput');
const moodInput = document.getElementById('moodInput');
const contactInput = document.getElementById('contactInput');
const saveProfileBtn = document.getElementById('saveProfileBtn');

const designSection = document.getElementById('designSection');
const designOptions = document.querySelectorAll('.design-card');
const saveDesignBtn = document.getElementById('saveDesignBtn');

const shakeBtn = document.getElementById('shakeBtn');
const historyList = document.getElementById('historyList');
const friendsBtn = document.getElementById('friendsBtn');
const giftBtn = document.getElementById('giftBtn');

const instaInput = document.getElementById('instaInput');
const saveInstaBtn = document.getElementById('saveInstaBtn');

const themeSel = document.getElementById('themeSel');

const editBlock = document.getElementById('editBlock');
const editBtn = document.getElementById('editBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const fillInChatBtn = document.getElementById('fillInChatBtn');

function showEdit(on) {
  if (!editBlock) return;
  editBlock.hidden = !on;
}

function openBotChat() {
  // имя бота берём из window.__BOT_USERNAME__ (оно уже задано в index.html)
  const uname = window.__BOT_USERNAME__ || '';
  if (tg?.openTelegramLink && uname) {
    tg.openTelegramLink(`https://t.me/${uname}`);
  } else {
    // запасной вариант — просто ссылка
    window.open(`https://t.me/${uname}`, '_blank');
  }
}
// utils
async function postJSON(url, body) {
  const auth = tg?.initData || '';
  const res = await fetch(API + url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': auth
    },
    body: JSON.stringify(body || {})
  });
  return res.json();
}

async function getJSON(url) {
  const auth = tg?.initData || '';
  const res = await fetch(API + url, {
    headers: { 'Authorization': auth }
  });
  return res.json();
}

// load profile
async function loadProfile() {
  try {
    const data = await getJSON('/api/profile/me');

    // скрываем редактор по умолчанию
    showEdit(false);

    if (data?.profile) {
      // профиль есть → заполняем отображение и прячем «Заполнить в чате»
      usernameEl.textContent = data.profile.name;
      scoreEl.textContent = data.profile.score || 0;

      if (fillInChatBtn) fillInChatBtn.style.display = 'none';

      // Если хочешь сразу подставлять значения в форму при редактировании:
      if (nameInput)   nameInput.value   = data.profile.name || '';
      if (ageInput)    ageInput.value    = data.profile.age  || '';
      if (moodInput)   moodInput.value   = data.profile.mood || '';
      if (contactInput)contactInput.value= data.profile.contact || '';

      // Если дизайн ещё не выбран — покажем секцию выбора
      if (!data.profile.design && designSection) {
        designSection.style.display = 'block';
      }
    } else {
      // профиля нет → ничего не показываем, предлагаем заполнить в чате
      if (fillInChatBtn) fillInChatBtn.style.display = 'inline-block';
    }
  } catch (e) {
    console.error(e);
  }
}
loadProfile();

// save profile
if (saveProfileBtn) {
  saveProfileBtn.onclick = async () => {
    const body = {
      name: nameInput.value,
      age: parseInt(ageInput.value),
      mood: moodInput.value,
      contact: contactInput.value
    };
    const r = await postJSON('/api/profile/save', body);
    if (r.ok) {
      showEdit(false);
      await loadProfile();
    } else {
      alert('Ошибка при сохранении анкеты');
    }
  };
}

// design
let selectedDesign = null;
designOptions.forEach(el => {
  el.onclick = () => {
    designOptions.forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    selectedDesign = el.dataset.design;
  };
});
if (saveDesignBtn) {
  saveDesignBtn.onclick = async () => {
    if (!selectedDesign) return alert('Выбери дизайн');
    const r = await postJSON('/api/save_design', { design: selectedDesign });
    if (r.ok) {
      designSection.style.display = 'none';
      await loadProfile();
    }
  };
}

// shake
let shaking = false;
let shakeTimeout;
function triggerAnimation() {
  bottleEl.classList.add('growshake');
  capEl.classList.add('pop');
  foamEl.classList.add('spray');
  setTimeout(() => {
    bottleEl.classList.remove('growshake');
    capEl.classList.remove('pop');
    foamEl.classList.remove('spray');
  }, 1200);
}
if (shakeBtn) {
  shakeBtn.onclick = () => {
    statusEl.textContent = 'Встряхни!';
    shaking = true;
    if (shakeTimeout) clearTimeout(shakeTimeout);
    shakeTimeout = setTimeout(() => {
      shaking = false;
      statusEl.textContent = 'Время вышло';
    }, 10000);
  };

  window.addEventListener('devicemotion', async (ev) => {
    if (!shaking) return;
    const acc = ev.accelerationIncludingGravity;
    if (acc && Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z) > 30) {
      shaking = false;
      triggerAnimation();
      statusEl.textContent = 'Чокаемся...';
      const r = await postJSON('/api/shake');
      if (r.partner) {
        partnerEl.textContent = 'Вы чокнулись с ' + r.partner.name;
        scoreEl.textContent = r.score;
        loadHistory();
      } else {
        partnerEl.textContent = 'Партнёр не найден';
      }
    }
  });
}

// history
async function loadHistory() {
  const data = await getJSON('/api/history');
  historyList.innerHTML = '';
  if (data?.history) {
    data.history.forEach(h => {
      const li = document.createElement('li');
      li.textContent = `${h.withName} — ${new Date(h.at).toLocaleString()}`;
      historyList.appendChild(li);
    });
  }
}
loadHistory();

// insta
if (saveInstaBtn) {
  saveInstaBtn.onclick = async () => {
    const r = await postJSON('/api/profile/save', { insta: instaInput.value });
    if (r.ok) alert('Сохранено!');
  };
}

// friends
if (friendsBtn) {
  friendsBtn.onclick = async () => {
    const d = await getJSON('/api/friends/today');
    alert(JSON.stringify(d.friends || []));
  };
}

// gift
if (giftBtn) {
  giftBtn.onclick = async () => {
    const d = await postJSON('/api/gift/create');
    if (d?.code) {
      alert('Твой код: ' + d.code);
    }
  };
}

// theme select
if (themeSel) {
  themeSel.innerHTML = `
    <option value="light">Светлая</option>
    <option value="dark">Тёмная</option>
  `;
  themeSel.onchange = () => {
    document.documentElement.setAttribute('data-theme', themeSel.value);
  };
}
if (editBtn) {
  editBtn.onclick = () => {
    // Если профиля ещё нет — отправим в чат
    if (fillInChatBtn && fillInChatBtn.style.display !== 'none') {
      return openBotChat();
    }
    showEdit(true);
  };
}

if (cancelEditBtn) {
  cancelEditBtn.onclick = () => showEdit(false);
}

if (fillInChatBtn) {
  fillInChatBtn.onclick = () => openBotChat();
}