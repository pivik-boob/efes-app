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
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const TELEGRAM_WEBHOOK_PATH = `/telegram/webhook${TELEGRAM_WEBHOOK_SECRET ? `/${TELEGRAM_WEBHOOK_SECRET}` : ''}`;
const TELEGRAM_API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';
// ---------- Prisma ----------
const DATABASE_URL = process.env.DATABASE_URL;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

function createFileStoreClient(reason = 'no DATABASE_URL') {
  const defaults = { profiles: {}, meetings: [] };
  let cache = null;
  let loadPromise = null;
  let writeChain = Promise.resolve();

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
        const updated = {
          ...existing,
          ...data,
          userId: where.userId,
          updatedAt: new Date().toISOString(),
        };
        store.profiles[where.userId] = updated;
        return { ...updated };
      });
    },
    async create({ data }) {
      const userId = data?.userId;
      if (!userId) throw new Error('userId is required');
      return withWrite(async () => {
        const store = await ensureLoaded();
        const created = {
          ...data,
          userId,
          updatedAt: new Date().toISOString(),
        };
        store.profiles[userId] = created;
        return { ...created };
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

let prisma = null;
let db = null;
let dbInitPromise = Promise.resolve();
if (process.env.DATABASE_URL) {
  prisma = new PrismaClient();
  db = prisma;
  dbInitPromise = ensurePostgresSchema(prisma)
    .then(() => {
      console.log('Prisma: CONNECTED to Postgres database.');
    })
    .catch(async err => {
      console.error('Prisma init failed, falling back to JSON store:', err?.message || err);
      try {
        await prisma.$disconnect();
      } catch (_) {}
      prisma = null;
      db = createFileStoreClient('init_failed');
    });
} else {
   db = createFileStoreClient('no DATABASE_URL');
}

async function ensurePostgresSchema(prismaClient) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS "Profile" (
      "userId" TEXT PRIMARY KEY,
      "tgUsername" TEXT,
      "name" TEXT NOT NULL,
      "age21" BOOLEAN,
      "age" INTEGER,
      "instagram" TEXT,
      "contact" TEXT,
      "mood" TEXT DEFAULT '🙂',
      "design" TEXT DEFAULT 'classic',
      "photoFileId" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "tgUsername" TEXT`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT 'Гость'`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "age21" BOOLEAN`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "age" INTEGER`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "instagram" TEXT`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "contact" TEXT`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "mood" TEXT NOT NULL DEFAULT '🙂'`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "design" TEXT NOT NULL DEFAULT 'classic'`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "photoFileId" TEXT`,
    `ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE "Profile" ALTER COLUMN "name" SET DEFAULT 'Гость'`,
    `ALTER TABLE "Profile" ALTER COLUMN "mood" SET DEFAULT '🙂'`,
    `ALTER TABLE "Profile" ALTER COLUMN "design" SET DEFAULT 'classic'`,
    `ALTER TABLE "Profile" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`,
    `CREATE TABLE IF NOT EXISTS "Meeting" (
      "id" TEXT PRIMARY KEY,
      "userAId" TEXT NOT NULL,
      "userBId" TEXT NOT NULL,
      "pairKey" TEXT NOT NULL,
      "dayKey" TEXT NOT NULL,
      "metAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "userAId" TEXT`,
    `ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "userBId" TEXT`,
    `ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "pairKey" TEXT`,
    `ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "dayKey" TEXT`,
    `ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "metAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE "Meeting" ALTER COLUMN "metAt" SET DEFAULT CURRENT_TIMESTAMP`,
    `CREATE TABLE IF NOT EXISTS "GiftCode" (
      "voucher" TEXT PRIMARY KEY,
      "fromUserId" TEXT NOT NULL,
      "toUserId" TEXT NOT NULL,
      "message" TEXT,
      "redeemed" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" TIMESTAMP(3)
    )`,
    `ALTER TABLE "GiftCode" ADD COLUMN IF NOT EXISTS "voucher" TEXT`,
    `ALTER TABLE "GiftCode" ADD COLUMN IF NOT EXISTS "fromUserId" TEXT`,
    `ALTER TABLE "GiftCode" ADD COLUMN IF NOT EXISTS "toUserId" TEXT`,
    `ALTER TABLE "GiftCode" ADD COLUMN IF NOT EXISTS "message" TEXT`,
    `ALTER TABLE "GiftCode" ADD COLUMN IF NOT EXISTS "redeemed" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "GiftCode" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE "GiftCode" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3)`,
    `ALTER TABLE "GiftCode" ALTER COLUMN "redeemed" SET DEFAULT false`,
    `ALTER TABLE "GiftCode" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Meeting_pairKey_dayKey_key" ON "Meeting" ("pairKey", "dayKey")`,
    `CREATE INDEX IF NOT EXISTS "Meeting_dayKey_idx" ON "Meeting" ("dayKey")`,
    `CREATE INDEX IF NOT EXISTS "Meeting_userAId_metAt_idx" ON "Meeting" ("userAId", "metAt")`,
    `CREATE INDEX IF NOT EXISTS "Meeting_userBId_metAt_idx" ON "Meeting" ("userBId", "metAt")`,
    `CREATE INDEX IF NOT EXISTS "GiftCode_fromUserId_idx" ON "GiftCode" ("fromUserId")`,
    `CREATE INDEX IF NOT EXISTS "GiftCode_toUserId_idx" ON "GiftCode" ("toUserId")`,
    `DO $$ BEGIN
        ALTER TABLE "GiftCode"
        ADD CONSTRAINT "GiftCode_fromUserId_fkey"
        FOREIGN KEY ("fromUserId") REFERENCES "Profile"("userId")
        ON DELETE RESTRICT ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`,
    `DO $$ BEGIN
        ALTER TABLE "GiftCode"
        ADD CONSTRAINT "GiftCode_toUserId_fkey"
        FOREIGN KEY ("toUserId") REFERENCES "Profile"("userId")
        ON DELETE RESTRICT ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`,
  ];

  for (const sql of statements) {
    await prismaClient.$executeRawUnsafe(sql);
  }
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

function resolveProfileContact(profile) {
  if (!profile) return '';
  if (profile.contact && profile.contact.trim()) return profile.contact.trim();
  if (profile.instagram && profile.instagram.trim()) return profile.instagram.trim();
  if (profile.tgUsername) return normalizeContact(profile.tgUsername);
  return '';
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
    if (uname && (!p.contact || !p.contact.trim())) {
      const handle = normalizeContact(uname);
      if (handle) {
        updates.contact = handle;
        updates.instagram = handle;
      }
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
  const rawContact = normalizeContact(body.contact || body.instagram || '');
  const age = coerceAge(body.age);
  const tgHandle = normalizeContact(tgUser?.username || '');
  const rawDesign = typeof body.design === 'string' ? body.design.trim() : '';
  const contact = rawContact || tgHandle || '';

  return {
    name: rawName,
    mood: rawMood,
    age,
    contact,
    tgUsername: tgUser?.username || null,
    design: rawDesign,
  };
}

async function upsertProfileFromWebApp(userId, body, tgUser) {
  const existing = await db.profile.findUnique({ where: { userId } });
  const fields = pickProfileFields(body, tgUser);

  const name = (fields.name || existing?.name || 'Гость').slice(0, 120);
  const mood = (((fields.mood ?? existing?.mood) || '')).slice(0, 160);
  const contactSource = fields.contact || existing?.contact || normalizeContact(existing?.tgUsername) || '';
  const contact = contactSource.slice(0, 120);
  const designSource = fields.design || existing?.design || 'classic';
  const design = String(designSource || 'classic').slice(0, 60);
  const data = {
    name,
    age: fields.age ?? existing?.age ?? 21,
    mood,
    contact,
    instagram: contact,
    tgUsername: fields.tgUsername,
    design,  
  };

  if (existing) {
    return db.profile.update({ where: { userId }, data });
  }

  return db.profile.create({
    data: {
      ...data,
      userId,
    },
  });
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
function formatGreeting(message) {
  const firstName = message?.from?.first_name?.trim();
  const displayName = firstName || 'друг';
  const userId = message?.from?.id ? ` (${message.from.id})` : '';

  return [
    `Привет, ${displayName}${userId}😄`,
    '',
    'Рад знакомству! Меня зовут Пивик 🙂',
    'Я твой личный ассистент в мире Эфеса 🍻',
    'Давай я расскажу тебе подробнее про нашу цифровую бутылочку Эфес 😉',
    '',
    'С бутылочкой ты можешь легко обмениваться контактами на любых мероприятиях от Эфеса 😙',
    'Давай создадим твою персональную цифровую бутылочку Эфес!'
  ].join('\n');
}

function buildMiniAppButton() {
  const miniAppUrl = buildMiniAppLink();
  if (!miniAppUrl) return null;

  return {
    inline_keyboard: [[{
      text: 'Открыть мини-приложение Эфес',
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

async function sendGreetingAndMiniApp(message) {
  const chatId = message?.chat?.id;
  if (!chatId) return;

  const greetingText = formatGreeting(message);

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: greetingText,
  });

  const miniAppButton = buildMiniAppButton();
  const miniAppMessage = {
    chat_id: chatId,
    text: miniAppButton
      ? 'Готов пройти анкету, выбрать настроение и чокнуться с другими гостями? Жми кнопку ниже!'
      : 'Мини-приложение сейчас недоступно.',
  };

  if (miniAppButton) {
    miniAppMessage.reply_markup = miniAppButton;
  }

  await callTelegram('sendMessage', miniAppMessage);
}

async function handleTelegramUpdate(update) {
  if (!update) return;

  if (update.message) {
    const message = update.message;
    if (message.web_app_data) {
      await callTelegram('sendMessage', {
        chat_id: message.chat.id,
        text: 'Данные мини-приложения получены! Если хочешь начать сначала — просто открой мини-приложение ещё раз.',      });
      return;
    }
    const rawText = typeof message.text === 'string' ? message.text.trim() : '';
    const normalized = rawText.toLowerCase();

    if (rawText === '/start' || normalized === 'старт' || normalized === 'start') {
      await sendGreetingAndMiniApp(message);
      return;
    }

    if (rawText === '/map' || normalized === 'карта' || normalized === 'map') {
      await sendMapInfo(message);
      return;
    }

    if (normalized) {
      await callTelegram('sendMessage', {
        chat_id: message.chat.id,
        text: 'Открой мини-приложение по кнопке выше, чтобы продолжить.',
      });
      return;
    }
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    if (cq.data === 'start') {
      await sendGreetingAndMiniApp({ chat: cq.message?.chat, from: cq.from });
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

  const commands = [];

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

// ---------- Telegram WebApp signature verify ----------
function verifyInitData(initDataRaw) {
  try {
    if (!initDataRaw || !BOT_TOKEN) return { ok: false };
    // initDataRaw — это querystring из Telegram WebApp (tg.initData)
    // Проверка: HMAC-SHA256 по ключу secretKey = sha256(BOT_TOKEN)
    const url = new URL('https://t.me/?' + initDataRaw); // чтобы легко парсить
    const data = {};
    for (const [k, v] of url.searchParams.entries()) data[k] = v;

    const receivedHash = data.hash;
    if (!receivedHash) return { ok: false };
    delete data.hash;

    const keys = Object.keys(data).sort();
    const checkString = keys.map(k => `${k}=${data[k]}`).join('\n');

    const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const calcHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

    if (calcHash !== receivedHash) return { ok: false };

    // Достаём user.id
    const userStr = data.user || '';
    const user = userStr ? JSON.parse(userStr) : null;
    const userId = user?.id ? String(user.id) : null;

    return { ok: true, userId, raw: data, user };
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
    res.json({ exists: true, profile: p });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

app.get('/api/profile/me', authMiddleware, async (req, res) => {
  try {
    await syncTgUsername(req.userId, req.tgUser);
    const p = await prisma.profile.findUnique({ where: { userId: req.userId } });
        // Профиль создаётся после сохранения данных в мини-аппе
    if (!p) return res.json({ profile: null });
    res.json({ profile: p });
  } catch (e) {
   console.error(e);
    res.status(500).json({ ok: false });
  }
});
// Update profile strictly via the Mini App
app.post('/api/profile/update', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
       const profile = await upsertProfileFromWebApp(userId, req.body || {}, req.tgUser);
    res.json({ ok: true, profile });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});
// Legacy endpoint kept to signal chat-based flows are disabled
app.post('/api/profile/save', authMiddleware, (_req, res) => {
  res.status(410).json({ ok: false, error: 'profile_editing_available_only_in_mini_app' });
});
// Set design (совместимая точка)
  app.post('/api/profile/design', authMiddleware, async (req, res) => {
    try {
      const userId = req.userId;
      const rawDesign = typeof req.body?.design === 'string' ? req.body.design.trim() : '';
      if (!rawDesign) return res.status(400).json({ ok: false, error: 'design required' });
      const design = rawDesign.slice(0, 60);
      const p = await prisma.profile.upsert({
        where: { userId },
        create: {
          userId,
          name: 'Гость',
          age: 21,
          mood: '',
          contact: '',
          instagram: '',
          design,
        },
        update: { design },
      });
      res.json({ ok: true, profile: p });
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
    const self = await prisma.profile.findUnique({ where: { userId } });
    if (!self) return res.json({ status: 'need_profile' });

    const other = await popWaiting(); // пытаемся забрать ждущего
    if (other && Math.abs(now - other.ts) <= MATCH_WINDOW_MS && other.userId !== userId) {
      // нашли пару → фиксируем знакомство в БД
      const partnerId = other.userId;
      const dayKey = computeDayKey();
      const pairKey = makePairKey(userId, partnerId);
           const already = await prisma.meeting.findUnique({
        where: { pairKey_dayKey: { pairKey, dayKey } },
      });
      if (already) return res.json({ status: 'already_today' });
      await prisma.meeting.create({
        data: {
          userAId: userId,
          userBId: partnerId,
          pairKey,
          dayKey,
        },
      });
      // возвращаем данные партнёра (имя + username)
      const partner = await prisma.profile.findUnique({ where: { userId: partnerId } });
      const partnerContact = resolveProfileContact(partner);

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

    const list = await prisma.meeting.findMany({
      where: {
            metAt: { gte: from, lte: to },
        OR: [{ userAId: userId }, { userBId: userId }]
      },
            orderBy: { metAt: 'desc' }
    });

    const items = [];
    for (const m of list) {
              const otherId = m.userAId === userId ? m.userBId : m.userAId;
      const p = await prisma.profile.findUnique({ where: { userId: otherId } });
            items.push({ user_id: otherId, profile: p, at: m.metAt });
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
    const list = await prisma.meeting.findMany({
         where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { metAt: 'desc' },
      take: 20
    });
    const history = [];
    for (const m of list) {
      const otherId = m.userAId === userId ? m.userBId : m.userAId;
      const p = await prisma.profile.findUnique({ where: { userId: otherId } });
         history.push({
        withId: otherId,
        withUsername: p?.tgUsername || null,
        withName: p?.name || otherId,
        contact: resolveProfileContact(p),
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
    }
  });
}

bootstrap().catch(err => {
  console.error('Failed to launch server:', err?.message || err);
});