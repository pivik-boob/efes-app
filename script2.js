const tg = window.Telegram?.WebApp;
if (tg) tg.ready();
const rawApiBase = (window.__API_BASE__ || "").trim();
const fallbackApiBase = window.location && window.location.origin
  ? window.location.origin
  : "";
const API_BASE = (rawApiBase || fallbackApiBase || "").replace(/\/$/, "");
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
  questDropdown: document.getElementById("questDropdown"),
  editBlock: document.getElementById("editBlock"),
  editBtn: document.getElementById("editBtn"),
  cancelEditBtn: document.getElementById("cancelEditBtn"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  nameInput: document.getElementById("nameInput"),
  ageInput: document.getElementById("ageInput"),
  moodInput: document.getElementById("moodInput"),
  moodCarousel: document.getElementById("moodCarousel"),
  moodTrack: document.getElementById("moodTrack"),
  moodWindow: document.getElementById("moodWindow"),
  moodPrev: document.getElementById("moodPrev"),
  moodNext: document.getElementById("moodNext"),
  moodActiveText: document.getElementById("moodActiveText"),
  moodCustomInput: document.getElementById("moodCustomInput"),
  contactInput: document.getElementById("contactInput"),
  contactNote: document.getElementById("contactNote"),
  contactField: document.getElementById("contactField"),
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
  profile: undefined,
  moodOptions: [],
  moodCardRefs: [],
  moodIndex: 0,
  customMoodValue: "",
  autoContact: null,
};

const moodGestureState = {
  active: false,
  startX: 0,
  lastX: 0,
  pointerId: null,
};

const DESIGN_ASSETS = {
  efes: {
    label: "Efes",
    theme: "efes",
    visual: "bottle",
    className: "bottle--efes",
  },
    ruzka: {
    label: "Кружка свежего",
    theme: "ruzka",
       visual: "bottle",
    className: "bottle--ruzka",
  },
  medved: {
    label: "Белый медведь",
    theme: "medved",
    visual: "bottle",
    className: "bottle--medved",
  },
  miller: {
    label: "Miller",
    theme: "miller",
    visual: "bottle",
    className: "bottle--miller",
  },
};

const DESIGN_CLASSNAMES = Object.values(DESIGN_ASSETS)
  .map(cfg => cfg.className)
  .filter(Boolean);
  const VISUAL_VARIANTS = ["visual--bottle"];

const DESIGN_ALIASES = {
  classic: "efes",
  default: "efes",
  standard: "efes",
  fest: "ruzka",
  kruzhka: "ruzka",
  kruzhka_svezhego: "ruzka",
  "kruzhka-svezhego": "ruzka",
  ornament: "medved",
  bely_medved: "medved",
  "bely-medved": "medved",
  beliy_medved: "medved",
  "beliy-medved": "medved",
  premium: "miller",
};

const THEMES = {
  efes: "theme-efes",
  miller: "theme-miller",
  ruzka: "theme-ruzka",
  medved: "theme-medved",
};

const THEME_BACKGROUNDS = {
  efes: [
        "img/ефес.jpg",
    "img/Group-PDF-Export_page-0001.jpg",
    "img/Group-PDF-Export_page-0002.jpg",
  ],
  miller: [
        "img/миллер.jpg",
    "img/Group-PDF-Export_page-0002.jpg",
    "img/Group-PDF-Export_page-0001.jpg",
  ],
  ruzka: [
        "img/ружка свежего.jpg",
    "img/Group-PDF-Export_page-0001.jpg",
    "img/Group-PDF-Export_page-0002.jpg",
  ],
  medved: [
        "img/медведь.jpg",
    "img/Group-PDF-Export_page-0002.jpg",
    "img/Group-PDF-Export_page-0001.jpg",
  ],
};

const MOOD_PRESETS = [
  {
    value: "Весёлое",
    label: "Весёлое",
    emoji: "🥳",
    description: "Готов(а) чокаться со всеми подряд",
  },
  {
    value: "Чилл",
    label: "Чилл",
    emoji: "😌",
    description: "Спокойно отдыхаю и ловлю вайб",
  },
  {
    value: "Энергичное",
    label: "Энергичное",
    emoji: "⚡️",
    description: "В поиске драйва и шумных компаний",
  },
  {
    value: "Флирт",
    label: "Флирт",
    emoji: "😉",
    description: "Настроение ловить искры и улыбки",
  },
  {
    value: "Танцевальное",
    label: "Танцевальное",
    emoji: "💃",
    description: "Готов(а) выйти на танцпол прямо сейчас",
  },
  {
    value: "",
    label: "Своё настроение",
    emoji: "✨",
    description: "Придумай свой вайб и поделись им",
    custom: true,
  },
];

const backgroundCache = {};
const backgroundPromises = {};

function getBackgroundCandidates(theme) {
  const key = THEMES[theme] ? theme : "efes";
  const list = THEME_BACKGROUNDS[key];
  if (Array.isArray(list)) {
    return list.filter(Boolean);
  }
  if (typeof list === "string" && list) {
    return [list];
  }
  const fallback = THEME_BACKGROUNDS.efes;
  return Array.isArray(fallback) ? fallback.filter(Boolean) : [];
}
function getFallbackBackground(theme) {
  const candidates = getBackgroundCandidates(theme);
  if (candidates.length > 0) {
    return candidates[0];
  }
  const fallback = getBackgroundCandidates("efes");
  return fallback[0] || "";
}

function toCssUrl(path) {
  if (!path) return "";
  if (path.startsWith("url(")) return path;
  const safe = path.replace(/'/g, "\\'");
  return `url('${safe}')`;
}

function resolveBackground(theme) {
  const key = THEMES[theme] ? theme : "efes";
  if (backgroundCache[key]) {
    return Promise.resolve(backgroundCache[key]);
  }
  if (typeof Image === "undefined") {
    const fallback = getFallbackBackground(key);
    backgroundCache[key] = fallback;
    return Promise.resolve(fallback);
  }
  if (backgroundPromises[key]) {
    return backgroundPromises[key];
  }
  const candidates = getBackgroundCandidates(key);
  const fallback = getFallbackBackground(key);

  backgroundPromises[key] = new Promise((resolve) => {
    let index = 0;
     const tryNext = () => {
      if (index >= candidates.length) {
     resolve(fallback);
     return;
     }
          const candidate = candidates[index++];
      if (!candidate) {
        tryNext();
        return;
      }
      const img = new Image();
      img.onload = () => resolve(candidate);
      img.onerror = tryNext;
      img.src = candidate;
    };
       tryNext();
  }).then((path) => {
    backgroundCache[key] = path || fallback;
    return backgroundCache[key];
  }).finally(() => {
    delete backgroundPromises[key];
  });

  return backgroundPromises[key];
}
function getResolvedBackground(theme) {
  const key = THEMES[theme] ? theme : "efes";
  return backgroundCache[key] || getFallbackBackground(key);
}

function getCustomMoodIndex() {
  return state.moodOptions.findIndex(option => option.custom);
}

function updateCustomCard(value) {
  const ref = state.moodCardRefs.find(entry => entry.option.custom);
  if (ref?.customValueEl) {
    ref.customValueEl.textContent = value ? `— ${value}` : "";
  }
}

function renderMoodOptions() {
  if (!els.moodTrack) return;
  els.moodTrack.innerHTML = "";
  state.moodCardRefs = [];
  state.moodOptions.forEach((option, index) => {
    const card = document.createElement("li");
    card.className = "mood-card";
    card.dataset.index = String(index);
    card.id = `mood-card-${index}`;
    card.setAttribute("role", "option");
    card.tabIndex = -1;

    const emoji = document.createElement("span");
    emoji.className = "mood-emoji";
    emoji.textContent = option.emoji || "";
    card.appendChild(emoji);

    const title = document.createElement("span");
    title.className = "mood-title";
    title.textContent = option.label;
    card.appendChild(title);

    if (option.description) {
      const desc = document.createElement("span");
      desc.className = "mood-desc";
      desc.textContent = option.description;
      card.appendChild(desc);
    }

    let customValueEl = null;
    if (option.custom) {
      customValueEl = document.createElement("span");
      customValueEl.className = "mood-custom-value";
      card.appendChild(customValueEl);
    }

    card.addEventListener("click", () => {
      setMoodIndex(index, { focusCustom: option.custom });
    });

    card.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "Enter" || key === " " || key === "Spacebar") {
        event.preventDefault();
        setMoodIndex(index, { focusCustom: option.custom });
        return;
      }
      if (key === "ArrowRight" || key === "ArrowDown") {
        event.preventDefault();
        setMoodIndex(index + 1);
        return;
      }
      if (key === "ArrowLeft" || key === "ArrowUp") {
        event.preventDefault();
        setMoodIndex(index - 1);
      }
    });

    state.moodCardRefs.push({ node: card, option, customValueEl });
    els.moodTrack.appendChild(card);
  });
}

function updateMoodTransform(extraOffsetPx = 0) {
  if (!els.moodTrack) return;
  const width = els.moodWindow?.clientWidth || 0;
  if (width > 1) {
    const base = -state.moodIndex * width;
    const total = base + extraOffsetPx;
    els.moodTrack.style.transform = `translateX(${total}px)`;
  } else {
    const percentBase = -state.moodIndex * 100;
    const extraPercent = width > 0 ? (extraOffsetPx / width) * 100 : 0;
    const value = percentBase + extraPercent;
    els.moodTrack.style.transform = `translateX(${value}%)`;
  }
}

function findMoodIndexByValue(value) {
  if (!value) return -1;
  const normalized = value.trim().toLowerCase();
  return state.moodOptions.findIndex(option => !option.custom && option.value && option.value.trim().toLowerCase() === normalized);
}

function setMoodIndex(index, options = {}) {
  if (!els.moodTrack || !state.moodOptions.length) return;
  const length = state.moodOptions.length;
  const target = ((index % length) + length) % length;
  state.moodIndex = target;
  updateMoodTransform();
  if (els.moodCarousel) {
    els.moodCarousel.dataset.index = String(target);
  }

  state.moodCardRefs.forEach((entry, idx) => {
    const isActive = idx === target;
    entry.node.classList.toggle("is-active", isActive);
    entry.node.setAttribute("aria-selected", isActive ? "true" : "false");
    entry.node.tabIndex = isActive ? 0 : -1;
  });

  const activeRef = state.moodCardRefs[target];
  if (activeRef) {
    els.moodTrack.setAttribute("aria-activedescendant", activeRef.node.id);
  }

  const option = state.moodOptions[target];
  if (!option) return;

  if (option.custom && options.prefill !== undefined) {
    const raw = typeof options.prefill === "string" ? options.prefill : "";
    state.customMoodValue = raw.trim();
  }

  let displayValue = option.value;
  if (option.custom) {
    if (els.moodCustomInput) {
      els.moodCustomInput.classList.add("is-visible");
      const inputValue = options.prefill !== undefined
        ? (typeof options.prefill === "string" ? options.prefill.trim() : "")
        : state.customMoodValue;
      els.moodCustomInput.value = inputValue;
      if (options.focusCustom) {
        const focusInput = () => {
          if (!els.moodCustomInput) return;
          els.moodCustomInput.focus();
          if (typeof els.moodCustomInput.select === "function") {
            els.moodCustomInput.select();
          }
        };
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(focusInput);
        } else {
          setTimeout(focusInput, 0);
        }
      }
    }
    if (options.prefill === undefined) {
      state.customMoodValue = (els.moodCustomInput?.value || state.customMoodValue || "").trim();
    }
    updateCustomCard(state.customMoodValue);
    displayValue = state.customMoodValue || option.label;
    if (els.moodInput) {
      els.moodInput.value = state.customMoodValue;
    }
  } else {
    if (els.moodCustomInput) {
      els.moodCustomInput.classList.remove("is-visible");
    }
    if (els.moodInput) {
      els.moodInput.value = option.value;
    }
    displayValue = option.value;
  }

  if (els.moodActiveText) {
    els.moodActiveText.textContent = displayValue ? `Сейчас: ${displayValue}` : "";
  }
}

function handleMoodNav(direction) {
  setMoodIndex(state.moodIndex + direction);
}

function handleMoodCustomInput() {
  const value = (els.moodCustomInput?.value || "").trim();
  state.customMoodValue = value;
  updateCustomCard(value);
  if (els.moodInput && state.moodOptions[state.moodIndex]?.custom) {
    els.moodInput.value = value;
    const option = state.moodOptions[state.moodIndex];
    const displayValue = value || option.label;
    if (els.moodActiveText) {
      els.moodActiveText.textContent = displayValue ? `Сейчас: ${displayValue}` : "";
    }
  }
}

function applyProfileMood(value) {
  if (!els.moodTrack || !state.moodOptions.length) return;
  const mood = typeof value === "string" ? value.trim() : "";
  if (!mood) {
    state.customMoodValue = "";
    setMoodIndex(0);
    return;
  }
  const foundIndex = findMoodIndexByValue(mood);
  if (foundIndex >= 0) {
    setMoodIndex(foundIndex);
    return;
  }
  const customIndex = getCustomMoodIndex();
  if (customIndex >= 0) {
    state.customMoodValue = mood;
    setMoodIndex(customIndex, { prefill: mood });
  }
}

function initMoodGestures() {
  if (!els.moodWindow || !els.moodTrack) return;

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.buttons !== 1) return;
    moodGestureState.active = true;
    moodGestureState.startX = event.clientX;
    moodGestureState.lastX = event.clientX;
    moodGestureState.pointerId = event.pointerId;
    els.moodWindow.classList.add("is-gesturing");
    try {
      els.moodWindow.setPointerCapture(event.pointerId);
    } catch (_) {}
  };

  const onPointerMove = (event) => {
    if (!moodGestureState.active || event.pointerId !== moodGestureState.pointerId) return;
    moodGestureState.lastX = event.clientX;
    const delta = moodGestureState.lastX - moodGestureState.startX;
    updateMoodTransform(delta);
  };

  const finishGesture = (event) => {
    if (!moodGestureState.active || (event && event.pointerId !== moodGestureState.pointerId)) return;
    const width = els.moodWindow.clientWidth || 1;
    const delta = moodGestureState.lastX - moodGestureState.startX;
    moodGestureState.active = false;
    els.moodWindow.classList.remove("is-gesturing");
    try {
      if (moodGestureState.pointerId != null) {
        els.moodWindow.releasePointerCapture(moodGestureState.pointerId);
      }
    } catch (_) {}
    moodGestureState.pointerId = null;
    const threshold = width * 0.2;
    if (Math.abs(delta) > threshold) {
      setMoodIndex(state.moodIndex + (delta < 0 ? 1 : -1));
    } else {
      setMoodIndex(state.moodIndex);
    }
  };

  const onPointerLeave = (event) => {
    if (!moodGestureState.active) return;
    moodGestureState.lastX = event.clientX;
    finishGesture(event);
  };

  els.moodWindow.addEventListener("pointerdown", onPointerDown);
  els.moodWindow.addEventListener("pointermove", onPointerMove);
  els.moodWindow.addEventListener("pointerup", finishGesture);
  els.moodWindow.addEventListener("pointercancel", finishGesture);
  els.moodWindow.addEventListener("pointerleave", onPointerLeave);
}

function initMoodCarousel() {
  if (!els.moodTrack) return;
  state.moodOptions = [...MOOD_PRESETS];
  state.customMoodValue = (els.moodCustomInput?.value || "").trim();
  renderMoodOptions();
  updateCustomCard(state.customMoodValue);
  setMoodIndex(0);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => updateMoodTransform());
} else {
  setTimeout(() => updateMoodTransform(), 0);
  }
  els.moodPrev?.addEventListener("click", () => handleMoodNav(-1));
  els.moodNext?.addEventListener("click", () => handleMoodNav(1));
  els.moodCustomInput?.addEventListener("input", handleMoodCustomInput);
  els.moodCustomInput?.addEventListener("change", handleMoodCustomInput);
  initMoodGestures();
  window.addEventListener("resize", () => updateMoodTransform());
}
function updateDesignCardBackgrounds() {
  if (!els.designOptions) return;
  [...els.designOptions.querySelectorAll(".design-card")].forEach((card) => {
    const designKey = card.dataset.design;
    const themeKey = DESIGN_ASSETS[designKey]?.theme || designKey;
    const backgroundPath = getResolvedBackground(themeKey);
    if (backgroundPath) {
      card.style.setProperty("--design-bg", toCssUrl(backgroundPath));
    }
  });
}

function primeBackgrounds() {
  Object.keys(THEME_BACKGROUNDS).forEach((theme) => {
    resolveBackground(theme)
      .then(() => {
        updateDesignCardBackgrounds();
      })
      .catch(() => {});
  });
}

function formatUsername(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

const USERNAME_HANDLE_REGEX = /^[a-zA-Z0-9_]{3,32}$/;

function formatContactValue(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("@")) return trimmed;
  if (USERNAME_HANDLE_REGEX.test(trimmed)) {
    return `@${trimmed}`;
  }
  return trimmed;
}

function getContactField() {
  if (els.contactField) return els.contactField;
  return els.contactInput?.closest?.(".field--contact") || null;
}

function applyContactAutofill(profileOverride = null) {
  if (!els.contactInput) return;
  const profile = profileOverride ?? state.profile ?? null;
  const tgUsername = tg?.initDataUnsafe?.user?.username || null;
  const derivedHandle = tgUsername
    || profile?.tgUsername
    || profile?.telegramUsername
    || profile?.tg_username
    || profile?.telegram_user
    || profile?.telegram;

  const autofillContact = formatContactValue(derivedHandle);
  const contactField = getContactField();

  if (autofillContact) {
    state.autoContact = autofillContact;
    els.contactInput.value = autofillContact;
    els.contactInput.readOnly = true;
    els.contactInput.setAttribute("aria-readonly", "true");
    if (contactField) {
      contactField.classList.add("field--contact-locked");
    }
    if (els.contactNote) {
      els.contactNote.textContent = "Мы используем твой Telegram @username — его увидит собеседник после чока.";
      els.contactNote.hidden = false;
    }
  } else {
    state.autoContact = null;
    const fallbackContact = profile?.contact ? formatContactValue(profile.contact) : "";
    if (fallbackContact) {
      els.contactInput.value = fallbackContact;
    } else if (!profile) {
      els.contactInput.value = "";
    }
    els.contactInput.readOnly = false;
    els.contactInput.removeAttribute("aria-readonly");
    if (contactField) {
      contactField.classList.remove("field--contact-locked");
    }
    if (els.contactNote) {
      els.contactNote.textContent = "Укажи, как с тобой связаться (например, телефон или @username).";
      els.contactNote.hidden = false;
    }
  }
}

function updateUsernameDisplay(profile) {
  if (!els.username) return;
  const tgUser = tg?.initDataUnsafe?.user;
  if (tgUser?.username) {
    els.username.textContent = formatUsername(tgUser.username);
    return;
  }
  const contactHandle = profile?.contact && profile.contact.includes("@")
    ? profile.contact
    : null;
  const profileUsername = formatUsername(
    profile?.telegramUsername
      || profile?.telegramUserName
      || profile?.telegram_user
      || profile?.telegram_user_name
      || profile?.telegram
      || profile?.tgUsername
      || profile?.tg_username
      || profile?.username
      || contactHandle
  );
  if (profileUsername) {
    els.username.textContent = profileUsername;
    return;
  }
  if (tgUser) {
    const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ").trim();
    if (fullName) {
      els.username.textContent = fullName;
      return;
    }
      }
  if (profile?.name) {
    els.username.textContent = profile.name;
    return;
  }
  els.username.textContent = "Гость";
}

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
    }
      });

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
  const incomplete = quests.filter(quest => quest.progress < 1).length;
  if (els.questDropdown) {
    els.questDropdown.classList.toggle("quest-dropdown--active", incomplete > 0);
  }
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
function setPartner(content) {
  if (!els.partner) return;
  if (content instanceof Node) {
    els.partner.innerHTML = "";
    els.partner.appendChild(content);
    return;
  }
  els.partner.textContent = content || "";
}
const DEFAULT_DROP_SHADOW = "drop-shadow(0 12px 18px rgba(0,0,0,0.45))";

function applyDesign(design) {
  const normalized = DESIGN_ASSETS[design]
    ? design
    : (DESIGN_ALIASES[design] || "efes");
  const cfg = DESIGN_ASSETS[normalized] || DESIGN_ASSETS.efes;
  state.selectedDesign = normalized;
  if (els.bottle) {
    DESIGN_CLASSNAMES.forEach(cls => els.bottle.classList.remove(cls));
    if (cfg.className) {
      els.bottle.classList.add(cfg.className);
    }
    VISUAL_VARIANTS.forEach(variant => els.bottle.classList.remove(variant));
    if (cfg.visual) {
      els.bottle.classList.add(`visual--${cfg.visual}`);
    } else {
      els.bottle.classList.add("visual--bottle");
    }
        els.bottle.setAttribute("aria-label", `Пиксельная бутылочка ${cfg.label}`.trim());
    els.bottle.style.filter = DEFAULT_DROP_SHADOW;
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
  const fallback = getFallbackBackground(themeName);
  const fallbackCss = toCssUrl(fallback);
  document.body.style.setProperty("--bg-img", fallbackCss);
  if (els.card) {
    els.card.style.setProperty("--bg-img", fallbackCss);
  }
   resolveBackground(themeName)
    .then((path) => {
      const css = toCssUrl(path);
      document.body.style.setProperty("--bg-img", css);
      if (els.card) {
        els.card.style.setProperty("--bg-img", css);
      }
      updateDesignCardBackgrounds();
    })
    .catch(() => {
      updateDesignCardBackgrounds();
    });
  try {
    localStorage.setItem("efes_theme", themeName);
  } catch (_) {}
}
async function requestJSON(path, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  if (tg?.initData) {
    headers["Authorization"] = tg.initData;
  }
    headers["Accept"] = headers["Accept"] || "application/json";
  const body = options.body
    ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body))
    : undefined;
  if (body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(API_BASE + path, {
    method: options.method || "GET",
    headers,
    body,
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
    return await requestJSON("/api/profile/questionnaire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  } catch (error) {
    try {
      return await requestJSON("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
    } catch (_) {
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
}

async function saveDesignPayload(design) {
  return await requestJSON("/api/profile/design", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { design },
  });
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

// ===== iOS motion permission =====
async function ensureMotionPermission() {
  try {   if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const status = await DeviceMotionEvent.requestPermission();
      return status === "granted";
    }
    return true; } catch (_) {
    return false;
  }
}function onMotion(event) {
  if (!state.listening) return;
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;
  const magnitude = Math.hypot(acc.x || 0, acc.y || 0, acc.z || 0);
  if (magnitude > 18) {
    handleShake();
  }
}

async function snapshotHistory() {try {
    const data = await requestJSON("/api/history");
    const last = data?.history?.[0];
    state.lastHistoryTimestamp = last ? new Date(last.at).getTime() : 0;
  } catch (error) {
    console.warn("snapshotHistory", error);
  }
}
async function waitForPartner(deadline) {
  setStatus("Ищу партнёра рядом…");
  while (Date.now() < deadline) {
    try {
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
  if (!state.profile) {
    setStatus("Сначала заполни анкету в мини-аппе");
    showEdit(true);
    return;
  }
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
    applyContactAutofill(profile);
    if (els.editBtn) {
      els.editBtn.dataset.required = profile ? "false" : "true";
     if (profile) {
        els.editBtn.hidden = true;
      } else {
        els.editBtn.hidden = false;
      } 
    }
    if (els.shakeBtn) {
      els.shakeBtn.disabled = !profile;
    }
    updateUsernameDisplay(profile);
    if (!profile) {
      setPartner("");
            state.customMoodValue = "";
      setMoodIndex(0);
      setStatus("Заполни анкету в мини-аппе, чтобы начать чокаться");
      showEdit(true);
      if (els.nameInput && document.activeElement !== els.nameInput) {
        els.nameInput.focus({ preventScroll: false });
      }
      return;
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
       const isEditing = els.editBlock?.dataset.state === "open";
    if (!isEditing) {
      applyProfileMood(profile.mood || "");
    } else if (els.moodInput && !els.moodInput.value && profile.mood) {
      applyProfileMood(profile.mood);
    }

    const design = profile.design || state.selectedDesign;
    applyDesign(design);
    if (els.designSection) {
      els.designSection.style.display = "block";
    }
    if (els.editBlock && els.editBlock.dataset.state !== "open") {
      showEdit(false);
    }
  } catch (error) {
    console.warn("loadProfile", error);
    if (state.profile === undefined) {
      state.profile = null;
      if (els.editBtn) {
        els.editBtn.dataset.required = "true";
        els.editBtn.hidden = false;
      }
      if (els.shakeBtn) {
        els.shakeBtn.disabled = true;
      }
      showEdit(true);
    }
    applyContactAutofill(null);
    setStatus("Не удалось загрузить анкету");
  }
}

function renderPartner(partner) {
  if (!partner) {
    setPartner("");
    return;
  }
    const name = partner.withName || partner.name || "Гость";
  const usernameRaw = partner.withUsername || partner.username || partner.tgUsername || null;
  const username = formatUsername(usernameRaw);
  const contact = formatContactValue(
    partner.contact || partner.withContact || partner.instagram || ""
  );

  const fragment = document.createDocumentFragment();
  const headline = document.createElement("span");
  headline.className = "partner-line__headline";
  headline.append("Вы чокнулись с ");
  const nameEl = document.createElement("span");
  nameEl.className = "partner-line__name";
  nameEl.textContent = name;
  headline.appendChild(nameEl);
  if (username) {
    const usernameEl = document.createElement("span");
    usernameEl.className = "partner-line__username";
    usernameEl.textContent = username;
    headline.append(" ");
    headline.appendChild(usernameEl);
  }
  fragment.appendChild(headline);

  if (contact) {
    const contactEl = document.createElement("span");
    contactEl.className = "partner-line__contact";
    contactEl.textContent = contact;
    fragment.appendChild(contactEl);
  }

  setPartner(fragment);
}

async function loadHistory() {
  if (!els.historyList) return;
  try {
    const data = await requestJSON("/api/history");
    const history = data?.history || [];
    els.historyList.innerHTML = "";
    history.forEach(entry => {
      const li = document.createElement("li");
            li.classList.add("history-item");
      const name = entry.withName || entry.name || "Гость";
      const username = formatUsername(entry.withUsername || entry.username || null);
      const contact = formatContactValue(entry.contact || entry.withContact || "");
      let whenText = "";
      let whenDate = null;
      if (entry.at) {
        const parsed = new Date(entry.at);
        if (!Number.isNaN(parsed.getTime())) {
          whenDate = parsed;
          whenText = parsed.toLocaleString();
        }
      }

      const header = document.createElement("div");
      header.className = "history-item__header";

      const identity = document.createElement("div");
      identity.className = "history-item__identity";
      const nameEl = document.createElement("span");
      nameEl.className = "history-item__name";
      nameEl.textContent = name;
      identity.appendChild(nameEl);
      if (username) {
        const usernameEl = document.createElement("span");
        usernameEl.className = "history-item__username";
        usernameEl.textContent = username;
        identity.appendChild(usernameEl);
      }
      header.appendChild(identity);

      if (whenText) {
        const timeEl = document.createElement("time");
        timeEl.className = "history-item__time";
        timeEl.textContent = whenText;
        if (whenDate) {
          timeEl.dateTime = whenDate.toISOString();
        }
        header.appendChild(timeEl);
      }

      li.appendChild(header);

      if (contact) {
        const contactEl = document.createElement("span");
        contactEl.className = "history-item__contact";
        contactEl.textContent = contact;
        li.appendChild(contactEl);
      }

      els.historyList.appendChild(li);
    });
    updateGamification(history);
  } catch (error) {
    console.warn("loadHistory", error);
    updateGamification([]);
  }
}

function showEdit(open) {
  if (!els.editBlock) return;
  const required = state.profile === null;
  const shouldOpen = required ? true : Boolean(open);
  els.editBlock.hidden = false;
    els.editBlock.dataset.state = shouldOpen ? "open" : "collapsed";
  if (els.saveProfileBtn) {
        els.saveProfileBtn.textContent = required
      ? "Сохранить анкету"
      : shouldOpen
        ? "Сохранить"
        : "Обновить настроение";
  }
  if (els.cancelEditBtn) {
        if (required) {
      els.cancelEditBtn.style.display = "none";
    } else {
      els.cancelEditBtn.style.display = shouldOpen ? "" : "none";
    }
  }
}

async function saveProfile() {
  if (!els.nameInput || !els.ageInput || !els.moodInput || !els.contactInput) return;
  const nameValue = els.nameInput.value.trim() || state.profile?.name || "";
  const moodValue = els.moodInput.value.trim();
    const contactRaw = (state.autoContact && state.autoContact.trim())
    || els.contactInput.value.trim()
    || state.profile?.contact
    || "";
  const contactValue = formatContactValue(contactRaw) || contactRaw.trim();
  if (contactValue && els.contactInput.value !== contactValue) {
    els.contactInput.value = contactValue;
  }
  if (state.autoContact) {
    state.autoContact = contactValue;
  }
  const rawAge = els.ageInput.value.trim();
  let age = rawAge ? Number(rawAge) : undefined;
  if (!Number.isFinite(age)) {
    age = undefined;
  }
  if (age === undefined && state.profile) {
    if (typeof state.profile.age === "number" && !Number.isNaN(state.profile.age)) {
      age = state.profile.age;
    } else if (state.profile.age21 === true) {
      age = 21;
    }
  }

  const payload = {
    name: nameValue,
    age,
    mood: moodValue,
    contact: contactValue,
    design: state.selectedDesign,
  };

  if (!payload.name) {
    setStatus("Имя обязательно");
    return;
  }
  if (!payload.age || payload.age < 21) {
    setStatus("Минимальный возраст — 21");
    return;
  }
    if (!payload.mood) {
    setStatus("Добавь настроение ✨");
    return;
  }
    if (!contactValue) {
    setStatus("Добавь контакт, чтобы мы передали его собеседнику");
    return;
  }

  try {
    const result = await saveProfilePayload(payload);
    if (result?.ok || result?.profile) {
      setStatus("Анкета обновлена ✅");
      showEdit(false);
            await loadProfile();
    }
  } catch (error) {
    console.error("saveProfile", error);
    setStatus("Не удалось сохранить анкету");
  }
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
  updateDesignCardBackgrounds();
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
  updateUsernameDisplay(state.profile);
}

function initButtons() {
  els.editBtn?.addEventListener("click", () => {
       if (state.profile === null) {
      showEdit(true);
      els.nameInput?.focus();
      return;
    }
    const isOpen = els.editBlock?.dataset.state === "open";
    showEdit(!isOpen);
  });

  els.cancelEditBtn?.addEventListener("click", () => {
    if (state.profile === null) return;
    showEdit(false);
  });

  els.saveProfileBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    saveProfile();
  });
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
  initMoodCarousel();
  applyContactAutofill(null);
  showEdit(false);
  primeBackgrounds();
  initButtons();
  initMotionListener();

  await loadProfile();
  updateGamification([]);
  await loadHistory();
   if (state.profile) {
    setStatus("Готов к чок 🥂");
  }
}
init();