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
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'efes_secret';

// ---------- Prisma ----------
const prisma = new PrismaClient();

// ---------- Helpers: sync Telegram username (no auto-create) ----------
async function syncTgUsername(userId, tgUser) {
  try {
    const uname = tgUser?.username || null;
    const p = await prisma.profile.findUnique({ where: { userId } });
    if (p && p.tgUsername !== uname) {
      await prisma.profile.update({ where: { userId }, data: { tgUsername: uname } });
    }
  } catch (_) {}
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
    // ВАЖНО: не создаём автоматически — чтобы WebApp мог показать кнопку «Заполнить в чате»
    if (!p) return res.json({ profile: null });
    res.json({ profile: p });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// Save/Upsert profile (поддерживает insta → contact)
app.post('/api/profile/save', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { name, age, mood, contact, insta } = req.body || {};

    const dataUpdate = {};
    if (name) dataUpdate.name = String(name).slice(0, 120);
    if (age) dataUpdate.age = Number(age);
    if (mood) dataUpdate.mood = String(mood).slice(0, 120);
    if (contact || insta) dataUpdate.contact = String(contact || insta).slice(0, 120);

    const p = await prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        name: dataUpdate.name || 'Гость',
        age: dataUpdate.age || 21,
        mood: dataUpdate.mood || '',
        contact: dataUpdate.contact || '',
        design: 'classic'
      },
      update: dataUpdate,
    });

    res.json({ ok: true, profile: p });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// Set design (совместимая точка)
app.post('/api/profile/design', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { design } = req.body || {};
    if (!design) return res.status(400).json({ ok: false, error: 'design required' });

    const p = await prisma.profile.upsert({
      where: { userId },
      create: { userId, name: 'Гость', age: 18, mood: '', contact: '', design },
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

      // one-per-day rule (пара только раз в сутки)
      const start = new Date(); start.setHours(0,0,0,0);
      const end = new Date();   end.setHours(23,59,59,999);

      const already = await prisma.meeting.findFirst({
        where: {
          createdAt: { gte: start, lte: end },
          OR: [
            { aId: userId, bId: partnerId },
            { aId: partnerId, bId: userId },
          ]
        }
      });
      if (already) return res.json({ status: 'already_today' });

      await prisma.meeting.create({ data: { aId: userId, bId: partnerId } });

      // возвращаем данные партнёра (имя + username), без системы баллов
      const partner = await prisma.profile.findUnique({ where: { userId: partnerId } });

      return res.json({
        status: 'matched',
        other: { id: partnerId, name: partner?.name || 'Гость', username: partner?.tgUsername || null, contact: partner?.contact || '' }
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
        createdAt: { gte: from, lte: to },
        OR: [{ aId: userId }, { bId: userId }]
      },
      orderBy: { createdAt: 'desc' }
    });

    const items = [];
    for (const m of list) {
      const otherId = m.aId === userId ? m.bId : m.aId;
      const p = await prisma.profile.findUnique({ where: { userId: otherId } });
      items.push({ user_id: otherId, profile: p, at: m.createdAt });
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
      where: { OR: [{ aId: userId }, { bId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    const history = [];
    for (const m of list) {
      const otherId = m.aId === userId ? m.bId : m.aId;
      const p = await prisma.profile.findUnique({ where: { userId: otherId } });
      history.push({ withId: otherId, withUsername: p?.tgUsername || null, withName: p?.name || otherId, at: m.createdAt });
    }
    res.json({ ok: true, history });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// ---------- Gift codes ----------
app.post('/api/gift/create', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body || {};
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    await prisma.giftCode.create({ data: { code, status: 'NEW', message: message || null } });
    res.json({ ok: true, code, link: `${PUBLIC_URL}/gift/${code}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

app.get('/gift/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const g = await prisma.giftCode.findUnique({ where: { code } });
    if (!g) return res.status(404).send('Код не найден');
    res.send(`Подарочный код ${code}. Статус: ${g.status}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка сервера');
  }
});

// совместимость: оба варианта погашения
app.post('/gift/:code/redeem', async (req, res) => {
  try {
    const code = req.params.code;
    const g = await prisma.giftCode.findUnique({ where: { code } });
    if (!g) return res.status(404).send('Код не найден');
    if (g.status === 'USED') return res.send('Код уже использован.');

    await prisma.giftCode.update({ where: { code }, data: { status: 'USED', usedAt: new Date() } });
    res.send('Код успешно погашен ✅');
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка сервера');
  }
});

app.post('/api/gift/redeem', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const code = req.body.code;
    const g = await prisma.giftCode.findUnique({ where: { code } });
    if (!g) return res.status(404).send('Код не найден');
    if (g.status === 'USED') return res.send('Код уже использован.');

    await prisma.giftCode.update({ where: { code }, data: { status: 'USED', usedAt: new Date() } });
    res.send('Код успешно погашен ✅');
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка сервера');
  }
});

// ---------- Bot (Telegraf webhook) ----------
async function initBot() {
  console.log('Bot: initBot() start');
  if (!BOT_TOKEN)  { console.log('Bot: DISABLED (no TELEGRAM_BOT_TOKEN)'); return; }
  if (!PUBLIC_URL) { console.log('Bot: PUBLIC_URL is empty — webhook cannot be set'); return; }

  const { Telegraf } = require('telegraf');
  const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 9000 });

  const webAppUrl = PUBLIC_URL || '';
  const userStates = new Map(); // анкета в памяти (простая)

  // --- /start: приветствие + автозапуск анкеты для новых пользователей ---
  bot.start(async (ctx) => {
    try {
      const uid = String(ctx.from.id);
      const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'друг';

      // тёплое приветствие Пивика
      await ctx.reply(
        `Привет, ${displayName}! 😄\n\n` +
        `Я Пивик — твой ассистент в мире Эфеса 🍻\n` +
        `Помогу создать твою цифровую бутылочку и чокаться с друзьями!`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: 'Открыть цифровую бутылочку', web_app: { url: webAppUrl } }]]
          }
        }
      );

      const p = await prisma.profile.findUnique({ where: { userId: uid } });
      if (p) {
        // профиль уже есть — ничего больше не спрашиваем
        return;
      }

      // профиля нет — сразу запускаем анкету
      userStates.set(ctx.from.id, { step: 'name', draft: {} });
      await ctx.reply('Давай создадим твою бутылочку! Как тебя зовут?');
    } catch (e) {
      console.error('profile check on /start:', e);
    }
  });

  // --- Анкета (всегда доступна для новых; простая последовательность) ---
  bot.on('text', async (ctx) => {
    const st = userStates.get(ctx.from.id);
    if (!st) return; // не в анкете — игнор

    const text = (ctx.message.text || '').trim();
    const uid  = String(ctx.from.id);

    if (st.step === 'name') {
      st.draft.name = text.slice(0,120);
      st.step = 'age';
      return ctx.reply('Отлично! Сколько тебе лет? (числом, 21–120)');
    }

    if (st.step === 'age') {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 21 || n > 120)
        return ctx.reply('Введи число от 21 до 120 🙂');
      st.draft.age = n;
      st.step = 'mood';
      return ctx.reply('Какое у тебя настроение? (например: 🙂, 😎, 🎉)');
    }

    if (st.step === 'mood') {
      st.draft.mood = text.slice(0,32);
      st.step = 'contact';
      return ctx.reply('Оставь Instagram (без @) или любой контакт (можно пропустить, напиши «пропустить»).');
    }

    if (st.step === 'contact') {
      if (!/пропусти|skip/i.test(text)) st.draft.contact = text.slice(0,120);
      try {
        await prisma.profile.upsert({
          where:  { userId: uid },
          create: { userId: uid, name: st.draft.name, age: st.draft.age, mood: st.draft.mood, contact: st.draft.contact || '', design: 'classic', tgUsername: ctx.from.username || null },
          update: { name: st.draft.name, age: st.draft.age, mood: st.draft.mood, contact: st.draft.contact || '', tgUsername: ctx.from.username || null }
        });
        userStates.delete(ctx.from.id);
        await ctx.reply(
          'Готово! Открывай мини-апп и чокайся 🥂',
          { reply_markup: { inline_keyboard: [[{ text: 'Открыть карту', web_app: { url: webAppUrl } }]] } }
        );
      } catch (e) {
        console.error('upsert profile from bot failed:', e);
        await ctx.reply('Упс, не сохранилось. Попробуй ещё раз /start.');
      }
    }
  });

  // Доп. меню (по желанию)
  bot.action('open_bottle', async (ctx) => {
    await ctx.reply('Открываю твою бутылочку 🍺', {
      reply_markup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url: webAppUrl } }]] }
    });
    await ctx.answerCbQuery();
  });

  bot.action('main_menu', async (ctx) => {
    await ctx.reply('Главное меню 📋', {
      reply_markup: { inline_keyboard: [[{ text: 'Открыть цифровую бутылочку', web_app: { url: webAppUrl } }]] }
    });
    await ctx.answerCbQuery();
  });

  // --- webhook ---
  const webhookPath = `/bot/${WEBHOOK_SECRET}`;
  app.use(bot.webhookCallback(webhookPath));
  await bot.telegram.setWebhook(`${PUBLIC_URL}${webhookPath}`);
  console.log('Bot: webhook set to', `${PUBLIC_URL}${webhookPath}`);
}

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Efes app listening on :${PORT}`);
  if (!PUBLIC_URL) console.log('TIP: set PUBLIC_URL for QR links.');
  initBot().catch(err => console.error('Bot init failed:', err));
});
