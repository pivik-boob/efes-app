// server.js — один бот, два мини-аппа (cheers + predict) + API «чоков» + webhook
// + живой онбординг, сценарий "интересы", и тест "Какая ты бутылочка Efes?"
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
  REDIS_URL,                 // если есть — очки/пары/состояния 24/7
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
//   СТАТИКА ДЛЯ ЧОКОВ (корень проекта -> /app/cheers)
// =======================
app.use('/app/cheers', express.static(path.join(__dirname)));
app.get('/app/cheers', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// =======================
//   СТАТИКА ДЛЯ ПРЕДСКАЗАНИЙ (apps/predict ИЛИ appps/predict)
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

// ассеты из корня
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

// ===== Webhook endpoint =====
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
const mem = { recent: [], profiles: new Map(), pairs: new Map(), scores: new Map(), state: new Map() };

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function pairKey(a, b, ts = Date.now()) { const [x, y] = [String(a), String(b)].sort(); return `${x}-${y}:${dayKey(ts)}`; }

// ===== профили/очки/пары =====
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
    const candidates = arr.map(v => { try { return JSON.parse(v); } catch { return null; } })
      .filter(Boolean).filter(x => String(x.userId) !== String(userId));
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
    const hash = urlParams.get('hash'); urlParams.delete('hash');
    const dataCheckString = Array.from(urlParams.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k}=${v}`).join('\n');
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
          const partnerPublic = { userId: partner.userId, username: p?.username || partner.username || null, insta: p?.insta || partner.insta || null };
          const total = await getTotal(userId);
          return res.json({ ok: true, message: 'Сегодня вы уже чокались вместе', awarded: false, date: today, partner: partnerPublic, total });
        }
        await markPairedToday(userId, partner.userId, ts);
      }

      const newTotal = await addScore(userId, 1);
      const p = await getProfile(partner.userId);
      const partnerPublic = { userId: partner.userId, username: p?.username || partner.username || null, insta: p?.insta || partner.insta || null };
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
//    БОТ: команды, живой онбординг, интересы, квиз-бутылочка
// ======================

// --- хранилище состояния диалогов (интересты/квиз) ---
async function getState(userId) {
  if (redis) {
    const raw = await redis.get(`state:${userId}`);
    return raw ? JSON.parse(raw) : {};
  }
  return mem.state.get(String(userId)) || {};
}
async function setState(userId, state, ttlSec = 3600) {
  if (redis) {
    await redis.set(`state:${userId}`, JSON.stringify(state), 'EX', ttlSec);
  } else {
    mem.state.set(String(userId), state);
    setTimeout(() => mem.state.delete(String(userId)), ttlSec * 1000).unref?.();
  }
}
async function clearState(userId) {
  if (redis) await redis.del(`state:${userId}`);
  else mem.state.delete(String(userId));
}

// --- приветствие/меню ---
async function sendWelcome(chatId, user) {
  const name = user?.first_name || 'друг';
  const base = BASE_URL || `http://localhost:${PORT}`;
  const text =
`Привет, ${name}! 😄
Я — *Пивик*, твой ассистент в мире *Efes* 🍻

Вот что мы можем сделать прямо сейчас:

• *🍺 Цифровая бутылочка* — чокнись, обменяйся контактами, копи баллы.
• *🔮 Бутылочка-предсказания* — тапни по бутылке, и из горлышка «вылетит» предсказание с озвучкой.
• *🎉 Найти тусовку по интересу* — подберу каналы и форматы под твой вайб.

Выбирай опцию ниже:`;
  const kb = {
    inline_keyboard: [
      [{ text: '🍺 Открыть цифровую бутылочку', web_app: { url: `${base}/app/cheers` } }],
      [{ text: '🔮 Бутылочка с предсказаниями', web_app: { url: `${base}/app/predict` } }],
      [{ text: '🎉 Найти тусовку по интересу', callback_data: 'menu_interests' }],
      // календарь пока подождёт
    ]
  };
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: kb });
}

// --- сценарий "интересы" ---
const INTEREST_OPTIONS = [
  { key: 'party',  label: '🕺 Вечеринки и тусовки' },
  { key: 'active', label: '🏃‍♀️ Активный отдых' },
  { key: 'theme',  label: '🎭 Тематические вечера' },
  { key: 'eco',    label: '🌱 Эко-тусовки' }
];

function interestsKeyboard() {
  return {
    inline_keyboard: INTEREST_OPTIONS.map(o => [{ text: o.label, callback_data: `interests_${o.key}` }])
      .concat([ [{ text: '↩️ В главное меню', callback_data: 'back_menu' }] ])
  };
}

async function startInterestsFlow(chatId) {
  const text =
`Круто! Давай познакомимся поближе.
Как тебе нравится проводить время? Выбери вариант — и я подберу каналы/форматы:`;
  await bot.sendMessage(chatId, text, { reply_markup: interestsKeyboard() });
}

async function replyInterests(chatId, key) {
  const baseText = 'Классно! Вот куда стоит заглянуть:';
  // Плейсхолдеры ссылок — замени на свои каналы
  const byKey = {
    party: {
      text: `${baseText}\n• *Efes Party Hub*\n• *Night Vibes*\n\nСледи за анонсами, находи новые знакомства и чокайся чаще 😉`,
      links: [
        { title: 'Efes Party Hub', url: 'https://t.me/efes_party' },
        { title: 'Night Vibes',    url: 'https://t.me/night_vibes' }
      ]
    },
    active: {
      text: `${baseText}\n• *Outdoor & Beer*\n• *Ride&Run*\n\nМного активностей на свежем воздухе — а потом заслуженный Efes 🍺`,
      links: [
        { title: 'Outdoor & Beer', url: 'https://t.me/outdoor_beer' },
        { title: 'Ride&Run',       url: 'https://t.me/ride_run' }
      ]
    },
    theme: {
      text: `${baseText}\n• *Efes Thematic*\n• *Trivia Nights*\n\nКвиз-вечера, киновстречи, музыкальные пятницы — выбери своё!`,
      links: [
        { title: 'Efes Thematic', url: 'https://t.me/efes_theme' },
        { title: 'Trivia Nights', url: 'https://t.me/trivia_nights' }
      ]
    },
    eco: {
      text: `${baseText}\n• *Green Meetup*\n• *Eco&Friends*\n\nЭко-маршруты и добрые инициативы — и приятный чок в конце пути 🌿`,
      links: [
        { title: 'Green Meetup',  url: 'https://t.me/green_meet' },
        { title: 'Eco&Friends',   url: 'https://t.me/eco_friends' }
      ]
    }
  };
  const pick = byKey[key] || byKey.party;
  const kb = {
    inline_keyboard: [
      ...pick.links.map(l => [{ text: `➜ ${l.title}`, url: l.url }]),
      [{ text: '↩️ В главное меню', callback_data: 'back_menu' }]
    ]
  };
  await bot.sendMessage(chatId, pick.text, { parse_mode: 'Markdown', reply_markup: kb });
}

// --- тест "Какая ты бутылочка Efes?" ---
const BRANDS = {
  efes:   { title: 'EFES',              emoji: '🍺', desc: 'Классика, баланс, общительность. Ты легко заводишь новые знакомства и любишь дружеский чок.' },
  miller: { title: 'Miller',            emoji: '✨', desc: 'Лёгкость и стиль. Предпочитаешь лёгкие форматы и уютные вечеринки.' },
  bely:   { title: 'Белый Медведь',     emoji: '🐻', desc: 'Тёплый характер и надёжность. Ценишь компанию и долгие разговоры.' },
  karag:  { title: 'Карагандинское',    emoji: '🛠️', desc: 'Аутентичность и характер. Любишь атмосферу локальных мест и честный вкус.' },
  kruzh:  { title: 'Кружка свежего',    emoji: '🍻', desc: 'Свежесть и живость. Тебя тянет к событиям, где кипит жизнь.' },
};

const QUIZ = [
  {
    key: 'q1',
    text: 'Где тебе комфортнее всего знакомиться?',
    opts: [
      { label: 'Громкая вечеринка', score: { kruzh:1, miller:1 } },
      { label: 'Уютный бар',        score: { efes:1, bely:1 } },
      { label: 'Локальный паб',     score: { karag:1, efes:1 } },
    ]
  },
  {
    key: 'q2',
    text: 'Выбери вайб вечера:',
    opts: [
      { label: 'Лёгкий чилл',   score: { miller:1 } },
      { label: 'Дружеский шум', score: { kruzh:1, efes:1 } },
      { label: 'Аутентично',    score: { karag:1, bely:1 } },
    ]
  },
  {
    key: 'q3',
    text: 'Что важнее всего?',
    opts: [
      { label: 'Баланс вкуса',     score: { efes:1 } },
      { label: 'Атмосфера места',  score: { karag:1 } },
      { label: 'Тёплая компания',  score: { bely:1 } },
    ]
  },
  {
    key: 'q4',
    text: 'Как ты обычно проводишь выходные?',
    opts: [
      { label: 'Активно, на движении', score: { kruzh:1 } },
      { label: 'Стильно и легко',      score: { miller:1 } },
      { label: 'Дома с друзьями',      score: { bely:1, efes:1 } },
    ]
  },
  {
    key: 'q5',
    text: 'Выбери плейлист:',
    opts: [
      { label: 'Хиты для тусовки', score: { kruzh:1, miller:1 } },
      { label: 'Инди и уют',       score: { bely:1 } },
      { label: 'Классика жанра',   score: { efes:1, karag:1 } },
    ]
  }
];

function quizStartKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🚀 Пройти тест', callback_data: 'quiz_start' }],
      [{ text: '↩️ В главное меню', callback_data: 'back_menu' }]
    ]
  };
}
async function startBottleQuiz(chatId) {
  const text =
`Давай определим, какая *бутылочка Efes* — это ты 😄
Ответь на 5 коротких вопросов — и я покажу результат c описанием и эмодзи.

Готова/готов?`;
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: quizStartKeyboard() });
}
function questionKeyboard(qIndex) {
  const q = QUIZ[qIndex];
  return {
    inline_keyboard: [
      ...q.opts.map((o, i) => [{ text: o.label, callback_data: `quiz_${qIndex}_${i}` }]),
      [{ text: '↩️ В главное меню', callback_data: 'back_menu' }]
    ]
  };
}
function scoreAdd(dst, add) {
  Object.entries(add).forEach(([k, v]) => { dst[k] = (dst[k] || 0) + v; });
}
function quizResult(scores) {
  let bestKey = 'efes', bestVal = -1;
  Object.keys(BRANDS).forEach(k => {
    const v = scores[k] || 0;
    if (v > bestVal) { bestVal = v; bestKey = k; }
  });
  return BRANDS[bestKey];
}

// --- меню/команды ---
async function setupCommands() {
  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Старт' },
      { command: 'cheers', description: 'Открыть «Чок!»' },
      { command: 'predict', description: 'Открыть «Предсказания»' },
      { command: 'quiz', description: 'Тест: какая ты бутылочка' },
      { command: 'interests', description: 'Подобрать тусовки по интересам' },
      { command: 'help', description: 'Помощь' },
    ]);
  } catch (e) { console.warn('setMyCommands failed:', e.message); }
}
function mainMenu(chatId, user) { return sendWelcome(chatId, user); }

// команды
bot.onText(/\/start/, (msg) => mainMenu(msg.chat.id, msg.from));
bot.onText(/\/cheers/, (msg) => {
  const base = BASE_URL || `http://localhost:${PORT}`;
  const text = `Открываю твою *цифровую бутылочку* 🍺\n\nНажми кнопку ниже — и попадаешь в мини-апп.`;
  bot.sendMessage(msg.chat.id, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🍺 Чок!', web_app: { url: `${base}/app/cheers` } }]] }
  });
});
bot.onText(/\/predict/, (msg) => {
  const base = BASE_URL || `http://localhost:${PORT}`;
  const text = `Готов(а) к магии? ✨\nТапни по бутылке — и предсказание вылетит прямо из горлышка.`;
  bot.sendMessage(msg.chat.id, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🔮 Предсказания', web_app: { url: `${base}/app/predict` } }]] }
  });
});
bot.onText(/\/interests/, (msg) => startInterestsFlow(msg.chat.id));
bot.onText(/\/quiz/, (msg) => startBottleQuiz(msg.chat.id));
bot.onText(/\/help/, (msg) => {
  const text =
`Я — *Пивик*, ассистент Efes 🍻
Что умею:
• Открывать цифровую бутылочку (чоки, баллы, знакомства)
• Бутылочку-предсказания (тексты + озвучка)
• Подбирать тусовки по интересу

Команды:
• /start — главное меню
• /cheers — открыть «Чок!»
• /predict — предсказания
• /interests — подобрать тусовку
• /quiz — тест «какая ты бутылочка»`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// callback-сценарии
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const base = BASE_URL || `http://localhost:${PORT}`;
  const data = q.data || '';
  const userId = q.from?.id;
  bot.answerCallbackQuery(q.id).catch(()=>{});

  // навигация
  if (data === 'back_menu') return mainMenu(chatId, q.from);
  if (data === 'menu_interests') return startInterestsFlow(chatId);

  // интересы
  if (data.startsWith('interests_')) {
    const key = data.split('_')[1];
    return replyInterests(chatId, key);
  }

  // квиз
  if (data === 'quiz_start') {
    const st = { quiz: { index: 0, scores: {} } };
    await setState(userId, st, 3600);
    const q0 = QUIZ[0];
    await bot.sendMessage(chatId, `Вопрос 1/5\n\n*${q0.text}*`, { parse_mode: 'Markdown', reply_markup: questionKeyboard(0) });
    return;
  }
  if (data.startsWith('quiz_')) {
    const [, idxStr, optStr] = data.split('_'); // quiz_<index>_<optIndex>
    const idx = Number(idxStr), optIndex = Number(optStr);
    const st = await getState(userId);
    if (!st.quiz || st.quiz.index !== idx) {
      // рассинхрон — начнём заново
      return startBottleQuiz(chatId);
    }
    // учесть ответ
    const qd = QUIZ[idx];
    const opt = qd.opts[optIndex];
    scoreAdd(st.quiz.scores, opt.score);
    st.quiz.index = idx + 1;
    await setState(userId, st, 3600);

    if (st.quiz.index >= QUIZ.length) {
      const res = quizResult(st.quiz.scores);
      await clearState(userId);
      const text =
`Готово! Твоя бутылочка — *${res.title}* ${res.emoji}

_${res.desc}_

Хочешь ещё? Можем:
• Открыть цифровую бутылочку и чокнуться с кем-то рядом
• Выбрать тусовку по интересу`;
      const kb = {
        inline_keyboard: [
          [{ text: '🍺 Цифровая бутылочка', web_app: { url: `${base}/app/cheers` } }],
          [{ text: '🎉 Найти тусовку', callback_data: 'menu_interests' }],
          [{ text: '↩️ В главное меню', callback_data: 'back_menu' }]
        ]
      };
      return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: kb });
    } else {
      const qn = QUIZ[st.quiz.index];
      return bot.sendMessage(chatId, `Вопрос ${st.quiz.index+1}/${QUIZ.length}\n\n*${qn.text}*`, { parse_mode: 'Markdown', reply_markup: questionKeyboard(st.quiz.index) });
    }
  }

  // прямые переходы на веб-аппы (если когда-то добавим кнопки без web_app)
  if (data === 'menu_cheers') {
    return bot.sendMessage(chatId, 'Открываю цифровую бутылочку:', {
      reply_markup: { inline_keyboard: [[{ text: '🍺 Чок!', web_app: { url: `${base}/app/cheers` } }]] }
    });
  }
  if (data === 'menu_predict') {
    return bot.sendMessage(chatId, 'Открываю бутылочку-предсказания:', {
      reply_markup: { inline_keyboard: [[{ text: '🔮 Предсказания', web_app: { url: `${base}/app/predict` } }]] }
    });
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