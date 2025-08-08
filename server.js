// server.js — единая точка входа (бот + API мини-аппа)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// ==== ENV ====
const BOT_TOKEN  = process.env.BOT_TOKEN;
const BASE_URL   = process.env.BASE_URL;   // например: https://efes-app.onrender.com  (без / на конце)
const WEBAPP_URL = process.env.WEBAPP_URL; // например: https://efes-app.vercel.app    (без / на конце)

if (!BOT_TOKEN)  throw new Error('BOT_TOKEN is required');
if (!BASE_URL)   console.warn('⚠️ BASE_URL is not set — setWebhook may fail');
if (!WEBAPP_URL) console.warn('⚠️ WEBAPP_URL is not set — open-app button will be hidden');

// ==== Middlewares ====
app.use(cors({ origin: true }));
app.use(express.json());

// ==== Telegram Bot (webhook, no polling) ====
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

// Переустанавливаем вебхук с drop_pending_updates (чтоб не накапливал старые апдейты)
bot.setWebHook(`${BASE_URL}/bot${BOT_TOKEN}`, { drop_pending_updates: true })
  .then(() => console.log('✅ Webhook set to', `${BASE_URL}/bot${BOT_TOKEN}`))
  .catch(err => console.error('❌ setWebHook error:', err));

// Глобальная кнопка в меню бота (видна даже без /start)
if (WEBAPP_URL) {
  bot.setChatMenuButton({
    menu_button: {
      type: 'web_app',
      text: 'Открыть мини-апп 🍺',
      web_app: { url: WEBAPP_URL }
    }
  }).catch(err => console.error('setChatMenuButton error:', err));
}

// Эндпоинт вебхука: обязательно bot.processUpdate(...)
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (e) {
    console.error('processUpdate error:', e);
    res.sendStatus(500);
  }
});

// ==== Health ====
app.get('/', (_req, res) => res.send('OK'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ==== Временный лог с фронта для диагностики (можно удалить после стабилизации) ====
app.post('/debug-log', (req, res) => {
  console.log('📲 FRONT DEBUG:', JSON.stringify(req.body));
  res.sendStatus(200);
});

// ==== ПАМЯТЬ (in-memory) ====
const users  = new Map(); // telegramId -> { name, contact, points }
const shakes = new Map(); // "id1-id2" -> "YYYY-MM-DD"

const pairKey = (a, b) => [Math.min(+a, +b), Math.max(+a, +b)].join('-');
const todayStr = () => new Date().toISOString().slice(0, 10);
const alreadyShakenToday = (id1, id2) => shakes.get(pairKey(id1, id2)) === todayStr();

// ==== /shake — API для мини-аппа ====
app.post('/shake', (req, res) => {
  try {
    const { telegramId, name, contact } = req.body || {};
    if (!telegramId || !name || !contact) {
      return res.status(400).json({ message: 'Некорректные данные' });
    }

    if (!users.has(telegramId)) {
      users.set(telegramId, { name, contact, points: 0 });
    }

    // Находим первого доступного собеседника, с кем ещё не "чокались" сегодня
    let matched = null;
    for (const [id, u] of users.entries()) {
      if (String(id) !== String(telegramId) && !alreadyShakenToday(telegramId, id)) {
        matched = { id, ...u };
        break;
      }
    }

    if (!matched) {
      return res.json({
        message: 'Ожидание второго участника или уже чокнулись сегодня',
        bonus: 0
      });
    }

    // Фиксируем дату "чока"
    shakes.set(pairKey(telegramId, matched.id), todayStr());

    // Начисляем баллы
    users.get(telegramId).points += 1;
    users.get(matched.id).points += 1;

    return res.json({
      message: '🎉 Чок засчитан!',
      bonus: 1,
      youGot: matched.name
    });
  } catch (e) {
    console.error('/shake error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==== Бот: /start (надёжный регекс + web_app-кнопка) ====
bot.onText(/^\/start(?:\s+.*)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    if (WEBAPP_URL) {
      await bot.sendMessage(chatId, 'Открой мини-апп:', {
        reply_markup: {
          keyboard: [[{ text: 'Открыть мини-апп 🍺', web_app: { url: WEBAPP_URL } }]],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      });
    } else {
      await bot.sendMessage(chatId, 'Мини-апп готов. Добавь WEBAPP_URL в переменные окружения, чтобы появилась кнопка.');
    }
  } catch (e) {
    console.error('sendMessage /start error:', e);
  }
});

// ==== Бот: данные из WebApp (если используешь sendData) ====
bot.on('web_app_data', async (msg) => {
  const userId   = msg.from.id;
  const username = msg.from.username || msg.from.first_name || `user_${userId}`;
  try {
    const payload = JSON.parse(msg.web_app_data?.data || '{}');

    if (!payload.contact) {
      return bot.sendMessage(userId, '❌ Не найден контакт для сохранения.');
    }

    const entry = users.get(userId) || { name: username, contact: null, points: 0 };
    entry.name    = entry.name || username;
    entry.contact = payload.contact;
    users.set(userId, entry);

    await bot.sendMessage(userId, '✅ Контакт получен! Теперь встряхни, чтобы чокнуться 🍻');
  } catch (e) {
    console.error('web_app_data parse error:', e);
    await bot.sendMessage(userId, '❌ Ошибка при обработке данных мини-аппа.');
  }
});

// ==== Start server ====
app.listen(PORT, () => {
  console.log(`🟢 Server listening on http://localhost:${PORT}`);
  console.log(`   Webhook: ${BASE_URL ? `${BASE_URL}/bot${BOT_TOKEN}` : 'BASE_URL not set'}`);
});