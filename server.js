require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  if (typeof req.body === 'string') {
    try {
      req.body = JSON.parse(req.body);
    } catch (_) {}
  }
  next();
});
app.use((req, res, next) => {
  const started = Date.now();
  const method = req.method;
  const url = req.originalUrl || req.url;
  console.log(`[${new Date().toISOString()}] → ${method} ${url}`);
  res.on('finish', () => {
    const duration = Date.now() - started;
    console.log(
      `[${new Date().toISOString()}] ← ${method} ${url} ${res.statusCode} ${duration}ms`,
    );
  });
  next();
});
// ---------- Config ----------
const PORT = process.env.PORT || 10000;
const PUBLIC_URL = process.env.PUBLIC_URL || ''; // e.g. https://efes-app.onrender.com
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const DEV_FALLBACK_USER_ID = process.env.DEV_FALLBACK_USER_ID || 'local-debug-user';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const TELEGRAM_WEBHOOK_PATH = `/telegram/webhook${TELEGRAM_WEBHOOK_SECRET ? `/${TELEGRAM_WEBHOOK_SECRET}` : ''}`;
const TELEGRAM_API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';
// ---------- Prisma ----------
const DATABASE_URL = process.env.DATABASE_URL;

const DESIGN_KEY_BY_ENUM = {
  EFES: 'efes',
  MILLER: 'miller',
  KRUZHKA_SVEZHEGO: 'ruzka',
  BELY_MEDVED: 'medved',
};

const DESIGN_ENUM_BY_KEY = {
  efes: 'EFES',
  miller: 'MILLER',
  ruzka: 'KRUZHKA_SVEZHEGO',
  medved: 'BELY_MEDVED',
};

const DESIGN_SYNONYMS = {
  efes: 'efes',
  classic: 'efes',
  default: 'efes',
  standard: 'efes',
  miller: 'miller',
  premium: 'miller',
  ruzka: 'ruzka',
  fest: 'ruzka',
  kruzhka: 'ruzka',
  kruzhka_svezhego: 'ruzka',
  'kruzhka-svezhego': 'ruzka',
  medved: 'medved',
  ornament: 'medved',
  bely_medved: 'medved',
  'bely-medved': 'medved',
  beliy_medved: 'medved',
  'beliy-medved': 'medved',
};

function normalizeDesign(value, fallback = 'efes') {
  if (typeof value !== 'string') return fallback;
  const key = value.trim().toLowerCase();
  if (!key) return fallback;
  const mapped = DESIGN_SYNONYMS[key] || (DESIGN_ENUM_BY_KEY[key] ? key : null);
  return mapped || fallback;
}

function designKeyToEnum(value, fallback = 'efes') {
  const normalizedFallback = normalizeDesign(fallback || 'efes');
  const normalized = normalizeDesign(value, normalizedFallback);
  return DESIGN_ENUM_BY_KEY[normalized] || 'EFES';
}

function designEnumToKey(enumValue) {
  if (typeof enumValue !== 'string') return 'efes';
  return DESIGN_KEY_BY_ENUM[enumValue] || 'efes';
}


const SUPPORTED_LANGUAGES = ['ru', 'en'];
const DEFAULT_LANGUAGE = 'ru';

const LANGUAGE_BUTTONS = [
  { code: 'ru', label: 'Русский 🇷🇺' },
  { code: 'en', label: 'English 🇬🇧' },
];

const BOT_TEXTS = {
  ru: {
    defaultName: 'друг',
    defaultGuestName: 'Гость',
    greetingLines: [
      'Привет, {{name}}{{idSuffix}}😄',
      '',
      'Рад знакомству! Меня зовут Пивик 🙂',
      'Я твой личный ассистент в мире Эфеса 🍻',
      'Давай я расскажу тебе подробнее про нашу цифровую бутылочку Эфес 😉',
      '',
      'С бутылочкой ты можешь легко обмениваться контактами на любых мероприятиях от Эфеса 😙',
      'Давай создадим твою персональную цифровую бутылочку Эфес!',
    ],
    miniAppIntro: 'Готов пройти анкету, выбрать настроение и чокнуться с другими гостями? Жми кнопку ниже!',
    miniAppUnavailable: 'Мини-приложение сейчас недоступно.',
    miniAppButton: 'Открыть мини-приложение Эфес',
    languagePrompt: 'Выбери язык, чтобы продолжить:\nChoose your language to continue:',
    languageSaved: 'Готово! Общаемся на русском 🇷🇺',
    languageSavedShort: 'Русский выбран',
    webAppDataReceived: 'Данные мини-приложения получены! Если хочешь начать сначала — просто открой мини-приложение ещё раз.',
    openMiniAppHint: 'Открой мини-приложение по кнопке выше, чтобы продолжить.',
    mapInfo: 'Скоро поделимся картой мероприятия. А пока загляни в мини-приложение!'
  },
  en: {
    defaultName: 'friend',
    defaultGuestName: 'Guest',
    greetingLines: [
      'Hi, {{name}}{{idSuffix}}😄',
      '',
      "Great to meet you! I'm Pivik 🙂",
      "I'm your personal guide to the world of Efes 🍻",
      'Let me tell you more about our digital Efes bottle 😉',
      '',
      'With the bottle you can exchange contacts at any Efes event 😙',
      "Let's create your personal digital Efes bottle!",
    ],
    miniAppIntro: 'Ready to fill out the form, choose your mood, and clink with other guests? Tap the button below!',
    miniAppUnavailable: 'The mini app is not available right now.',
    miniAppButton: 'Open the Efes mini app',
    languagePrompt: 'Choose your language to continue:\nВыбери язык, чтобы продолжить:',
    languageSaved: 'Nice! We will chat in English 🇬🇧',
    languageSavedShort: 'English selected',
    webAppDataReceived: 'Mini app data received! If you want to start over, just open the mini app again.',
    openMiniAppHint: 'Open the mini app using the button above to continue.',
    mapInfo: 'We will share the event map soon. For now, check the mini app!'
  },
};

function formatTemplate(template, params = {}) {
  if (typeof template !== 'string') return '';
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function normalizeLanguage(value, fallback = DEFAULT_LANGUAGE) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : fallback;
}

function getBotTexts(language = DEFAULT_LANGUAGE) {
  const lang = normalizeLanguage(language, DEFAULT_LANGUAGE);
  return BOT_TEXTS[lang] || BOT_TEXTS[DEFAULT_LANGUAGE];
}

function buildLanguageSelectionKeyboard() {
  return {
    inline_keyboard: [
      LANGUAGE_BUTTONS.map(button => ({
        text: button.label,
        callback_data: `lang:${button.code}`,
      })),
    ],
  };
}



const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');










function createFileStoreClient(reason = 'no DATABASE_URL') {
  const defaults = { profiles: {}, meetings: [] };
  let cache = null;
  let loadPromise = null;
  let writeChain = Promise.resolve();
  const allowedProfileKeys = new Set([
    'userId',
    'name',
    'tgUsername',
    'age',
    'mood',
    'design',
    'language',
    'createdAt',
    'updatedAt',
  ]);
  async function ensureLoaded() {
    if (cache) return cache;
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const raw = await fs.promises.readFile(DATA_FILE, 'utf8');
          const parsed = JSON.parse(raw);
          cache = {
            profiles: parsed?.profiles && typeof parsed.profiles === 'object'
              ? { ...parsed.profiles }
              : { ...defaults.profiles },
            meetings: Array.isArray(parsed?.meetings)
              ? parsed.meetings.map(item => ({ ...item }))
              : [...defaults.meetings],
          };
        } catch (err) {
          if (err && err.code !== 'ENOENT') {
            console.warn('Local store load failed, starting empty:', err.message || err);
          }
          cache = { profiles: { ...defaults.profiles }, meetings: [...defaults.meetings] };
        }
        return cache;
      })();
    }
    return loadPromise;
  }

  async function persist() {
    try {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      await fs.promises.writeFile(
        DATA_FILE,
        JSON.stringify(cache, null, 2),
        'utf8',
      );
    } catch (err) {
      console.error('Local store persist failed:', err?.message || err);
    }
  }

  function withWrite(fn) {
    const task = writeChain.then(async () => {
      await ensureLoaded();
      const result = await fn();
      await persist();
      return result;
    });
    writeChain = task.catch(() => {});
    return task;
  }

  const profile = {
    async findUnique({ where }) {
      if (!where?.userId) return null;
      const store = await ensureLoaded();
      const profile = store.profiles[where.userId];
      return profile ? { ...profile } : null;
    },
    async update({ where, data }) {
      if (!where?.userId) throw new Error('userId is required');
      return withWrite(async () => {
        const store = await ensureLoaded();
        const existing = store.profiles[where.userId];
        if (!existing) throw new Error('Profile not found');
        const now = new Date().toISOString();
        const merged = {
          ...existing,
          ...data,
          userId: where.userId,
        };
        merged.design = normalizeDesign(merged.design, existing?.design || 'efes');
        merged.tgUsername = merged.tgUsername ?? null;
        merged.language = normalizeLanguage(merged.language, existing?.language || DEFAULT_LANGUAGE);
        merged.createdAt = existing?.createdAt || now;
        merged.updatedAt = now;
        const sanitized = Object.fromEntries(
          Object.entries(merged).filter(([key]) => allowedProfileKeys.has(key)),
        );
        store.profiles[where.userId] = sanitized;
        return { ...sanitized };
      });
    },
    async create({ data }) {
      const userId = data?.userId;
      if (!userId) throw new Error('userId is required');
      return withWrite(async () => {
        const store = await ensureLoaded();
        const now = new Date().toISOString();
        const merged = {
          ...data,
          userId,
        };
        merged.design = normalizeDesign(merged.design, 'efes');
        merged.tgUsername = merged.tgUsername ?? null;
        merged.language = normalizeLanguage(merged.language, DEFAULT_LANGUAGE);
        merged.createdAt = now;
        merged.updatedAt = now;
        const sanitized = Object.fromEntries(
          Object.entries(merged).filter(([key]) => allowedProfileKeys.has(key)),
        );
        store.profiles[userId] = sanitized;
        return { ...sanitized };
      });
    },
    async upsert({ where, create, update }) {
      const userId = where?.userId;
      if (!userId) throw new Error('userId is required');
      const existing = await this.findUnique({ where: { userId } });
      if (existing) {
        return this.update({ where: { userId }, data: update });
      }
      return this.create({ data: { userId, ...create } });
    },
  };

  const meeting = {
    async findUnique({ where }) {
      const key = where?.pairKey_dayKey;
      if (!key?.pairKey || !key?.dayKey) return null;
      const store = await ensureLoaded();
      const match = store.meetings.find(
        item => item.pairKey === key.pairKey && item.dayKey === key.dayKey,
      );
      return match ? { ...match } : null;
    },
    async create({ data }) {
      return withWrite(async () => {
        const store = await ensureLoaded();
        const record = {
          id: data?.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
          userAId: data?.userAId,
          userBId: data?.userBId,
          pairKey: data?.pairKey,
          dayKey: data?.dayKey,
          metAt: data?.metAt || new Date().toISOString(),
        };
        store.meetings.push(record);
        return { ...record };
      });
    },
    async findMany({ where = {}, orderBy, take }) {
      const store = await ensureLoaded();
      const list = store.meetings
        .filter(item => {
          const when = new Date(item.metAt || item.met_at || Date.now());
          if (where.metAt?.gte && when < where.metAt.gte) return false;
          if (where.metAt?.lte && when > where.metAt.lte) return false;
          if (Array.isArray(where.OR) && where.OR.length) {
            return where.OR.some(cond => {
              if (cond.userAId && item.userAId === cond.userAId) return true;
              if (cond.userBId && item.userBId === cond.userBId) return true;
              return false;
            });
          }
          if (where.userAId && item.userAId !== where.userAId) return false;
          if (where.userBId && item.userBId !== where.userBId) return false;
          return true;
        })
        .map(entry => ({ ...entry }));

      if (orderBy?.metAt === 'desc') {
        list.sort((a, b) => new Date(b.metAt) - new Date(a.metAt));
      } else if (orderBy?.metAt === 'asc') {
        list.sort((a, b) => new Date(a.metAt) - new Date(b.metAt));
      }

      if (typeof take === 'number') {
        return list.slice(0, take);
      }
      return list;
    },
  };

  console.log(`Prisma: DISABLED (${reason}). Using JSON file store at`, DATA_FILE);

  return { profile, meeting };
}

function normalizePrismaProfile(record) {
  if (!record) return null;
  const createdAt = record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt;
  const updatedAt = record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt;
  return {
    userId: record.id,
    name: record.name,
    age: record.age,
    mood: record.mood,
    tgUsername: record.telegramUsername || null,
    design: designEnumToKey(record.bottleDesign),
    language: normalizeLanguage(record.language, DEFAULT_LANGUAGE),
    createdAt: createdAt || null,
    updatedAt: updatedAt || null,
  };
}

function mapProfileDataForPrisma(data = {}, existingDesign = 'efes', forceDesign = false) {
  const mapped = {};
  if (data.name !== undefined) mapped.name = data.name;
  if (data.age !== undefined) mapped.age = data.age;
  if (data.mood !== undefined) mapped.mood = data.mood;
  if (data.tgUsername !== undefined) mapped.telegramUsername = data.tgUsername || null;
  if (data.language !== undefined) mapped.language = normalizeLanguage(data.language, DEFAULT_LANGUAGE);
  if (data.design !== undefined) {
    mapped.bottleDesign = designKeyToEnum(data.design, existingDesign);
  } else if (forceDesign) {
    mapped.bottleDesign = designKeyToEnum(existingDesign, existingDesign);
  }
  return mapped;
}

function createPrismaProfileClient(prismaClient) {
  return {
    async findUnique({ where }) {
      const id = where?.userId || where?.id;
      if (!id) return null;
      const record = await prismaClient.profile.findUnique({ where: { id: String(id) } });
      return normalizePrismaProfile(record);
    },
    async update({ where, data }) {
      const id = where?.userId || where?.id;
      if (!id) throw new Error('userId is required');
      const existing = await prismaClient.profile.findUnique({ where: { id: String(id) } });
      const record = await prismaClient.profile.update({
        where: { id: String(id) },
        data: mapProfileDataForPrisma(data, designEnumToKey(existing?.bottleDesign)),
      });
      return normalizePrismaProfile(record);
    },
    async create({ data }) {
      const id = data?.userId || data?.id;
      if (!id) throw new Error('userId is required');
      const record = await prismaClient.profile.create({
        data: {
          id: String(id),
          ...mapProfileDataForPrisma(data, 'efes', true),
        },
      });
      return normalizePrismaProfile(record);
    },
    async upsert({ where, create, update }) {
      const id = where?.userId || where?.id;
      if (!id) throw new Error('userId is required');
      const record = await prismaClient.profile.upsert({
        where: { id: String(id) },
        create: {
          id: String(id),
          ...mapProfileDataForPrisma(create, 'efes', true),
        },
        update: mapProfileDataForPrisma(update),
      });
      return normalizePrismaProfile(record);
    },
  };
}

let fallbackDb = null;
function ensureFallbackDb(reason) {
  if (!fallbackDb) {
    fallbackDb = createFileStoreClient(reason);
  }
  return fallbackDb;
}

let prisma = null;
let db = null;
let dbInitPromise = Promise.resolve();

if (DATABASE_URL) {
  prisma = new PrismaClient();
  // Изначально используем Prisma для всего
  db = {
    profile: createPrismaProfileClient(prisma),
    meeting: prisma.meeting, // <-- ИСПОЛЬЗУЕМ PRISMA
  };

  dbInitPromise = prisma
    .$connect()
    .then(() => {
      // После успешного подключения подтверждаем, что используем Prisma
      db = {
        profile: createPrismaProfileClient(prisma),
        meeting: prisma.meeting, // <-- ИСПОЛЬЗUЕМ PRISMA
      };
      console.log('Prisma: CONNECTED to Postgres database.');
    })
    .catch(async (err) => {
      console.error('Prisma init failed, falling back to JSON store:', err?.message || err);
      try {
        await prisma.$disconnect();
      } catch (_) {}
      prisma = null;
      // Если Prisma не работает, используем временный файл для ВСЕГО
      db = ensureFallbackDb('init_failed');
    });
} else {
  const runningOnRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
  if (runningOnRender) {
    console.error('DATABASE_URL is required in the Render environment.');
    console.error('Please configure the "DATABASE_URL" environment variable to point to Postgres.');
    process.exit(1);
  }
  db = ensureFallbackDb('no DATABASE_URL');
}

// ---------- Helpers: sync Telegram username (no auto-create) ----------
const USERNAME_HANDLE_REGEX = /^[a-zA-Z0-9_]{3,32}$/;

function normalizeContact(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('@')) return trimmed;
  if (USERNAME_HANDLE_REGEX.test(trimmed)) return `@${trimmed}`;
  return trimmed;
}

function normalizeContactForStorage(value) {
  if (value === undefined) return undefined;
  const normalized = normalizeContact(value);
  if (!normalized) return null;
  if (normalized.startsWith('@')) return normalized.slice(1);
  return normalized;
}

async function syncTgUsername(userId, tgUser) {
  try {
     const uname = tgUser?.username || null;
     const p = await db.profile.findUnique({ where: { userId } });
       if (!p) return;
    const updates = {};
    if (p.tgUsername !== uname) {
      updates.tgUsername = uname;
    }
    if (Object.keys(updates).length) {
      await db.profile.update({ where: { userId }, data: updates });
    }
  } catch (_) {}
}

function coerceAge(age) {
  if (age === undefined || age === null) return null;
  const numeric = Number(age);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0) return null;
  return Math.floor(numeric);
}

function pickProfileFields(body = {}, tgUser = null) {
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const rawMood = typeof body.mood === 'string' ? body.mood.trim() : '';
  const age = coerceAge(body.age);
  const rawDesign = typeof body.design === 'string' ? body.design.trim() : '';
  const design = rawDesign ? normalizeDesign(rawDesign) : undefined;
  const contactProvided = Object.prototype.hasOwnProperty.call(body, 'contact');
  const contact = contactProvided ? normalizeContactForStorage(body.contact) : undefined;
  const tgUsername =
    contactProvided
      ? contact
      : tgUser?.username || undefined;

  return {
    name: rawName,
    mood: rawMood,
    age,
    tgUsername,
    design,
  };
}

function deriveProfileContact(profile) {
  if (!profile?.tgUsername) return '';
  return normalizeContact(profile.tgUsername);
}

function decorateProfile(profile) {
  if (!profile) return null;
  return { ...profile, contact: deriveProfileContact(profile) };
}

function getProfileDefaultsForLanguage(language, tgUser = null) {
  const lang = normalizeLanguage(language, DEFAULT_LANGUAGE);
  const texts = getBotTexts(lang);
  const fallbackTexts = getBotTexts(DEFAULT_LANGUAGE);
  return {
    name: texts.defaultGuestName || fallbackTexts.defaultGuestName || 'Гость',
    age: 21,
    mood: '',
    tgUsername: tgUser?.username || null,
    design: 'efes',
  };
}

async function setUserLanguagePreference(userId, language, tgUser = null) {
  if (!userId) return null;
  const lang = normalizeLanguage(language, DEFAULT_LANGUAGE);
  const defaults = getProfileDefaultsForLanguage(lang, tgUser);
  const profile = await db.profile.upsert({
    where: { userId: String(userId) },
    create: {
      userId: String(userId),
      ...defaults,
      language: lang,
    },
    update: { language: lang },
  });
  return profile;
}

async function getUserLanguage(userId) {
  if (!userId) return DEFAULT_LANGUAGE;
  try {
    const profile = await db.profile.findUnique({ where: { userId: String(userId) } });
    return normalizeLanguage(profile?.language, DEFAULT_LANGUAGE);
  } catch (err) {
    console.warn('getUserLanguage failed:', err?.message || err);
    return DEFAULT_LANGUAGE;
  }
}

async function upsertProfileFromWebApp(userId, body, tgUser) {
  const fields = pickProfileFields(body, tgUser);
  const profileData = {
    name: (fields.name || 'Гость').slice(0, 120),
    age: fields.age ?? 21,
    mood: (fields.mood || '').slice(0, 160),
    tgUsername: fields.tgUsername ?? tgUser?.username ?? null,
    design: normalizeDesign(fields.design, 'efes'),
  };

  // Шаг 1: Ищем пользователя по его ID
  let profile = await prisma.profile.findUnique({ where: { id: userId } });

  if (profile) {
    // Пользователь найден по ID — просто обновляем его данные
    profile = await prisma.profile.update({
      where: { id: userId },
      data: mapProfileDataForPrisma(profileData, designEnumToKey(profile.bottleDesign)),
    });
  } else if (profileData.tgUsername) {
    // Шаг 2: Если по ID не нашли, ищем по username
    const profileByUsername = await prisma.profile.findUnique({
      where: { telegramUsername: profileData.tgUsername },
    });

    if (profileByUsername) {
      // Пользователь найден по username! Обновляем его запись, включая новый ID
      profile = await prisma.profile.update({
        where: { telegramUsername: profileData.tgUsername },
        data: {
          id: userId, // <-- Привязываем старый профиль к новому ID
          ...mapProfileDataForPrisma(profileData, designEnumToKey(profileByUsername.bottleDesign)),
        },
      });
    } else {
      // Шаг 3: Если не нашли ни по ID, ни по username — это точно новый пользователь
      profile = await prisma.profile.create({
        data: {
          id: userId,
          ...mapProfileDataForPrisma(profileData, 'efes', true),
        },
      });
    }
  } else {
    // Шаг 3 (альтернативный): Если нет даже username, создаём нового пользователя
    profile = await prisma.profile.create({
      data: {
        id: userId,
        ...mapProfileDataForPrisma(profileData, 'efes', true),
      },
    });
  }

  return decorateProfile(normalizePrismaProfile(profile));
}

function computeDayKey(date = new Date()) {
 return date.toISOString().slice(0, 10);
}

function makePairKey(a, b) {
  return [String(a), String(b)].sort().join(':');
}

// ---------- Optional Redis (for fast matching), with safe fallback ----------
let redis = null;
const memoryQueue = { waiting: null }; // fallback in-memory storage
if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL, {
      tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
    });
    redis.on('connect', () => console.log('Redis: CONNECTED'));
    redis.on('error', err => console.error('Redis error:', err?.message || err));
  } catch (e) {
    console.warn('Redis init failed, fallback to in-memory:', e.message);
    redis = null;
  }
} else {
    console.log('Redis: DISABLED (no REDIS_URL). Using in-memory matching queue. Set REDIS_URL to enable Redis.');
}


// ---------- Telegram bot helpers ----------
function formatGreeting(message, language = DEFAULT_LANGUAGE) {
  const texts = getBotTexts(language);
  const fallbackTexts = getBotTexts(DEFAULT_LANGUAGE);
  const firstName = message?.from?.first_name?.trim();
  const displayName = firstName || texts.defaultName || fallbackTexts.defaultName || '';
  const idSuffix = message?.from?.id ? ` (${message.from.id})` : '';
  const lines = Array.isArray(texts.greetingLines) && texts.greetingLines.length
    ? texts.greetingLines
    : fallbackTexts.greetingLines;
  return lines.map(line => formatTemplate(line, { name: displayName, idSuffix })).join('\n');
}

function buildMiniAppButton(language = DEFAULT_LANGUAGE) {
  const miniAppUrl = buildMiniAppLink();
  if (!miniAppUrl) return null;

  return {
    inline_keyboard: [[{
      text: getBotTexts(language).miniAppButton,
      web_app: { url: miniAppUrl },
    }]],
  };
}

function buildMiniAppLink() {
  if (!PUBLIC_URL) return '';
  return `${PUBLIC_URL.replace(/\/$/, '')}/`;
}

async function callTelegram(method, payload) {
  if (!TELEGRAM_API_BASE) return null;
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.ok === false)) {
      const description = data?.description || res.statusText;
      console.error(`Telegram API ${method} failed:`, description);
    }
    return data;
  } catch (err) {
    console.error(`Telegram API ${method} error:`, err?.message || err);
    return null;
  }
}

async function sendGreetingAndMiniApp(message, language = DEFAULT_LANGUAGE) {
  const chatId = message?.chat?.id || message?.from?.id;
  if (!chatId) return;

  const lang = normalizeLanguage(language, DEFAULT_LANGUAGE);
  const texts = getBotTexts(lang);
  const greetingText = formatGreeting(message, lang);

  const greetingMessage = {
    chat_id: chatId,
    text: greetingText,
 };

  await callTelegram('sendMessage', greetingMessage);

  const miniAppButton = buildMiniAppButton(lang);
  const miniAppMessage = {
    chat_id: chatId,
    text: miniAppButton ? texts.miniAppIntro : texts.miniAppUnavailable,
  };

  if (miniAppButton) {
    miniAppMessage.reply_markup = miniAppButton;
  }

  await callTelegram('sendMessage', miniAppMessage);
}

async function sendLanguageSelection(chatId, language = DEFAULT_LANGUAGE) {
  if (!chatId) return;
  const lang = normalizeLanguage(language, DEFAULT_LANGUAGE);
  const texts = getBotTexts(lang);
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: texts.languagePrompt,
    reply_markup: buildLanguageSelectionKeyboard(),
  });
}

async function sendMapInfo(message, language = DEFAULT_LANGUAGE) {
  const chatId = message?.chat?.id || message?.from?.id;
  if (!chatId) return;
  const lang = normalizeLanguage(language, DEFAULT_LANGUAGE);
  const texts = getBotTexts(lang);
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: texts.mapInfo,
  });
}

async function handleTelegramUpdate(update) {
  if (!update) return;

  if (update.message) {
    const message = update.message;
    const chatId = message.chat?.id;
    const userId = message.from?.id ? String(message.from.id) : null;
    const language = await getUserLanguage(userId);
    if (message.web_app_data) {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: getBotTexts(language).webAppDataReceived,
      });
    }
    const rawText = typeof message.text === 'string' ? message.text.trim() : '';
    const normalized = rawText.toLowerCase();


    if (rawText === '/start' || normalized === 'старт' || normalized === 'start') {
      await sendLanguageSelection(chatId, language);
      return;
    }

    if (rawText === '/map' || normalized === 'карта' || normalized === 'map') {
      await sendMapInfo(message, language);
      return;
    }

    if (normalized) {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: getBotTexts(language).openMiniAppHint,
      });
      return;
    }
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const data = typeof cq.data === 'string' ? cq.data : '';
    const chatId = cq.message?.chat?.id || cq.from?.id || null;

    if (data.startsWith('lang:')) {
      const selected = data.split(':')[1];
      const lang = normalizeLanguage(selected, DEFAULT_LANGUAGE);
      await setUserLanguagePreference(cq.from?.id ? String(cq.from.id) : null, lang, cq.from);
      if (cq.message?.message_id && chatId) {
        await callTelegram('editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          reply_markup: { inline_keyboard: [] },
        });
      }
      const texts = getBotTexts(lang);
      if (cq.id) {
        await callTelegram('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: texts.languageSavedShort || texts.languageSaved,
          show_alert: false,
        });
      }
      if (chatId) {
        await callTelegram('sendMessage', { chat_id: chatId, text: texts.languageSaved });
        await sendGreetingAndMiniApp({ chat: { id: chatId }, from: cq.from }, lang);
      }
      return;
    }

    if (data === 'start') {
      const lang = await getUserLanguage(cq.from?.id ? String(cq.from.id) : null);
      if (chatId) {
        await sendLanguageSelection(chatId, lang);
      }
      if (cq.id) {
        await callTelegram('answerCallbackQuery', { callback_query_id: cq.id });
      }
      return;
    }

    if (cq.id) {
      await callTelegram('answerCallbackQuery', { callback_query_id: cq.id });
    }
  }
}

async function ensureTelegramWebhook() {
  if (!TELEGRAM_API_BASE || !PUBLIC_URL) {
    if (BOT_TOKEN && !PUBLIC_URL) {
      console.warn('Telegram bot: PUBLIC_URL is required to configure webhook.');
    }
    return;
  }

  const webhookUrl = `${PUBLIC_URL.replace(/\/$/, '')}${TELEGRAM_WEBHOOK_PATH}`;
  const payload = {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query', 'web_app_data'],
  };

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('Failed to set Telegram webhook:', data.description || data);
    } else {
      console.log('Telegram webhook configured at', webhookUrl);
    }
  } catch (err) {
    console.error('Failed to set Telegram webhook:', err?.message || err);
  }
}

async function ensureTelegramCommands() {
  if (!TELEGRAM_API_BASE) return;

  const commands = [
    { command: 'start', description: 'Запустить мини-приложение Эфес' },

  ];


  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/setMyCommands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commands }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('Failed to set Telegram commands:', data.description || data);
    }
  } catch (err) {
    console.error('Failed to configure Telegram commands:', err?.message || err);
  }
}

async function ensureTelegramMenuButton() {
  if (!TELEGRAM_API_BASE) return;

  const payload = {
    menu_button: {
      type: 'commands',
    },
  };

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('Failed to set Telegram menu button:', data.description || data);
    }
  } catch (err) {
    console.error('Failed to configure Telegram menu button:', err?.message || err);
  }
}

// ---------- Telegram WebApp signature verify ----------
function parseInitData(initDataRaw) {
  const url = new URL('https://t.me/?' + (initDataRaw || ''));
  const data = {};
  for (const [k, v] of url.searchParams.entries()) data[k] = v;
  return data;
}

function extractUserFromInitData(data) {
  try {
    const userStr = data.user || '';
    const user = userStr ? JSON.parse(userStr) : null;
    const userId = user?.id ? String(user.id) : null;
    return { user, userId };
  } catch (err) {
    console.warn('Failed to parse Telegram user from init data:', err?.message || err);
    return { user: null, userId: null };
  }
}

function verifyInitData(initDataRaw) {
  try {
    if (!initDataRaw) {
      if (!BOT_TOKEN) {
        return { ok: true, userId: DEV_FALLBACK_USER_ID, raw: {}, user: null, isFallback: true };
      }
      return { ok: false };
    }

    const data = parseInitData(initDataRaw);
    const { user, userId } = extractUserFromInitData(data);

    if (!BOT_TOKEN) {
      return {
        ok: Boolean(userId || DEV_FALLBACK_USER_ID),
        userId: userId || DEV_FALLBACK_USER_ID,
        raw: data,
        user,
        isFallback: true,
      };
    }

    const receivedHash = data.hash;
    if (!receivedHash) return { ok: false };

    const dataForHash = { ...data };
    delete dataForHash.hash;

    const keys = Object.keys(dataForHash).sort();
    const checkString = keys.map(k => `${k}=${dataForHash[k]}`).join('\n');

    const secretKey = crypto.createHmac('sha256', "WebAppData").update(BOT_TOKEN).digest();
    const calcHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

    if (calcHash !== receivedHash) return { ok: false };

    return { ok: Boolean(userId), userId, raw: data, user };
  } catch (e) {
    console.error('verifyInitData error:', e);
    return { ok: false };
  }
}

// ---------- Auth middleware ----------
function authMiddleware(req, res, next) {
  const initDataRaw = req.headers['authorization'] || req.body?.tgInitData || '';
  const v = verifyInitData(initDataRaw);
  if (!v.ok || !v.userId) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.userId = v.userId;
  req.tgUser = v.user || null;
  next();
}
function authMiddleware(req, res, next) {
  const initDataRaw = req.headers['authorization'] || req.body?.tgInitData || '';

  // ЭТОТ БЛОК НУЖНО ДОБАВИТЬ
  console.log('--- ПОЛУЧЕННЫЕ initData ---');
  console.log(initDataRaw);
  console.log('---------------------------');

  const v = verifyInitData(initDataRaw);

  // И ЭТОТ БЛОК НУЖНО ДОБАВИТЬ
  console.log('--- РЕЗУЛЬТАТ ВЕРИФИКАЦИИ ---');
  console.log(v);
  console.log('-----------------------------');

  if (!v.ok || !v.userId) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.userId = v.userId;
  req.tgUser = v.user || null;
  next();
}
// ---------- Static ----------
app.use(express.static(path.join(__dirname))); // index.html, style.css, script.js, etc.

if (BOT_TOKEN) {
  app.post(TELEGRAM_WEBHOOK_PATH, async (req, res) => {
    try {
      await handleTelegramUpdate(req.body);
    } catch (err) {
      console.error('Telegram webhook handler error:', err?.message || err);
    }
    res.json({ ok: true });
  });
} else {
  app.post(TELEGRAM_WEBHOOK_PATH, (_req, res) => {
    res.status(503).json({ ok: false, error: 'bot_disabled' });
  });
}
// ---------- Health ----------
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------- API: Profile (backward-compat + no auto-create on /me) ----------
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const uid = req.query.uid || req.userId;
    await syncTgUsername(String(uid), req.tgUser);
    const p = await db.profile.findUnique({ where: { userId: String(uid) } });
    if (!p) return res.json({ exists: false });
    res.json({ exists: true, profile: decorateProfile(p) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/profile/me', authMiddleware, async (req, res) => {
  try {
    await syncTgUsername(req.userId, req.tgUser);
    const p = await db.profile.findUnique({ where: { userId: req.userId } });
        // Профиль создаётся после сохранения данных в мини-аппе
    if (!p) return res.json({ profile: null });
    res.json({ profile: decorateProfile(p) });
  } catch (e) {
   console.error(e);
    res.status(500).json({ ok: false });
  }
});
async function handleProfileSave(req, res) {
  try {
    const userId = req.userId;
    const profile = await upsertProfileFromWebApp(userId, req.body || {}, req.tgUser);
    res.json({ ok: true, profile });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
}

// Dedicated endpoint for questionnaire submissions from the mini app
app.post('/api/profile/questionnaire', authMiddleware, handleProfileSave);
app.post('/api/profile/save', authMiddleware, handleProfileSave);
app.post('/api/profile/design', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const rawDesign = typeof req.body?.design === 'string' ? req.body.design.trim() : '';
    const existing = await db.profile.findUnique({ where: { userId } });
    const design = normalizeDesign(
      rawDesign || existing?.design,
      existing?.design || 'efes',
    );
    const profileDefaults = {
      name: existing?.name || 'Гость',
      age: existing?.age ?? 21,
      mood: existing?.mood || '',
      tgUsername: existing?.tgUsername ?? req.tgUser?.username ?? null,
      language: existing?.language || DEFAULT_LANGUAGE,
    };
    const p = await db.profile.upsert({
      where: { userId },
      create: {
        userId,
        ...profileDefaults,
        design,
      },
      update: { design },
    });
    res.json({ ok: true, profile: decorateProfile(p) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// ---------- MATCH UTILS ----------
const MATCH_WINDOW_MS = 12000;

async function setWaiting(userId, ts) {
  if (redis) {
    const key = 'shake:waiting';
    const val = JSON.stringify({ userId, ts });
    await redis.set(key, val, 'EX', Math.ceil(MATCH_WINDOW_MS / 1000));
    return true;
  } else {
    memoryQueue.waiting = { userId, ts, expire: Date.now() + MATCH_WINDOW_MS };
    return true;
  }
}

async function popWaiting() {
  if (redis) {
    const key = 'shake:waiting';
    const val = await redis.get(key);
    if (val) {
      await redis.del(key);
       try { return JSON.parse(val); } catch { return null; }
    }
    return null;

   } else {
    const v = memoryQueue.waiting;
    if (v && v.expire >= Date.now()) {
      memoryQueue.waiting = null;
      return v;
    }
    memoryQueue.waiting = null;
    return null;
  }
}

// ---------- SHAKE ----------
app.post('/api/shake', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const now = Date.now();

    await syncTgUsername(userId, req.tgUser);
    const self = await db.profile.findUnique({ where: { userId } });
    if (!self) return res.json({ status: 'need_profile' });

    const other = await popWaiting(); // пытаемся забрать ждущего
    if (other && Math.abs(now - other.ts) <= MATCH_WINDOW_MS && other.userId !== userId) {
      // нашли пару → фиксируем знакомство в БД
      const partnerId = other.userId;
      const dayKey = computeDayKey();
      const pairKey = makePairKey(userId, partnerId);
           const already = await db.meeting.findUnique({
        where: { pairKey_dayKey: { pairKey, dayKey } },
      });
      if (already) return res.json({ status: 'already_today' });
      await db.meeting.create({
        data: {
          userAId: userId,
          userBId: partnerId,
          pairKey,
          dayKey,
        },
      });
      // возвращаем данные партнёра (имя + username)
      const partner = await db.profile.findUnique({ where: { userId: partnerId } });
      const partnerContact = deriveProfileContact(partner);

      return res.json({
        status: 'matched',
                other: {
          id: partnerId,
          name: partner?.name || 'Гость',
          username: partner?.tgUsername || null,
          contact: partnerContact,
        }
      });

    } else {
      // никого не было — встанем в очередь на MATCH_WINDOW_MS
      await setWaiting(userId, now);
      return res.json({ status: 'waiting' });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'shake_failed' });
  }
});

// Список «чоков» за интервал (служебный)
app.get('/api/shake/list', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const from = req.query.from ? new Date(req.query.from) : (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
    const to   = req.query.to   ? new Date(req.query.to)   : (() => { const d = new Date(); d.setHours(23,59,59,999); return d; })();

    const list = await db.meeting.findMany({
      where: {
            metAt: { gte: from, lte: to },
        OR: [{ userAId: userId }, { userBId: userId }]
      },
            orderBy: { metAt: 'desc' }
    });

    const items = [];
    for (const m of list) {
              const otherId = m.userAId === userId ? m.userBId : m.userAId;
      const p = await db.profile.findUnique({ where: { userId: otherId } });
            items.push({ user_id: otherId, profile: decorateProfile(p), at: m.metAt });
    }
    res.json({ ok: true, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// ---------- HISTORY ----------
app.get('/api/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const list = await db.meeting.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { metAt: 'desc' },
      take: 20,
    });
    const history = [];
    for (const m of list) {
      const otherId = m.userAId === userId ? m.userBId : m.userAId;
      const p = await db.profile.findUnique({ where: { userId: otherId } });
      history.push({
        withId: otherId,
        withUsername: p?.tgUsername || null,
        withName: p?.name || otherId,
        contact: deriveProfileContact(p),
        at: m.metAt,
      });
    }
    res.json({ ok: true, history });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});
// ---------- Start ----------
async function bootstrap() {
  try {
    await dbInitPromise;
  } catch (err) {
    console.error('Database initialization error:', err?.message || err);
  }

  app.listen(PORT, () => {
    console.log(`Efes app listening on :${PORT}`);
    if (!PUBLIC_URL) console.log('TIP: set PUBLIC_URL for QR links.');
    if (BOT_TOKEN) {
      ensureTelegramWebhook();
      ensureTelegramCommands();
      ensureTelegramMenuButton();
    }
  });
}

bootstrap().catch(err => {
  console.error('Failed to launch server:', err?.message || err);
});