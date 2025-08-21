// server.js — бот (webhook) + API мини-аппа + статика без редиректов
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.set('trust proxy', 1);

// ===== ENV =====
const {
  BOT_TOKEN,
  BASE_URL,                         // напр. https://efes-app.onrender.com
  WEBAPP_URL = '',                  // URL фронта (если фронт здесь же — ставь как BASE_URL)
  ALLOWED_ORIGINS = ''              // домены фронта через запятую
} = process.env;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');
if (!BASE_URL)  console.warn('⚠️ BASE_URL is not set — setWebhook may fail');

// ===== Middleware =====
const allowed = ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // Вебвью Телеги может не слать Origin → разрешаем
    if (!origin) return cb(null, true);
    if (allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked for origin: ' + origin));
  },
  credentials: true,
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','X-Telegram-Init-Data']
}));
app.use(express.json({ limit: '1mb' }));

// Раздаём статику из корня проекта (index.html отдадим БЕЗ 301/302)
app.use(express.static(path.join(__dirname), { index: 'index.html' }));

// ===== Health & debug =====
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/', (_req, res) => res.send('OK'));
app.post('/client-log', (req, res) => { console.log('[client-log]', req.body); res.json({ ok:true }); });
app.post('/debug-log',  (req, res) => { console.log('📲 FRONT DEBUG:', JSON.stringify(req.body)); res.json({ ok:true }); });

// ===== In-memory "БД" для MVP =====
const users  = new Map(); // id -> { id, username, contact, points }
const shakes = new Map(); // "minId-maxId" -> { date: 'YYYY-MM-DD' }
const queue  = [];        // ожидание пары на 10 сек: { id, username, contact, t }

const pairKey = (a,b)=> [Math.min(+a,+b), Math.max(+a,+b)].join('-');
const today   = () => new Date().toISOString().slice(0,10);

// ===== API: /shake =====
// Тело: { telegramId, name, contact }
app.post('/shake', (req, res) => {
  try {
    const { telegramId, name, contact } = req.body || {};
    const id = Number(telegramId);
    if (!id) return res.status(400).json({ message: 'Некорректные данные: нет telegramId' });

    const username = (name || '').startsWith('@') ? name.slice(1) : (name || '');
    const u = users.get(id) || { id, username:'', contact:'', points:0 };
    if (username) u.username = username;
    if (contact)  u.contact  = contact;
    users.set(id, u);

    // Окно матчмейкинга 10 сек
    const now = Date.now();
    const cutoff = now - 10_000;
    while (queue.length && queue[0].t < cutoff) queue.shift();

    // Ищем напарника не равного нам
    const idx = queue.findIndex(w => w.id !== id);
    if (idx === -1) {
      queue.push({ id, username: u.username, contact: u.contact, t: now });
      return res.json({ message: 'Ожидаем второго участника…', bonus: 0, waiting: true, points: u.points });
    }

    // Пара найдена
    const p = queue.splice(idx,1)[0];

    // Один раз в сутки
    const key = pairKey(id, p.id);
    if (shakes.get(key)?.date === today()) {
      return res.status(409).json({ message: 'Сегодня уже чокались с этим пользователем', bonus: 0 });
    }

    shakes.set(key, { date: today() });

    // Баллы обоим
    u.points = (u.points || 0) + 1;
    users.set(id, u);
    const v = users.get(p.id) || { id: p.id, username: p.username, contact: p.contact, points:0 };
    v.points = (v.points || 0) + 1;
    users.set(p.id, v);

    // Ответ фронту
    res.json({
      message: '🎉 Чок засчитан!',
      bonus: 1,
      points: u.points,
      youGot: v.username ? '@' + v.username : `id:${v.id}`
    });
  } catch (e) {
    console.error('/shake error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== Telegram Bot (webhook, без polling) =====
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Устанавливаем webhook на наш express-эндпоинт
bot.setWebHook(`${BASE_URL}/bot${BOT_TOKEN}`, { drop_pending_updates: true })
  .then(() => console.log('✅ Webhook set:', `${BASE_URL}/bot${BOT_TOKEN}`))
  .catch(err => console.error('❌ setWebHook error:', err.message));

// Express-эндпоинт для вебхука (ОБЯЗАТЕЛЬНО processUpdate)
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (e) {
    console.error('processUpdate error:', e);
    res.sendStatus(500);
  }
});

// Кнопка в меню чата (внизу слева) — стабильный web_app-вход
const openUrl = WEBAPP_URL || BASE_URL; // запасной вариант — этот же сервер
if (openUrl) {
  bot.setChatMenuButton({
    menu_button: { type: 'web_app', text: 'Efes Card', web_app: { url: openUrl } }
  }).then(()=> console.log('✅ Chat menu web_app:', openUrl))
    .catch(err => console.error('setChatMenuButton error:', err.message));
}

// /start → INLINE web_app-кнопка (надёжнее, чем reply-клавиатура)
bot.onText(/^\/start(?:\s+.*)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ')
              || (msg.from.username ? '@'+msg.from.username : 'друг');

  const kb = {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Открыть мини-апп 🍺', web_app: { url: openUrl } }
      ]]
    }
  };

  try {
    await bot.sendMessage(chatId, `Привет, ${name}! Жми кнопку ниже, чтобы открыть мини-апп.`, kb);
  } catch (e) {
    console.error('/start sendMessage error:', e.message);
  }
});

// Приём данных из мини-аппа (если на фронте используешь tg.sendData({...}))
bot.on('web_app_data', async (msg) => {
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || `user_${userId}`;
  try {
    const payload = JSON.parse(msg.web_app_data?.data || '{}');
    if (!payload.contact) return bot.sendMessage(userId, '❌ Не найден контакт.');

    const entry = users.get(userId) || { id: userId, username, contact: null, points: 0 };
    entry.username = entry.username || username;
    entry.contact  = payload.contact;
    users.set(userId, entry);

    await bot.sendMessage(userId, '✅ Контакт сохранён. Встряхни телефон, чтобы «чокнуться» 🍻');
  } catch (e) {
    console.error('web_app_data parse error:', e.message);
    await bot.sendMessage(userId, '❌ Ошибка обработки данных мини-аппа.');
  }
});

// ===== Start server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🟢 Server listening on http://localhost:${PORT}`);
  console.log(`   Webhook: ${BASE_URL ? `${BASE_URL}/bot${BOT_TOKEN}` : 'BASE_URL not set'}`);
});
