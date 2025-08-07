require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// Хранилище чоков
const users = new Map(); // по telegramId
const shakes = new Map(); // ключ: userId-userId, значение: дата чока

// Генерация ключа пары (всегда одинаковый порядок)
function generatePairKey(id1, id2) {
  return [Math.min(id1, id2), Math.max(id1, id2)].join("-");
}

// Проверка, был ли чок сегодня
function alreadyShakenToday(id1, id2) {
  const key = generatePairKey(id1, id2);
  const lastDate = shakes.get(key);
  const today = new Date().toISOString().slice(0, 10);
  return lastDate === today;
}

app.post('/shake', (req, res) => {
  const { telegramId, name, contact } = req.body;

  if (!telegramId || !name || !contact) {
    return res.status(400).json({ message: 'Некорректные данные' });
  }

  // Сохраняем пользователя
  if (!users.has(telegramId)) {
    users.set(telegramId, { name, contact, points: 0 });
  }

  // Пытаемся найти с кем чокнуться
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

app.listen(PORT, () => {
  console.log(`🟢 Бэк слушает на http://localhost:3000`);
});