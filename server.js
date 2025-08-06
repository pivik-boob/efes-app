const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

let shakePool = [];

app.post('/shake', (req, res) => {
  const user = req.body;
  console.log('ПОЛУЧЕН ЧОК ОТ:', user);

  shakePool.push(user);

  if (shakePool.length >= 2) {
    const [user1, user2] = shakePool.splice(0, 2);

    console.log(`Обмен: ${user1.contact} <-> ${user2.contact}`);

    res.json({
      message: 'Успешный чок!',
      youGot: user2.contact,
      bonus: 1,
    });
  } else {
    res.json({ message: 'Ждём второго участника...' });
  }
});

app.listen(PORT, () => {
  console.log(`🟢 Бэк слушает на http://localhost:${PORT}`);
});