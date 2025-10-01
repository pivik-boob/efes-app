// ===== Telegram Mini App bootstrap =====
const tg = window.Telegram?.WebApp;
if (tg) tg.ready();

const API = window.__API_BASE__ || "";
const BOT = window.__BOT_USERNAME__ || "";

// ===== Helpers: selectors (поддержка старых и новых ID) =====
function q(...ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}
function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
function setText(el, txt) { if (el) el.textContent = txt; }

// UI (оба набора ID, где известно)
const usernameEl  = q("username", "userName", "headerUsername");
const statusEl    = q("status", "stateText");
const partnerEl   = q("partner", "matchPartner");
const historyEl   = q("historyList", "history", "listHistory");
const shakeBtn    = q("shakeBtn", "btnShake", "btnCheers");

const editBlock   = q("editBlock", "profileEditBlock");
const editBtn     = q("editBtn", "btnEdit");
const cancelEdit  = q("cancelEditBtn", "btnCancelEdit");
const fillInChat  = q("fillInChatBtn", "btnFillInChat");

// профиль (анкета)
const formProfile = q("profileForm", "frmProfile");
const inpName     = q("inpName", "name", "inputName");
const inp21Yes    = q("inp21Yes", "age21yes");
const inp21No     = q("inp21No", "age21no");
const inpMood     = q("inpMood", "mood");
const inpDesign   = q("inpDesign", "designSelect");

// кнопки из твоего плана
const btnFriends  = q("friendsBtn", "btnFriends", "openFriends");
const btnGift     = q("giftBtn", "btnGift", "openGift");
const btnTheme    = q("themeBtn", "btnTheme", "openTheme");

// анимации (если есть)
const bottleEl = q("bottle");
const capEl    = q("cap");
const foamEl   = q("foam");

// ===== Fetch helpers =====
async function getJSON(url) {
  const auth = tg?.initData || "";
  const r = await fetch(API + url, { headers: { "Authorization": auth } });
  return r.json();
}
async function postJSON(url, body) {
  const auth = tg?.initData || "";
  const r = await fetch(API + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": auth },
    body: JSON.stringify(body || {})
  });
  return r.json();
}

// ===== Shims (оба API варианта) =====
async function saveProfile(data) {
  // 1) новый эндпоинт
  try {
    const r = await postJSON("/api/profile/update", data);
    if (r?.ok || r?.profile) return r;
  } catch {}
  // 2) старый эндпоинт
  try {
    const payload = {
      name: data.name,
      age: data.age21 === true ? 21 : (data.age21 === false ? 18 : undefined),
      mood: data.mood,
      contact: undefined // instagram не трогаем — анкета сама спросит в боте
    };
    const r = await postJSON("/api/profile/save", payload);
    if (r?.ok || r?.profile) return r;
  } catch {}
  return { ok: false };
}

async function saveDesign(design) {
  // 1) новый
  try {
    const r = await postJSON("/api/profile/design", { design });
    if (r?.ok || r?.profile) return r;
  } catch {}
  // 2) старый
  try {
    const r = await postJSON("/api/save_design", { design });
    if (r?.ok || r?.profile) return r;
  } catch {}
  return { ok: false };
}

// ===== Status helpers =====
function setStatus(txt) { setText(statusEl, txt || ""); }
function showEdit(on) { if (editBlock) editBlock.hidden = !on; }
function openBot() { if (BOT) window.location.href = `https://t.me/${BOT}`; }

// ===== Username из initData (без анкеты) =====
(function showInitUsername() {
  const u = tg?.initDataUnsafe?.user || null;
  if (!u) return;
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (u.username) {
    setText(usernameEl, full ? `${full} (@${u.username})` : `@${u.username}`);
  } else if (full && !usernameEl?.textContent) {
    setText(usernameEl, full);
  }
})();

// ===== Профиль/История =====
async function loadProfile() {
  try {
    const r = await getJSON("/api/profile/me");
    const p = r?.profile;
    if (!p) {
      if (fillInChat) fillInChat.style.display = "";
      return;
    }
    if (fillInChat) fillInChat.style.display = "none";
    // если у пользователя нет tg username — покажем имя из профиля
    if (!(tg?.initDataUnsafe?.user?.username)) {
      setText(usernameEl, p.name || "Гость");
    }
    // заполнить форму (если есть поля)
    if (inpName && !inpName.value) inpName.value = p.name || "";
    if (typeof p.age21 === "boolean") {
      if (p.age21 && inp21Yes) inp21Yes.checked = true;
      if (!p.age21 && inp21No) inp21No.checked = true;
    }
    if (inpMood && !inpMood.value)   inpMood.value = p.mood || "🙂";
    if (inpDesign && !inpDesign.value) inpDesign.value = p.design || "classic";
  } catch {}
}

async function loadHistory() {
  try {
    const r = await getJSON("/api/history");
    const hist = r?.history || [];
    if (!historyEl) return;
    historyEl.innerHTML = "";
    hist.forEach(h => {
      const li = document.createElement("li");
      const uname = h.withUsername ? ` (@${h.withUsername})` : "";
      const when = h.at ? ` — ${new Date(h.at).toLocaleString()}` : "";
      li.textContent = `${h.withName}${uname}${when}`;
      historyEl.appendChild(li);
    });
  } catch {}
}

// ===== Анкета (инстаграм не трогаем) =====
if (formProfile) {
  on(formProfile, "submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: (inpName?.value || "").trim(),
      age21: inp21Yes?.checked ? true : (inp21No?.checked ? false : undefined),
      mood: (inpMood?.value || "").trim(),
      design: (inpDesign?.value || "").trim()
    };
    const r = await saveProfile(payload);
    if (r?.ok || r?.profile) {
      showEdit(false);
      await loadProfile();
      setStatus("Анкета обновлена ✅");
    } else {
      setStatus("Не удалось сохранить анкету");
    }
  });
}
if (editBtn)     on(editBtn, "click", () => { 
  if (fillInChat && fillInChat.style.display !== "none") return openBot();
  showEdit(true);
});
if (cancelEdit)  on(cancelEdit, "click", () => showEdit(false));
if (fillInChat)  on(fillInChat, "click", openBot);

// ===== Friends / Gift / Theme =====
if (btnFriends) {
  on(btnFriends, "click", async () => {
    await loadHistory();
    setStatus("Показана история чоков 📜");
  });
}
if (btnGift) {
  on(btnGift, "click", async () => {
    try {
      const r = await postJSON("/api/gift/create", {}); // твой сервер вернёт {ok, code, link}
      if (r?.ok && r.link) {
        setStatus("Подарочный код создан 🎁");
        // можно показать модалку/alert, чтобы скопировать
        alert(`Подарочный код: ${r.code}\nСсылка: ${r.link}`);
      } else {
        setStatus("Не удалось создать подарок");
      }
    } catch {
      setStatus("Ошибка при создании подарка");
    }
  });
}
if (btnTheme) {
  on(btnTheme, "click", async () => {
    // === Темы (фон + картинка) ===
const THEMES = {
  efes:   { bgClass: 'theme-efes',   bottleSrc: 'img/ефес.jpg',          label: 'EFES' },
  miller: { bgClass: 'theme-miller', bottleSrc: 'img/миллер.jpg',        label: 'Miller' },
  ruzka:  { bgClass: 'theme-ruzka',  bottleSrc: 'img/ружка свежего.jpg', label: 'Кружка свежего' },
  medved: { bgClass: 'theme-medved', bottleSrc: 'img/медведь.jpg',       label: 'Белый медведь' },
};

function setTheme(name) {
  const cfg = THEMES[name] || THEMES.efes;
  document.body.className = cfg.bgClass;
  const bottle = document.getElementById('bottle');
  if (bottle) bottle.src = cfg.bottleSrc;
  try { localStorage.setItem('efes_theme', name); } catch(_) {}
}

function initThemesUI() {
  const sel = document.getElementById('themeSel');
  if (!sel) return;
  let saved = null;
  try { saved = localStorage.getItem('efes_theme'); } catch(_) {}
  setTheme(saved || 'efes');
  sel.value = saved || 'efes';
  sel.addEventListener('change', e => setTheme(e.target.value));
}
  });
}

// === Анимация бутылки ===
window.shakeBottle = function(){
  const bottle = document.getElementById('bottle');
  const cap    = document.getElementById('cap');
  const foam   = document.getElementById('foam');

  [bottle, cap, foam].forEach(el=>{
    if(!el) return;
    el.classList.remove('growshake','pop','spray');
    void el.offsetWidth; // reset
  });

  bottle?.classList.add('growshake');
  cap?.classList.add('pop');
  foam?.classList.add('spray');

  document.getElementById('sfx-bottle')?.play?.();
};

// ===== iOS motion permission =====
async function ensureMotionPermission() {
  try {
    // @ts-ignore
    if (typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function") {
      const st = await DeviceMotionEvent.requestPermission();
      return st === "granted";
    }
    return true;
  } catch { return false; }
}

// ===== Shake detection (улучшённая) =====
let listening = false;
let listenTimer = null;
let lastHistoryTs = 0;

function mag(acc) {
  if (!acc) return 0;
  return Math.abs(acc.x||0) + Math.abs(acc.y||0) + Math.abs(acc.z||0);
}
async function snapshotHistory() {
  const d = await getJSON("/api/history");
  const last = (d?.history || [])[0];
  lastHistoryTs = last ? new Date(last.at).getTime() : 0;
}
async function waitPartner(deadline) {
  setStatus("Ищу партнёра рядом…");
  while (Date.now() < deadline) {
    const d = await getJSON("/api/history");
    const last = (d?.history || [])[0];
    if (last) {
      const ts = new Date(last.at).getTime();
      if (!lastHistoryTs || ts > lastHistoryTs) {
        setText(partnerEl, `Вы чокнулись с ${last.withName}${last.withUsername ? ` (@${last.withUsername})` : ""}`);
        await loadProfile();
        await loadHistory();
        setStatus("Готов к чок 🥂");
        return true;
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function onShake() {
  listening = false;
  anim();
  setStatus("Чокаемся…");

  await snapshotHistory();

  const r = await postJSON("/api/shake", {});
  // поддержка "старого" ответа (partner/score), и "нового" (other, already_today, waiting)
  if (r?.status === "matched" && r.other) {
    setText(partnerEl, `Вы чокнулись с ${r.other.name}${r.other.username ? ` (@${r.other.username})` : ""}`);
    await loadProfile();
    await loadHistory();
    setStatus("Готов к чок 🥂");
    return;
  }
  if (r?.partner) { // старый формат
    setText(partnerEl, `Вы чокнулись с ${r.partner.name || "Гость"}`);
    await loadProfile();
    await loadHistory();
    setStatus("Готов к чок 🥂");
    return;
  }
  if (r?.status === "already_today") {
    setStatus("С этой парой уже был чок сегодня");
    return;
  }
  if (r?.status === "need_profile") {
    setStatus("Заполни анкету (нужно подтвердить 21+)");
    return;
  }
  // waiting → ждём второго до 12 сек
  const ok = await waitPartner(Date.now() + 12000);
  if (!ok) {
    setText(partnerEl, "");
    setStatus("Никого рядом. Попробуй ещё раз");
  }
}

async function startListen() {
  const ok = await ensureMotionPermission();
  if (!ok) { setStatus("Разреши доступ к датчикам движения"); return; }
  setStatus("Встряхни!");
  listening = true;
  clearTimeout(listenTimer);
  listenTimer = setTimeout(() => {
    listening = false;
    setStatus("Время вышло");
  }, 12000);
}

window.addEventListener("devicemotion", (ev) => {
  if (!listening) return;
  if (mag(ev.accelerationIncludingGravity) > 30) onShake();
}, { passive: true });

if (shakeBtn) on(shakeBtn, "click", startListen);

// ===== первичная загрузка =====
loadProfile();
loadHistory();
setStatus("Готов к чок 🥂");