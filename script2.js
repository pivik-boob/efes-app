(function () {
  const API_BASE = 'https://efes-app.onrender.com'; // твой backend на Render (только HTTPS!)

  let telegramUser = null;
  let score = 0;
  let hasShaken = false;
  let lastShakeTime = 0;
  const shakeThreshold = 15;     // можешь подстроить (12–18)
  const minShakeInterval = 1500; // антидребезг

  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

    if (!tg) {
      $('status') && ( $('status').textContent = 'Откройте мини-апп внутри Telegram (через бота).' );
      console.warn('Telegram.WebApp не найден');
      return;
    }

    // Правильная инициализация на мобильных
    tg.ready();
    tg.expand();

    // Получаем пользователя только после ready()
    telegramUser = tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
    if (!telegramUser || !telegramUser.id) {
      $('status') && ( $('status').textContent = 'Нет данных пользователя. Откройте мини-апп из бота.' );
      console.warn('initDataUnsafe.user пуст — вероятно, запуск не из бота');
      return;
    }

    // Отображение имени
    if ($('username')) {
      $('username').textContent =
        telegramUser.first_name || telegramUser.username || `user_${telegramUser.id}`;
    }

    // ===== iOS: запрашиваем доступ к датчикам ТОЛЬКО по клику =====
    async function ensureMotionPermission() {
      if (typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function') {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          $('status') && ( $('status').textContent = 'Разрешите доступ к датчикам движения.' );
          throw new Error('Motion permission denied');
        }
      }
    }

    // ===== Отправка контакта (ВЫЗЫВАЕТСЯ ТОЛЬКО ИЗ ВСТРЯСКИ) =====
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
          contact: contact,
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
              $('partner') && ( $('partner').textContent = `чок с ${data.youGot}` );
              score += (data.bonus || 0);
              $('score') && ( $('score').textContent = `Баллы: ${score}` );
            }

            hasShaken = false;
            if (bottle) bottle.classList.remove('shake');
          })
          .catch((err) => {
            console.error('Ошибка:', err);
            $('status') && ( $('status').textContent = 'Ошибка соединения' );
            hasShaken = false;
            if (bottle) bottle.classList.remove('shake');
          });
      }, 1500); // задержка перед отправкой — как в твоей версии
    }

    // ===== Детектор встряски (ТОЛЬКО он запускает sendContact) =====
    window.addEventListener('devicemotion', (event) => {
      const acc = event.accelerationIncludingGravity || event.acceleration;
      const now = Date.now();
      if (!acc) return;

      const total = Math.sqrt(
        (acc.x || 0) * (acc.x || 0) +
        (acc.y || 0) * (acc.y || 0) +
        (acc.z || 0) * (acc.z || 0)
      );

      if (total > shakeThreshold && now - lastShakeTime > minShakeInterval) {
        lastShakeTime = now;
        sendContact(); // контакты меняются только после реальной встряски
      }
    });

    // ===== Кнопка "Чок!" — только запрос разрешения (не отправляет контакт) =====
    const btn = $('shakeBtn');
    if (btn) {
      btn.addEventListener('click', async () => {
        try {
          await ensureMotionPermission();
          $('status') && ( $('status').textContent = 'Готово! Теперь встряхните телефон вместе.' );
        } catch {
          // подсказку уже показали в ensureMotionPermission
        }
      });
    }
  });
})();