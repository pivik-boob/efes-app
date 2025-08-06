let telegramUser = null;
let score = 0;
let hasShaken = false;
let lastShakeTime = 0;
const shakeThreshold = 15;

Telegram.WebApp.ready();
telegramUser = Telegram.WebApp.initDataUnsafe.user;

// Отображение имени
if (telegramUser) {
  document.getElementById("username").textContent = telegramUser.first_name;
}

// Функция отправки данных на сервер
function sendContact() {
  if (hasShaken) return;
  hasShaken = true;

  // Анимация бутылки
  const bottle = document.getElementById("bottle");
  if (bottle) bottle.classList.add("shake");

  // Через 1.5 сек отправка данных
  setTimeout(() => {
    const contact = prompt("Введите ваш Telegram или Instagram:");
    if (!contact) {
      alert("Контакт не введён.");
      hasShaken = false;
      return;
    }

    const userData = {
      telegramId: telegramUser.id,
      name: telegramUser.first_name,
      contact: contact,
      points: 1
    };

    fetch("http://localhost:3000/shake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData)
    })
      .then(res => res.json())
      .then(data => {
        document.getElementById("status").textContent = data.message;

        if (data.youGot) {
          document.getElementById("partner").textContent = `Ты чокнулся с ${data.youGot}`;
          score += data.bonus;
          document.getElementById("score").textContent = `Баллы: ${score}`;
        }

        hasShaken = false;
        if (bottle) bottle.classList.remove("shake");
      })
      .catch(err => {
        console.error("Ошибка:", err);
        document.getElementById("status").textContent = "Ошибка соединения";
        hasShaken = false;
      });
  }, 1500);
}

// Обработка встряски
window.addEventListener("devicemotion", function(event) {
  const acc = event.accelerationIncludingGravity;
  const now = Date.now();

  if (!acc) return;

  const total = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
  if (total > shakeThreshold && now - lastShakeTime > 1500) {
    lastShakeTime = now;
    sendContact();
  }
});

// Кнопка "Чокнуться"
document.getElementById("shakeBtn").addEventListener("click", () => {
  sendContact();
});