require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new TelegramBot(process.env.BOT_TOKEN);
bot.setWebHook(`${process.env.BASE_URL}/bot${process.env.BOT_TOKEN}`);

app.use(cors());
app.use(bodyParser.json());

// Telegram webhook endpoint
app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// == Хранилище ==
const users = new Map(); // telegramId -> { name, contact, points }
const shakes = new Map(); // "id1-id2" -> date

function generatePairKey(id1, id2) {
  return [Math.min(id1, id2), Math.max(id1, id2)].join("-");
}

function alreadyShakenToday(id1, id2) {
  const key = generatePairKey(id1, id2);
  const lastDate = shakes.get(key);
  const today = new Date().toISOString().slice(0, 10);
  return lastDate === today;
}

// == /shake endpoint для фронта ==
app.post('/shake', (req, res) => {
  const { telegramId, name, contact } = req.body;

  if (!telegramId || !name || !contact) {
    return res.status(400).json({ message: 'Некорректные данные' });
  }

  if (!users.has(telegramId)) {
    users.set(telegramId, { name, contact, points: 0 });
  }

  let matchedUser = null;
  for (let [id, user] of users.entries()) {
    if (id !== telegramId && !alreadyShakenToday(telegramId, id)) {
      matchedUser = { id, ...user };
      break;
    }
  }

  if (matchedUser) {
    const key = generatePairKey(telegramId, matchedUser.id);
    shakes.set(key, new Date().toISOString().slice(0, 10));

    users.get(telegramId).points += 1;
    users.get(matchedUser.id).points += 1;

    return res.json({
      message: "🎉 Чок засчитан!",
      bonus: 1,
      youGot: matchedUser.name
    });
  } else {
    return res.json({
      message: "Ожидание второго участника или уже чокнулись сегодня",
      bonus: 0
    });
  }
});

// == Бот: /start ==
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, '🍺 Добро пожаловать в Efes Club! Открой свою карту:', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🎉 Открыть карточку',
          web_app: {
            url: 'https://efes-app.vercel.app/' // твой фронт
          }
        }
      ]]
    }
  });
});

// == Бот: обработка данных из Web App ==
bot.on('web_app_data', (msg) => {
  const userId = msg.from.id;
  const username = msg.from.username || `user_${userId}`;
  let data = {};

  try {
    data = JSON.parse(msg.web_app_data.data);
  } catch (e) {
    return bot.sendMessage(userId, '❌ Ошибка при обработке данных.');
  }

  if (!data.contact) return;

  const user = {
    id: userId,
    username,
    contact: data.contact
  };

  // Добавим в users, чтобы их могли найти в API /shake тоже
  if (!users.has(userId)) {
    users.set(userId, { name: username, contact: user.contact, points: 0 });
  }

  bot.sendMessage(userId, '✅ Контакт получен! Теперь встряхни, чтобы чокнуться 🍻');
});

app.listen(PORT, () => {
  console.log(`🟢 Бэк слушает на http://localhost:${PORT}`);
});