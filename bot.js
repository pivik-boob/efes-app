// bot.js
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token); // Убираем polling

bot.setWebHook(`${process.env.BASE_URL}/bot${token}`);

// Временное хранилище для пользователей, которые "чокнулись"
const waitingUsers = []; // [{ id, username, contact }]

// Хранилище бонусов (в памяти)
const users = {}; // user_id: { bonuses: 0, contacts: [] }

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, '🍺 Добро пожаловать в Efes Club! Открой свою карту:', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🎉 Открыть карточку',
          web_app: {
            url: 'https://efes-app.vercel.app/' // ссылка на твою мини-аппу
          }
        }
      ]]
    }
  });
});

// Обработка данных из Web App (встряска и отправка контакта)
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

  // Добавляем пользователя в очередь
  waitingUsers.push(user);

  // Ищем пару
  if (waitingUsers.length >= 2) {
    const [first, second] = waitingUsers.splice(0, 2);

    // Обновляем хранилище
    if (!users[first.id]) users[first.id] = { bonuses: 0, contacts: [] };
    if (!users[second.id]) users[second.id] = { bonuses: 0, contacts: [] };

    // Обмен контактами
    if (!users[first.id].contacts.includes(second.contact)) {
      users[first.id].contacts.push(second.contact);
      users[first.id].bonuses += 1;
    }

    if (!users[second.id].contacts.includes(first.contact)) {
      users[second.id].contacts.push(first.contact);
      users[second.id].bonuses += 1;
    }

    // Отправляем обоим уведомление
    bot.sendMessage(first.id, `🎉 Вы успешно чокнулись с @${second.username}!\n💰 Ваши бонусы: ${users[first.id].bonuses}`);
    bot.sendMessage(second.id, `🎉 Вы успешно чокнулись с @${first.username}!\n💰 Ваши бонусы: ${users[second.id].bonuses}`);
  } else {
    // Если пока один — ждём второго
    bot.sendMessage(userId, '⏳ Ожидаем второго участника для чока...');
  }
});