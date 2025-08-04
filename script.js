const tg = window.Telegram.WebApp;
const user = tg.initDataUnsafe.user;
tg.expand();

document.getElementById("username").innerText = user.first_name;

// Слушаем встряску
window.addEventListener("devicemotion", (e) => {
  const acc = e.accelerationIncludingGravity;
  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  if (total > 35) {
    sendBump();
  }
});

// Альтернативная кнопка (на всякий случай)
function manualBump() {
  sendBump();
}

// Отправляем данные “чока” на сервер
function sendBump() {
  fetch("https://your-backend.com/bump", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: user.id,
      name: user.first_name,
      username: user.username
    })
  })
    .then(res => res.json())
    .then(data => {
      document.getElementById("points").innerText = data.points;
      alert("Вы чокнулись с " + data.partner + " 🍻");
    });
}