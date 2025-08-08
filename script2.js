// script2.js — фикс получения user на мобилках + чок только по встряске
// В index.html ДО этого файла должен быть SDK:
// <script src="https://telegram.org/js/telegram-web-app.js"></script>

(function () {
  const API_BASE = 'https://efes-app.onrender.com'; // твой backend (HTTPS!)

  let telegramUser = null;
  let score = 0;
  let hasShaken = false;
  let lastShakeTime = 0;
  const shakeThreshold = 15;
  const minShakeInterval = 1500;

  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

    if (!tg) {
      $('status') && ($('status').textContent = 'Откройте мини-апп внутри Telegram (через бота).');
      console.warn('Telegram.WebApp не найден');
      return;
    }

    tg.ready();
    tg.expand();
// ---------- ЖЕЛЕЗОБЕТОННЫЙ способ получить user ----------
function parseUserJson(maybeJson) {
  try { return JSON.parse(maybeJson); } catch { /* not JSON */ }
  // бывает двойное кодирование
  try { return JSON.parse(decodeURIComponent(maybeJson)); } catch { /* no-op */ }
  return null;
}

function getTGUser() {
  // 1) нормальный путь
  if (tg.initDataUnsafe?.user) return tg.initDataUnsafe.user;

  // 2) fallback: tg.initData (строка "k=v&k2=v2")
  if (tg.initData) {
    try {
      const p = new URLSearchParams(tg.initData);
      const u = p.get('user');
      const parsed = u && parseUserJson(u);
      if (parsed?.id) return parsed;
    } catch {}
  }

  // 3) запасной: tgWebAppData в hash (#tgWebAppData=...)
  if (location.hash) {
    try {
      const hash = new URLSearchParams(location.hash.slice(1));
      const tgData = hash.get('tgWebAppData');
      if (tgData) {
        const params = new URLSearchParams(tgData);
        const u = params.get('user');
        const parsed = u && parseUserJson(u);
        if (parsed?.id) return parsed;
      }
    } catch {}
  }

  // 4) ещё один запасной: tgWebAppData может быть в query (?tgWebAppData=...)
  if (location.search) {
    try {
      const qs = new URLSearchParams(location.search);
      const tgData = qs.get('tgWebAppData');
      if (tgData) {
        const params = new URLSearchParams(tgData);
        const u = params.get('user');
        const parsed = u && parseUserJson(u);
        if (parsed?.id) return parsed;
      }
    } catch {}
  }

  return null;
}
// ----------------------------------------------------------

telegramUser = getTGUser();

if (!telegramUser || !telegramUser.id) {
  $('status') && ($('status').textContent = 'Нет данных пользователя. Откройте мини-апп из бота.');
  console.warn('initData пуст. initDataLen=', (tg.initData||'').length, 'hash=', location.hash, 'search=', location.search);
  return;
}

// Имя на карточке
if ($('username')) {
  const name = telegramUser.first_name || telegramUser.username || `user_${telegramUser.id}`;
  $('username').textContent = `${name}  #${telegramUser.id}`; // ← вернули показ ID
}



    // ===== iOS: разрешение на датчики ТОЛЬКО по клику =====
    async function ensureMotionPermission() {
      if (typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function') {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          $('status') && ($('status').textContent = 'Разрешите доступ к датчикам движения.');
          throw new Error('Motion permission denied');
        }
      }
    }

    // ===== Отправка контакта (ТОЛЬКО из встряски) =====
    function sendContact() {
      if (hasShaken) return;
      hasShaken = true;

      const bottle = $('bottle');
      if (bottle) bottle.classList.add('shake');

      setTimeout(() => {
        const contact = prompt('Введите ваш Telegram или Instagram:');
        if (!contact) {
          alert('Контакт не введён.');
          hasShaken = false;
          if (bottle) bottle.classList.remove('shake');
          return;
        }

        const userData = {
          telegramId: telegramUser.id,
          name: telegramUser.first_name || telegramUser.username || `user_${telegramUser.id}`,
          contact,
          points: 1
        };

        fetch(`${API_BASE}/shake`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userData)
        })
          .then((res) => res.json())
          .then((data) => {
            if ($('status')) $('status').textContent = data.message || 'OK';

            if (data.youGot) {
              $('partner') && ($('partner').textContent = `чок с ${data.youGot}`);
              score += (data.bonus || 0);
              $('score') && ($('score').textContent = `Баллы: ${score}`);
            }
          })
          .catch((err) => {
            console.error('Ошибка:', err);
            $('status') && ($('status').textContent = 'Ошибка соединения');
          })
          .finally(() => {
            hasShaken = false;
            if (bottle) bottle.classList.remove('shake');
          });
      }, 1500);
    }

    // ===== Детектор встряски (он один вызывает sendContact) =====
    window.addEventListener('devicemotion', (event) => {
      const acc = event.accelerationIncludingGravity || event.acceleration;
      const now = Date.now();
      if (!acc) return;

      const total = Math.sqrt(
        (acc.x || 0) ** 2 +
        (acc.y || 0) ** 2 +
        (acc.z || 0) ** 2
      );

      if (total > shakeThreshold && now - lastShakeTime > minShakeInterval) {
        lastShakeTime = now;
        sendContact(); // обмен только после реальной встряски
      }
    });

    // ===== Кнопка "Чок!" — только запрос прав (не отправляет контакт) =====
    const btn = $('shakeBtn');
    if (btn) {
      btn.addEventListener('click', async () => {
        try {
          await ensureMotionPermission();
          $('status') && ($('status').textContent = 'Готово! Теперь встряхните телефоны вместе.');
        } catch {
          // подсказку уже показали
        }
      });
    }
  });
})();