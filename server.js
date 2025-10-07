require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const { PrismaClient } = require('@prisma/client');

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ---------- Config ----------
const PORT = process.env.PORT || 10000;
const PUBLIC_URL = process.env.PUBLIC_URL || ''; // e.g. https://efes-app.onrender.com
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const TELEGRAM_WEBHOOK_PATH = `/telegram/webhook${TELEGRAM_WEBHOOK_SECRET ? `/${TELEGRAM_WEBHOOK_SECRET}` : ''}`;
const TELEGRAM_API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';
// ---------- Prisma ----------
const prisma = new PrismaClient();

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
    const p = await prisma.profile.findUnique({ where: { userId } });
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
      await prisma.profile.update({ where: { userId }, data: updates });
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

  const contact = rawContact || tgHandle || '';

  return {
    name: rawName,
    mood: rawMood,
    age,
    contact,
    tgUsername: tgUser?.username || null,
  };
}

async function upsertProfileFromWebApp(userId, body, tgUser) {
  const existing = await prisma.profile.findUnique({ where: { userId } });
  const fields = pickProfileFields(body, tgUser);

  const name = (fields.name || existing?.name || 'Гость').slice(0, 120);
  const mood = (((fields.mood ?? existing?.mood) || '')).slice(0, 160);
  const contactSource = fields.contact || existing?.contact || normalizeContact(existing?.tgUsername) || '';
  const contact = contactSource.slice(0, 120);

  const data = {
    name,
    age: fields.age ?? existing?.age ?? 21,
    mood,
    contact,
    instagram: contact,
    tgUsername: fields.tgUsername,
  };

  if (existing) {
    return prisma.profile.update({ where: { userId }, data });
  }

  return prisma.profile.create({
    data: {
      ...data,
      userId,
      design: 'classic',
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
  console.log('Redis: DISABLED (no REDIS_URL)');
}

// ---------- Telegram bot helpers ----------
const START_KEYBOARD = {
  keyboard: [[{ text: 'Старт' }]],
  resize_keyboard: true,
  is_persistent: true,
};

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

async function sendStartInstruction(message) {
  const chatId = message?.chat?.id;
  if (!chatId) return;

  const replyMarkup = message?.chat?.type === 'private' ? START_KEYBOARD : undefined;

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: 'Нажми кнопку «Старт» ниже, чтобы мы познакомились поближе 😊',
    reply_markup: replyMarkup,
  });
}

async function sendGreetingAndMiniApp(message) {
  const chatId = message?.chat?.id;
  if (!chatId) return;

  const greetingText = formatGreeting(message);
  const replyMarkup = message?.chat?.type === 'private' ? START_KEYBOARD : undefined;

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: greetingText,
    reply_markup: replyMarkup,
  });

  const miniAppButton = buildMiniAppButton();
  const miniAppMessage = {
    chat_id: chatId,
    text: miniAppButton
      ? 'Готов пройти анкету, выбрать настроение и чокнуться с другими гостями? Жми кнопку ниже!'
      : 'Мини-приложение сейчас недоступно: администратору нужно настроить PUBLIC_URL.',
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
        text: 'Данные мини-приложения получены! Если хочешь начать сначала — напиши «/start».',
      });
      return;
    }
    const rawText = typeof message.text === 'string' ? message.text.trim() : '';
    const normalized = rawText.toLowerCase();

    if (rawText === '/start') {
      await sendStartInstruction(message);
      return;
    }

    if (normalized === 'старт' || normalized === 'start') {
      await sendGreetingAndMiniApp(message);
      return;
    }

    if (normalized) {
      const replyMarkup = message?.chat?.type === 'private' ? START_KEYBOARD : undefined;
      await callTelegram('sendMessage', {
        chat_id: message.chat.id,
        text: 'Напиши «/start», чтобы получить ссылку и кнопку запуска.',
        reply_markup: replyMarkup,
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
    const p = await prisma.profile.findUnique({ where: { userId: String(uid) } });
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
      const { design } = req.body || {};
      if (!design) return res.status(400).json({ ok: false, error: 'design required' });

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
app.listen(PORT, () => {
  console.log(`Efes app listening on :${PORT}`);
  if (!PUBLIC_URL) console.log('TIP: set PUBLIC_URL for QR links.');
  if (BOT_TOKEN) {
       ensureTelegramWebhook();
  }
});