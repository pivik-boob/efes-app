// server.js — один бот, два мини-аппа (cheers + predict) + API «чоков» + webhook
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.set('trust proxy', 1);

// ===== ENV =====
const {
  BOT_TOKEN,                 // обязательно
  BASE_URL,                  // напр.: https://efes-app.onrender.com
  PORT = 3000,
  REDIS_URL,                 // если есть — очки и пары 24/7
  ENFORCE_DAILY = '1',       // "1" — одна и та же пара может «чокнуться» 1 раз/день
  VERIFY_INIT_DATA = '0'     // "1" — проверять подпись initData из Telegram
} = process.env;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');

// ===== BOT (webhook mode) =====
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// =======================
//   СТАТИКА ДЛЯ ЧОКОВ
//   (корень проекта -> /app/cheers)
// =======================
app.use('/app/cheers', express.static(path.join(__dirname)));
app.get('/app/cheers', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// =======================
//   СТАТИКА ДЛЯ ПРЕДСКАЗАНИЙ
//   (ищем либо apps/predict, либо appps/predict — на случай опечатки)
// =======================
const CANDIDATES = [
  path.join(__dirname, 'apps', 'predict'),
  path.join(__dirname, 'appps', 'predict'),
];
const PREDICT_DIR = CANDIDATES.find(p => fs.existsSync(path.join(p, 'index.html'))) || CANDIDATES[0];

app.use('/app/predict', express.static(PREDICT_DIR));
app.get('/app/predict', (_req, res) => {
  const file = path.join(PREDICT_DIR, 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send('predict app not found');
});

// ассеты из корня (картинки/звуки), если кто-то обращается по прямым путям
app.use(express.static(path.join(__dirname)));

// логи/health/debug
app.use((req, _res, next) => { console.log(`${new Date().toISOString()} ${req.method} ${req.path}`); next(); });
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/debug', (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    env: {
      BASE_URL: BASE_URL || 'NOT SET',
      REDIS: REDIS_URL ? 'ON' : 'OFF',
      ENFORCE_DAILY, VERIFY_INIT_DATA,
      PREDICT_DIR
    }
  });
});

// ===== Webhook endpoint (должен совпадать с setWebHook) =====
app.post(`/bot${BOT_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });

// ======================
//    ХРАНИЛКА/ПРОФИЛИ/СЧЁТЫ (для «чоков»)
// ======================
let redis = null;
if (REDIS_URL) {
  try {
    const IORedis = require('ioredis');
    redis = new IORedis(REDIS_URL);
    redis.on('error', (e) => console.error('Redis error:', e));
    console.log('Redis connected');
  } catch (e) {
    console.warn('Cannot init Redis, fallback to memory:', e.message);
    redis = null;
  }
}
const mem = { recent: [], profiles: new Map(), pairs: new Map(), scores: new Map() };

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function pairKey(a, b, ts = Date.now()) { const [x, y] = [String(a), String(b)].sort(); return `${x}-${y}:${dayKey(ts)}`; }

async function recordProfile(userId, username, insta) {
  if (!userId) return;
  if (redis) await redis.hset(`profile:${userId}`, { username: username || '', insta: insta || '' });
  else mem.profiles.set(String(userId), { username: username || '', insta: insta || '' });
}
async function getProfile(userId) {
  if (!userId) return null;
  if (redis) {
    const o = await redis.hgetall(`profile:${userId}`);
    if (!o || Object.keys(o).length === 0) return null;
    return { username: o.username || '', insta: o.insta || '' };
  }
  return mem.profiles.get(String(userId)) || null;
}

async function addRecentShake(userId, username, insta, ts) {
  if (redis) {
    const key = 'shake:recent';
    const payload = JSON.stringify({ userId, username, insta, ts });
    await redis.zadd(key, ts, payload);
    await redis.zremrangebyscore(key, 0, ts - 5000);
  } else {
    mem.recent.push({ userId, username, insta, ts });
    const cutoff = ts - 5000;
    mem.recent = mem.recent.filter(x => x.ts >= cutoff).slice(-200);
  }
}
async function findPartner(userId, ts, windowMs = 2500) {
  if (redis) {
    const key = 'shake:recent';
    const arr = await redis.zrangebyscore(key, ts - windowMs, ts + windowMs);
    const candidates = arr
      .map(v => { try { return JSON.parse(v); } catch { return null; } })
      .filter(Boolean)
      .filter(x => String(x.userId) !== String(userId));
    return candidates.length ? candidates[candidates.length - 1] : null;
  } else {
    for (let i = mem.recent.length - 1; i >= 0; i--) {
      const x = mem.recent[i];
      if (String(x.userId) === String(userId)) continue;
      if (Math.abs(x.ts - ts) <= windowMs) return x;
    }
    return null;
  }
}

async function hasPairedToday(id1, id2, ts) {
  const key = pairKey(id1, id2, ts);
  if (redis) return (await redis.exists(`pair:${key}`)) === 1;
  return mem.pairs.has(key);
}
async function markPairedToday(id1, id2, ts) {
  const key = pairKey(id1, id2, ts);
  if (redis) {
    const pk = `pair:${key}`;
    const now = new Date(ts);
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    const ttl = Math.max(60, Math.floor((end - now) / 1000));
    await redis.set(pk, '1', 'EX', ttl, 'NX');
  } else mem.pairs.set(key, 1);
}

async function getTotal(userId) {
  if (!userId) return 0;
  if (redis) return Number(await redis.get(`score:${userId}`) || 0);
  return Number(mem.scores.get(String(userId)) || 0);
}
async function addScore(userId, delta = 1) {
  if (!userId) return 0;
  if (redis) return Number(await redis.incrby(`score:${userId}`, delta) || 0);
  const cur = Number(mem.scores.get(String(userId)) || 0) + delta;
  mem.scores.set(String(userId), cur);
  return cur;
}

function verifyInitData(initDataStr, token) {
  try {
    const urlParams = new URLSearchParams(initDataStr);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    const dataCheckString = Array.from(urlParams.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const crypto = require('crypto');
    const secret = crypto.createHash('sha256').update(token).digest();
    const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    return hmac === hash;
  } catch { return false; }
}

// ======================
//        API (CHEERS)
// ======================
app.post('/progress', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, message: 'userId required' });
    const total = await getTotal(userId);
    const profile = await getProfile(userId);
    res.json({ ok: true, total, profile: profile || { username: null, insta: null } });
  } catch (e) {
    console.error('progress error', e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});

app.post('/shake', async (req, res) => {
  try {
    const { userId, username, insta, clientTs, initData } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, message: 'userId required', awarded: false });

    if (VERIFY_INIT_DATA === '1') {
      if (!initData || !verifyInitData(initData, BOT_TOKEN)) {
        return res.status(401).json({ ok: false, message: 'invalid initData', awarded: false });
      }
    }

    const ts = (typeof clientTs === 'number' && clientTs > 0) ? clientTs : Date.now();
    const today = dayKey(ts);

    await recordProfile(userId, username, insta);
    await addRecentShake(userId, username, insta, ts);

    const partner = await findPartner(userId, ts, 2500);
    if (partner) {
      if (ENFORCE_DAILY === '1') {
        const already = await hasPairedToday(userId, partner.userId, ts);
        if (already) {
          const p = await getProfile(partner.userId);
          const partnerPublic = {
            userId: partner.userId,
            username: p?.username || partner.username || null,
            insta: p?.insta || partner.insta || null
          };
          const total = await getTotal(userId);
          return res.json({ ok: true, message: 'Сегодня вы уже чокались вместе', awarded: false, date: today, partner: partnerPublic, total });
        }
        await markPairedToday(userId, partner.userId, ts);
      }

      const newTotal = await addScore(userId, 1);
      const p = await getProfile(partner.userId);
      const partnerPublic = {
        userId: partner.userId,
        username: p?.username || partner.username || null,
        insta: p?.insta || partner.insta || null
      };

      return res.json({ ok: true, message: 'Чок засчитан!', awarded: true, date: today, partner: partnerPublic, total: newTotal });
    }

    const total = await getTotal(userId);
    res.json({ ok: true, message: 'Ожидаем второго чока...', awarded: false, date: today, partner: null, total });
  } catch (e) {
    console.error('shake error', e);
    res.status(500).json({ ok: false, message: 'server error', awarded: false });
  }
});

// ======================
//    БОТ: команды и меню
// ======================
async function setupCommands() {
  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Старт' },
      { command: 'cheers', description: 'Открыть «Чок!»' },
      { command: 'predict', description: 'Открыть «Предсказания»' },
      { command: 'help', description: 'Помощь' },
    ]);
  } catch (e) { console.warn('setMyCommands failed:', e.message); }
}

function mainMenu(chatId) {
  const base = BASE_URL || `http://localhost:${PORT}`;
  bot.sendMessage(chatId, 'Выбери мини-приложение:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🍺 Чок!',         web_app: { url: `${base}/app/cheers` } }],
        [{ text: '🔮 Предсказания', web_app: { url: `${base}/app/predict` } }],
        [{ text: 'ℹ️ Помощь',       callback_data: 'help' }]
      ]
    }
  });
}

bot.onText(/\/start/, (msg) => mainMenu(msg.chat.id));

bot.onText(/\/cheers/, (msg) => {
  const base = BASE_URL || `http://localhost:${PORT}`;
  bot.sendMessage(msg.chat.id, 'Открываю «Чок!»', {
    reply_markup: { inline_keyboard: [[{ text: '🍺 Чок!', web_app: { url: `${base}/app/cheers` } }]] }
  });
});

bot.onText(/\/predict/, (msg) => {
  const base = BASE_URL || `http://localhost:${PORT}`;
  bot.sendMessage(msg.chat.id, 'Открываю «Предсказания»', {
    reply_markup: { inline_keyboard: [[{ text: '🔮 Предсказания', web_app: { url: `${base}/app/predict` } }]] }
  });
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
`Помощь:
• /cheers — открыть «Чок!»
• /predict — открыть «Предсказания»
• /start — главное меню`);
});

bot.on('callback_query', (q) => {
  const chatId = q.message.chat.id;
  if (q.data === 'help') {
    bot.answerCallbackQuery(q.id);
    bot.sendMessage(chatId, 'Это мульти-бот. Доступны «Чок!» и «Предсказания». Выбирай на клавиатуре.');
  } else {
    bot.answerCallbackQuery(q.id, { text: 'Ок' });
  }
});

// ===== Webhook =====
async function setupWebhook() {
  if (!BASE_URL) { console.warn('BASE_URL not set; skipping setWebHook'); return; }
  const url = `${BASE_URL}/bot${BOT_TOKEN}`;
  await bot.setWebHook(url);
  console.log('Webhook set:', url);
}

// ===== START =====
app.listen(PORT, async () => {
  console.log(`Server running on :${PORT}`);
  try { await setupCommands(); } catch {}
  try { await setupWebhook(); } catch (e) { console.error('Webhook setup failed:', e); }
});