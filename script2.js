const tg = window.Telegram?.WebApp;
if (tg) tg.ready();
const API_BASE = window.__API_BASE__ || "";
const BOT_USERNAME = window.__BOT_USERNAME__ || "";

const els = {
  card: document.querySelector(".card"),
  username: document.getElementById("username"),
  status: document.getElementById("status"),
  partner: document.getElementById("partner"),
  shakeBtn: document.getElementById("shakeBtn"),
  bottle: document.getElementById("bottle"),
  cap: document.getElementById("cap"),
  foam: document.getElementById("foam"),
  shakeTimer: document.getElementById("shakeTimer"),
  shakeCountdown: document.getElementById("shakeCountdown"),
  levelLabel: document.getElementById("levelLabel"),
  titleLabel: document.getElementById("titleLabel"),
  xpLabel: document.getElementById("xpLabel"),
  streakLabel: document.getElementById("streakLabel"),
  xpFill: document.getElementById("xpFill"),
  xpBar: document.querySelector(".xp-bar"),
  questList: document.getElementById("questList"),
  editBlock: document.getElementById("editBlock"),
  editBtn: document.getElementById("editBtn"),
  cancelEditBtn: document.getElementById("cancelEditBtn"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  nameInput: document.getElementById("nameInput"),
  ageInput: document.getElementById("ageInput"),
  moodInput: document.getElementById("moodInput"),
  contactInput: document.getElementById("contactInput"),
  fillInChatBtn: document.getElementById("fillInChatBtn"),
  friendsBtn: document.getElementById("friendsBtn"),
  themeSelect: document.getElementById("themeSel"),
  historyList: document.getElementById("historyList"),
  historyBox: document.getElementById("historyBox"),
  designSection: document.getElementById("designSection"),
  designOptions: document.getElementById("designOptions"),
  saveDesignBtn: document.getElementById("saveDesignBtn"),
  openFromBotBtn: document.getElementById("openFromBotBtn"),
};

const state = {
  listening: false,
  countdownTimer: null,
  countdownEndsAt: 0,
  lastHistoryTimestamp: 0,
  selectedDesign: "efes",
  profile: null,
};

const DESIGN_ASSETS = {
  efes: {
    label: "Efes",
    src: "img/bottle-efes-pixel.svg",
    filter: "none",
    theme: "efes",
  },
  miller: {
    label: "Miller",
    src: "img/bottle-miller-pixel.svg",
    filter: "none",
    theme: "miller",
  },
  ruzka: {
    label: "Кружка свежего",
    src: "img/beer-mug-pixel.svg",
    filter: "none",
    theme: "ruzka",
  },
  medved: {
    label: "Белый медведь",
    src: "img/bottle-medved-pixel.svg",
    filter: "none",
    theme: "medved",
  },
};

const DESIGN_ALIASES = {
  classic: "efes",
  fest: "ruzka",
  ornament: "medved",
};

const THEMES = {
  efes: "theme-efes",
  miller: "theme-miller",
  ruzka: "theme-ruzka",
  medved: "theme-medved",
};

const THEME_BACKGROUNDS = {
  efes: "url('img/bg-efes.jpg')",
  miller: "url('img/bg-miller.jpg')",
  ruzka: "url('img/bg-ruzka.jpg')",
  medved: "url('img/bg-medved.jpg')",
};

const LEVELS = [
  { level: 1, title: "Новичок", xp: 0 },
  { level: 2, title: "Чок-мастер", xp: 120 },
  { level: 3, title: "Пенный герой", xp: 260 },
  { level: 4, title: "Король бара", xp: 420 },
  { level: 5, title: "Легенда клуба", xp: 600 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function toDayStamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
function computeStats(history = []) {
  const total = history.length;
  const uniquePartners = new Set();
  const dayCounts = new Map();
  let latest = 0;

  history.forEach((entry) => {
    const key = entry?.withUsername
      || entry?.withUserId
      || entry?.partnerId
      || entry?.withName
      || entry?.name
      || entry?.id
      || entry?._id;
    if (key) {
      uniquePartners.add(String(key));
    }
    const stamp = toDayStamp(entry?.at);
    if (stamp !== null) {
      dayCounts.set(stamp, (dayCounts.get(stamp) || 0) + 1);
      const raw = new Date(entry.at).getTime();
      if (!Number.isNaN(raw)) {
        latest = Math.max(latest, raw);
      }
    } });

  const todayStamp = toDayStamp(Date.now());
  let streak = 0;
  if (todayStamp !== null) {
    let cursor = todayStamp;
    while (dayCounts.has(cursor)) {
      streak += 1;
      cursor -= DAY_MS;
    }
    }

  const todayCount = todayStamp !== null ? (dayCounts.get(todayStamp) || 0) : 0;

  const xp = total * 25 + uniquePartners.size * 20 + streak * 30;

  return {
    total,
    unique: uniquePartners.size,
    streak,
    todayCount,
    xp,
    latest,
  };
}
function resolveLevel(xp) {
  let current = LEVELS[0];
  let next = LEVELS[LEVELS.length - 1];
  for (let i = 0; i < LEVELS.length; i += 1) {
    const lvl = LEVELS[i];
    if (xp >= lvl.xp) {
      current = lvl;
      next = LEVELS[Math.min(i + 1, LEVELS.length - 1)];
    } else {
       next = lvl;
      break;
    }
    }

  const sameLevel = next.level === current.level;
  const span = sameLevel ? Math.max(1, current.xp || 1) : Math.max(1, next.xp - current.xp);
  const progress = sameLevel
    ? 1
    : Math.min(1, Math.max(0, (xp - current.xp) / span));

  return {
    current,
    next,
    progress,
  };
}
function renderQuests(stats) {
  if (!els.questList) return;
  const quests = [
    {
      id: "daily",
      label: "Чокнись сегодня",
      progress: Math.min(1, stats.todayCount / 1),
      current: stats.todayCount,
      target: 1,
    },
    {
      id: "friends",
      label: "Познакомься с 5 друзьями",
      progress: Math.min(1, stats.unique / 5),
      current: stats.unique,
      target: 5,
    },
    {
      id: "streak",
      label: "Держи серию 3 дня",
      progress: Math.min(1, stats.streak / 3),
      current: stats.streak,
      target: 3,
    },
  ];

  els.questList.innerHTML = "";
  quests.forEach((quest) => {
    const li = document.createElement("li");
    li.className = "quest";
    li.dataset.questId = quest.id;
    const pct = Math.round(quest.progress * 100);
    li.innerHTML = `
      <div class="quest-meta">
        <span class="quest-name">${quest.label}</span>
        <span class="quest-progress">${Math.min(quest.current, quest.target)} / ${quest.target}</span>
      </div>
      <div class="quest-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
        <div class="quest-fill" style="width:${pct}%"></div>
      </div>
    `;
    if (quest.progress >= 1) {
      li.classList.add("quest-done");
    }
    els.questList.appendChild(li);
  });
}
function updateGamification(history = []) {
  const stats = computeStats(history);
  const level = resolveLevel(stats.xp);

  if (els.levelLabel) {
    els.levelLabel.textContent = `LVL ${level.current.level}`;
  }
  if (els.titleLabel) {
    els.titleLabel.textContent = level.current.title;
  }
  if (els.xpLabel) {
    if (level.next.level === level.current.level) {
      els.xpLabel.textContent = `${stats.xp} XP`;
    } else {
      els.xpLabel.textContent = `${stats.xp} / ${level.next.xp} XP`;
    }
    }
  if (els.streakLabel) {
    els.streakLabel.textContent = `🔥 ${stats.streak}`;
  }
  if (els.xpFill) {
    const pct = Math.round(level.progress * 100);
    els.xpFill.style.width = `${pct}%`;
  }
  if (els.xpBar) {
    els.xpBar.setAttribute("aria-valuenow", String(Math.round(level.progress * 100)));
  }

  renderQuests(stats);
}
function setStatus(text) {
  if (els.status) {
    els.status.textContent = text || "";
  }
}
function setPartner(text) {
  if (els.partner) {
    els.partner.textContent = text || "";
  }
}

const DEFAULT_DROP_SHADOW = "drop-shadow(0 12px 18px rgba(0,0,0,0.45))";

function applyDesign(design) {
  const normalized = DESIGN_ASSETS[design]
    ? design
    : (DESIGN_ALIASES[design] || "efes");
  const cfg = DESIGN_ASSETS[normalized] || DESIGN_ASSETS.efes;
  state.selectedDesign = normalized;
  if (els.bottle) {
    if (cfg.src && els.bottle.getAttribute("src") !== cfg.src) {
      els.bottle.setAttribute("src", cfg.src);
    }
    const filters = [];
    if (cfg.filter && cfg.filter !== "none") {
      filters.push(cfg.filter);
    }
    filters.push(DEFAULT_DROP_SHADOW);
    els.bottle.style.filter = filters.join(" ");
  }
  if (els.designOptions) {
    [...els.designOptions.querySelectorAll(".design-card")].forEach(card => {
      card.classList.toggle("selected", card.dataset.design === normalized);
    });
  }
  if (cfg.theme) {
    applyTheme(cfg.theme);
    if (els.themeSelect) {
      els.themeSelect.value = cfg.theme;
    }
  }
}
function applyTheme(name) {
  const themeName = THEMES[name] ? name : "efes";
  const cls = THEMES[themeName];
  document.body.classList.remove(...Object.values(THEMES));
  document.body.classList.add(cls);
  const bg = THEME_BACKGROUNDS[themeName] || THEME_BACKGROUNDS.efes;
  document.body.style.setProperty("--bg-img", bg);
  if (els.card) {
    els.card.style.setProperty("--bg-img", bg);
  }
  try {
    localStorage.setItem("efes_theme", themeName);
  } catch (_) {}
}
async function requestJSON(path, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  if (tg?.initData) {
    headers["Authorization"] = tg.initData;
  }
  const response = await fetch(API_BASE + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || "Request failed");
    error.response = data;
    throw error;
  }
  return data;
}
function showCountdown(show, seconds = 0) {
  if (!els.shakeTimer || !els.shakeCountdown) return;
  if (!show) {
    els.shakeTimer.hidden = true;
    els.shakeCountdown.textContent = "0";
    return;
  }
  els.shakeTimer.hidden = false;
  els.shakeCountdown.textContent = String(seconds);
}
function startCountdown(durationMs) {
  clearInterval(state.countdownTimer);
  const end = Date.now() + durationMs;
  state.countdownEndsAt = end;
  showCountdown(true, Math.ceil(durationMs / 1000));

  state.countdownTimer = setInterval(() => {
    const remaining = Math.max(0, state.countdownEndsAt - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    if (seconds <= 0) {
      stopCountdown();
      if (state.listening) {
        state.listening = false;
        setStatus("Время вышло — попробуй ещё раз");
      }
    } else if (els.shakeCountdown) {
      els.shakeCountdown.textContent = String(seconds);
    }
  }, 200);
}

function stopCountdown() {
  clearInterval(state.countdownTimer);
  state.countdownTimer = null;
  state.countdownEndsAt = 0;
  showCountdown(false);
}

async function saveProfilePayload(payload) {
  try {
    return await requestJSON("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  } catch (error) {
    try {
      return await requestJSON("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          name: payload.name,
          age21: payload.age ? payload.age >= 21 : undefined,
          mood: payload.mood,
          contact: payload.contact,
        },
      });
    } catch (_) {
      throw error;
    }
  }
}

async function saveDesignPayload(design) {
  try {
    return await requestJSON("/api/profile/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { design },
    });
  } catch (error) {
    try {
      return await requestJSON("/api/save_design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { design },
      });
    } catch (_) {
      throw error;
    }
  }
}

function animateBottle() {
  [els.bottle, els.cap, els.foam].forEach(el => {
    if (!el) return;
    el.classList.remove("growshake", "pop", "spray");
    void el.offsetWidth;
  });
  els.bottle?.classList.add("growshake");
  els.cap?.classList.add("pop");
  els.foam?.classList.add("spray");
  document.getElementById("sfx-bottle")?.play?.();
}
async function ensureMotionPermission() {
  try { if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const status = await DeviceMotionEvent.requestPermission();
      return status === "granted";
    }
    return true; } catch (_) {
    return false;
  }
}
function onMotion(event) {
  if (!state.listening) return;
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;
  const magnitude = Math.hypot(acc.x || 0, acc.y || 0, acc.z || 0);
  if (magnitude > 18) {
    handleShake();
  }
}

async function snapshotHistory() {
  try {
    const data = await requestJSON("/api/history");
    const last = data?.history?.[0];
    state.lastHistoryTimestamp = last ? new Date(last.at).getTime() : 0;
  } catch (error) {
    console.warn("snapshotHistory", error);
  }
}

async function waitForPartner(deadline) {
  setStatus("Ищу партнёра рядом…");
  while (Date.now() < deadline) { try {
      const data = await requestJSON("/api/history");
      const last = data?.history?.[0];
      if (last) {
        const ts = new Date(last.at).getTime();
        if (!state.lastHistoryTimestamp || ts > state.lastHistoryTimestamp) {
          renderPartner(last);
          await loadProfile();
          await loadHistory();
          setStatus("Готов к чок 🥂");
          return true;
        }
      }
    } catch (error) {
      console.warn("waitForPartner", error);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}
async function handleShake() {
  if (!state.listening) return;
  state.listening = false;
  stopCountdown();
  animateBottle();
  setStatus("Чокаемся…");

  await snapshotHistory();
   try {
    const result = await requestJSON("/api/shake", { method: "POST" });
    if (result?.status === "matched" && result.other) {
      renderPartner(result.other);
      await loadProfile();
      await loadHistory();
      setStatus("Готов к чок 🥂");
      return;
    }
    if (result?.partner) {
      renderPartner(result.partner);
      await loadProfile();
      await loadHistory();
      setStatus("Готов к чок 🥂");
      return;
    }
    if (result?.status === "already_today") {
      setStatus("С этой парой сегодня уже чокались");
      return;
    }
    if (result?.status === "need_profile") {
      setStatus("Заполни анкету, чтобы чокнуться");
      showEdit(true);
      return;
    }
    const partnerJoined = await waitForPartner(Date.now() + 12000);
    if (!partnerJoined) {
      setPartner("");
      setStatus("Никого рядом. Попробуй ещё раз");
    }
  } catch (error) {
    console.error("handleShake", error);
    setStatus("Не удалось отправить чок, проверь сеть");
  }
}

async function startListening() {
  if (state.listening) return;
  const granted = await ensureMotionPermission();
  if (!granted) {
    setStatus("Разреши доступ к датчикам движения");
    return;
  }
  state.listening = true;
  startCountdown(12000);
  setStatus("Встряхни телефон!");
}

function stopListening() {
  state.listening = false;
  stopCountdown();
}

async function loadProfile() {
  try {
    const data = await requestJSON("/api/profile/me");
    const profile = data?.profile || null;
    state.profile = profile;
    if (!profile) {
      setPartner("");
      if (els.fillInChatBtn) {
        els.fillInChatBtn.style.display = "";
      }
      return;
    }

    if (els.fillInChatBtn) {
      els.fillInChatBtn.style.display = "none";
    }

    if (!tg?.initDataUnsafe?.user?.username) {
      if (els.username) {
        els.username.textContent = profile.name || "Гость";
      }
    }

    if (els.nameInput && !els.nameInput.value) {
      els.nameInput.value = profile.name || "";
    }
    if (els.ageInput && !els.ageInput.value) {
      if (profile.age) {
        els.ageInput.value = profile.age;
      } else if (typeof profile.age21 === "boolean") {
        els.ageInput.value = profile.age21 ? 21 : 20;
      }
    }
    if (els.moodInput && !els.moodInput.value) {
      els.moodInput.value = profile.mood || "";
    }
    if (els.contactInput && !els.contactInput.value && profile.contact) {
      els.contactInput.value = profile.contact;
    }

    const design = profile.design || state.selectedDesign;
    applyDesign(design);
    if (els.designSection) {
      els.designSection.style.display = "block";
    }
  } catch (error) {
    console.warn("loadProfile", error);
  }
}

function renderPartner(partner) {
  if (!partner) {
    setPartner("");
    return;
  }
   if (partner.withName || partner.withUsername) {
    const name = partner.withName || partner.name || "Гость";
    const username = partner.withUsername || partner.username;
    setPartner(`Вы чокнулись с ${name}${username ? ` (@${username})` : ""}`);
  } else {
    const name = partner.name || "Гость";
    const username = partner.username ? ` (@${partner.username})` : "";
    setPartner(`Вы чокнулись с ${name}${username}`);
  }
}

async function loadHistory() {
  if (!els.historyList) return;
  try {
    const data = await requestJSON("/api/history");
    const history = data?.history || [];
    els.historyList.innerHTML = "";
    history.forEach(entry => {
      const li = document.createElement("li");
      const username = entry.withUsername ? ` (@${entry.withUsername})` : "";
      const when = entry.at ? new Date(entry.at).toLocaleString() : "";
      li.textContent = `${entry.withName}${username}${when ? ` — ${when}` : ""}`;
      els.historyList.appendChild(li);
    });
    updateGamification(history);
  } catch (error) {
    console.warn("loadHistory", error);
    updateGamification([]);
  }
}

function showEdit(visible) {
  if (els.editBlock) {
    els.editBlock.hidden = !visible;
  }
}

async function saveProfile() {
  if (!els.nameInput || !els.ageInput || !els.moodInput || !els.contactInput) return;
  const payload = {
    name: els.nameInput.value.trim(),
    age: Number(els.ageInput.value) || undefined,
    mood: els.moodInput.value.trim(),
    contact: els.contactInput.value.trim(),
    design: state.selectedDesign,
  };

  if (!payload.name) {
    setStatus("Имя обязательно");
    return;
  }
   return;
  }
  
  try {
    const result = await saveProfilePayload(payload);
    if (result?.ok || result?.profile) {
      setStatus("Анкета обновлена ✅");
      showEdit(false);
      els.fillInChatBtn && (els.fillInChatBtn.style.display = "none");
      await loadProfile();
    }
  } catch (error) {
    console.error("saveProfile", error);
    setStatus("Не удалось сохранить анкету");
  }

async function saveDesign() {
  try {
    const result = await saveDesignPayload(state.selectedDesign);
    if (result?.ok || result?.profile) {
      setStatus("Дизайн сохранён ✨");
      await loadProfile();
    }
  } catch (error) {
    console.warn("saveDesign", error);
    setStatus("Не удалось сохранить дизайн");
  }
}

function openBot() {
  if (BOT_USERNAME) {
    window.location.href = `https://t.me/${BOT_USERNAME}`;
  }
}
function initDesignCards() {
  if (!els.designOptions) return;
  els.designOptions.querySelectorAll(".design-card").forEach(card => {
    card.addEventListener("click", () => {
      applyDesign(card.dataset.design || "efes");
    });
  });
  applyDesign(state.selectedDesign);
}
function initThemeSelect() {
  if (!els.themeSelect) return;
  let saved = null;
  try {
    saved = localStorage.getItem("efes_theme");
  } catch (_) {}
  const initial = saved && (THEMES[saved] || DESIGN_ALIASES[saved])
    ? (DESIGN_ASSETS[saved] ? saved : DESIGN_ALIASES[saved])
    : "efes";
  applyDesign(initial);
  els.themeSelect.value = initial;
  els.themeSelect.addEventListener("change", (event) => {
    const value = event.target.value;
    applyDesign(value);
  });
}

function initUsername() {
  const user = tg?.initDataUnsafe?.user;
  if (user && els.username) {
    if (user.username) {
      els.username.textContent = `@${user.username}`;
    } else {
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
      els.username.textContent = name || "Гость";
    }
  }
}

function initButtons() {
  els.editBtn?.addEventListener("click", () => {
    if (els.fillInChatBtn && els.fillInChatBtn.style.display !== "none") {
      openBot();
    } else {
      showEdit(true);
    }
  });

  els.cancelEditBtn?.addEventListener("click", () => {
    showEdit(false);
  });

  els.saveProfileBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    saveProfile();
  });

  els.fillInChatBtn?.addEventListener("click", openBot);

  els.friendsBtn?.addEventListener("click", async () => {
    await loadHistory();
    setStatus("Показана история чоков 📜");
  });

  els.saveDesignBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    saveDesign();
  });

  els.openFromBotBtn?.addEventListener("click", openBot);

  if (els.shakeBtn) {
    els.shakeBtn.addEventListener("click", startListening);
  }
}

function initMotionListener() {
  window.addEventListener("devicemotion", onMotion, { passive: true });
}

async function init() {
  initUsername();
  initThemeSelect();
  initDesignCards();
  initButtons();
  initMotionListener();

  await loadProfile();
  updateGamification([]);
  await loadHistory();
  setStatus("Готов к чок 🥂");
}
init();