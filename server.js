// server.js — статика + API + Telegram webhook + "сведение пары" + дневной лимит + ПЕРСИСТЕНТНЫЙ СЧЁТ
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.set('trust proxy', 1);

// === ENV ===
const {
  BOT_TOKEN,                 // обязателен
  BASE_URL,                  // например: https://efes-app.onrender.com
  PORT = 3000,
  REDIS_URL,                 // опционально: если укажешь — будет надёжная память 24/7
  ENFORCE_DAILY = '1',       // "1" — пара может "чокнуться" только 1 раз в день (по умолчанию включено)
  VERIFY_INIT_DATA = '0'     // "1" — строго проверять подпись initData от Telegram
} = process.env;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');

// === Telegram Bot (webhook mode) ===
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// === Middleware ===
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname))); // index.html, style.css, script2.js, звуки

// Небольшой лог всех запросов
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// === Health / Debug ===
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/debug', (_req, res) => {
  res.json({
    status: 'OK',
    time: new Date().toISOString(),
    env: {
      BOT_TOKEN: BOT_TOKEN ? 'SET' : 'MISSING',
      BASE_URL: BASE_URL || 'NOT SET',
      REDIS: REDIS_URL ? 'ON' : 'OFF',
      ENFORCE_DAILY, VERIFY_INIT_DATA
    }
  });
});

// === Webhook endpoint (должен совпадать с setWebHook) ===
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ======================
//    ХРАНИЛКА/ПРОФИЛИ/СЧЁТЫ
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

// Fallback на память (если нет Redis)
const mem = {
  recent: [],                 // последние ~5 секунд чоков
  profiles: new Map(),        // userId -> { username, insta }
  pairs: new Map(),           // "min-max:YYYY-MM-DD" -> 1 (один чок/день)
  scores: new Map()           // userId -> total
};

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function pairKey(a, b, ts = Date.now()) {
  const [x, y] = [String(a), String(b)].sort();
  return `${x}-${y}:${dayKey(ts)}`;
}

// --- Профили ---
async function recordProfile(userId, username, insta) {
  if (!userId) return;
  if (redis) {
    await redis.hset(`profile:${userId}`, { username: username || '', insta: insta || '' });
  } else {
    mem.profiles.set(String(userId), { username: username || '', insta: insta || '' });
  }
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

// --- Очередь недавних чоков (для сведения пары) ---
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

// --- Дневной лимит (1 раз/день на пару) ---
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
    const end = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1, 0, 0, 0
    ));
    const ttl = Math.max(60, Math.floor((end - now) / 1000));
    await redis.set(pk, '1', 'EX', ttl, 'NX');
  } else {
    mem.pairs.set(key, 1);
  }
}

// --- Персистентные очки (total) ---
async function getTotal(userId) {
  if (!userId) return 0;
  if (redis) {
    const v = await redis.get(`score:${userId}`);
    return Number(v || 0);
  } else {
    return Number(mem.scores.get(String(userId)) || 0);
  }
}
async function addScore(userId, delta = 1) {
  if (!userId) return 0;
  if (redis) {
    const v = await redis.incrby(`score:${userId}`, delta);
    return Number(v || 0);
  } else {
    const cur = Number(mem.scores.get(String(userId)) || 0) + delta;
    mem.scores.set(String(userId), cur);
    return cur;
  }
}

// --- Проверка подписи initData (опционально) ---
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
  } catch {
    return false;
  }
}

// ======================
//        API
// ======================

// Быстрый эндпоинт прогресса при входе (возвращает total + профиль)
app.post('/progress', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, message: 'userId required' });
    const total = await getTotal(userId);
    const profile = await getProfile(userId);
    return res.json({ ok: true, total, profile: profile || { username: null, insta: null } });
  } catch (e) {
    console.error('progress error', e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});

// Основной эндпоинт чока
app.post('/shake', async (req, res) => {
  try {
    const { userId, username, insta, clientTs, source, device, initData } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, message: 'userId required', awarded: false });

    if (VERIFY_INIT_DATA === '1') {
      if (!initData || !verifyInitData(initData, BOT_TOKEN)) {
        return res.status(401).json({ ok: false, message: 'invalid initData', awarded: false });
      }
    }

    const ts = (typeof clientTs === 'number' && clientTs > 0) ? clientTs : Date.now();
    const today = dayKey(ts);

    // сохраним профиль (username/insta)
    await recordProfile(userId, username, insta);

    // добавим событие в "последние"
    await addRecentShake(userId, username, insta, ts);

    // ищем пару (кто-то другой в окне ~2.5с)
    let partner = await findPartner(userId, ts, 2500);

    if (partner) {
      // ограничение "раз в день"
      if (ENFORCE_DAILY === '1') {
        const already = await hasPairedToday(userId, partner.userId, ts);
        if (already) {
          // пара уже чокалась сегодня — не начисляем
          const p = await getProfile(partner.userId);
          const partnerPublic = {
            userId: partner.userId,
            username: p?.username || partner.username || null,
            insta: p?.insta || partner.insta || null
          };
          const total = await getTotal(userId); // без изменения
          return res.json({
            ok: true,
            message: 'Сегодня вы уже чокались вместе',
            awarded: false,
            date: today,
            partner: partnerPublic,
            total
          });
        }
        // отмечаем пару на сегодня (и только теперь "начисляем")
        await markPairedToday(userId, partner.userId, ts);
      }

      // начисляем очко ТОЛЬКО когда пара реальная
      const newTotal = await addScore(userId, 1);

      // актуализируем данные партнёра
      const p = await getProfile(partner.userId);
      const partnerPublic = {
        userId: partner.userId,
        username: p?.username || partner.username || null,
        insta: p?.insta || partner.insta || null
      };

      return res.json({
        ok: true,
        message: 'Чок засчитан!',
        awarded: true,
        date: today,
        partner: partnerPublic,
        total: newTotal
      });
    }

    // Партнёр ещё не найден — ничего не начисляем
    const total = await getTotal(userId);
    return res.json({
      ok: true,
      message: 'Ожидаем второго чока...',
      awarded: false,
      date: today,
      partner: null,
      total
    });
  } catch (e) {
    console.error('shake error', e);
    res.status(500).json({ ok: false, message: 'server error', awarded: false });
  }
});

// === /start — кнопка "Открыть карточку" ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🍺 Добро пожаловать в Efes Club! Открой свою карту:', {
    reply_markup: {
      inline_keyboard: [[{
        text: '🎉 Открыть карточку',
        web_app: { url: BASE_URL || `http://localhost:${PORT}` }
      }]]
    }
  });
});

// === Установка webhook ===
async function setupWebhook() {
  if (!BASE_URL) {
    console.warn('BASE_URL not set; skipping setWebHook');
    return;
  }
  const url = `${BASE_URL}/bot${BOT_TOKEN}`;
  await bot.setWebHook(url);
  console.log('Webhook set:', url);
}

// === Запуск ===
app.listen(PORT, async () => {
  console.log(`Server running on :${PORT}`);
  try { await setupWebhook(); } catch (e) { console.error('Webhook setup failed:', e); }
});