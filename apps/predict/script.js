(function () {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  const bottle     = document.getElementById('bottle');
  const bubble     = document.getElementById('bubble');
  const s1         = document.getElementById('spark1');
  const s2         = document.getElementById('spark2');
  const s3         = document.getElementById('spark3');
  const againBtn   = document.getElementById('againBtn');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const audioEl    = document.getElementById('fortune-audio');

  const SOURCE = Array.isArray(window.PREDICTIONS) ? window.PREDICTIONS.slice() : [];
  if (SOURCE.length === 0) bubble.textContent = 'Добавь предсказания в predictions.js';

  // ---- Разблокировка аудио на iOS/Telegram WebView ----
  let audioUnlocked = false;
  function unlockAudioOnce() {
    if (audioUnlocked) return;
    try {
      audioEl.src = SOURCE[0]?.audio || '';
      audioEl.play().then(() => { audioEl.pause(); audioUnlocked = true; }).catch(()=>{});
    } catch {}
    audioUnlocked = true;
    window.removeEventListener('touchstart', unlockAudioOnce, { passive: true });
    window.removeEventListener('click', unlockAudioOnce);
  }
  window.addEventListener('touchstart', unlockAudioOnce, { passive: true });
  window.addEventListener('click', unlockAudioOnce);

  // ---- Перемешивание без повторов ----
  let bag = []; let lastIndex = -1;
  function refillBag() {
    bag = SOURCE.map((_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  refillBag();
  function nextIndex() {
    if (bag.length === 0) refillBag();
    let idx = bag.pop();
    if (SOURCE.length > 1 && idx === lastIndex && bag.length) {
      const swap = bag[bag.length - 1];
      bag[bag.length - 1] = idx; idx = swap;
    }
    lastIndex = idx;
    return idx;
  }

  // ---- Хаптика/вибрация ----
  function haptic() {
    if (navigator.vibrate) { try { navigator.vibrate(25); } catch {} }
    if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.impactOccurred('medium'); } catch {} }
  }

  // ---- Анимации: бутылка, пузырёк, искорки ----
  function wobbleBottle() {
    bottle.classList.remove('wobble');
    void bottle.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => bottle.classList.add('wobble')));
  }
  function popBubble() {
    bubble.classList.remove('show');
    void bubble.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => bubble.classList.add('show')));
  }
  function fizz() {
    [s1, s2, s3].forEach(el => {
      el.classList.remove('show');
      void el.offsetWidth;
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    });
  }

  // ---- Показ предсказания + звук ----
  function showPrediction() {
    if (SOURCE.length === 0) return;
    const idx = nextIndex();
    const item = SOURCE[idx];

    bubble.textContent = item.text || 'Предсказание ✨';

    // Анимации: пузырёк из горлышка + искорки + дрожь бутылки
    popBubble();
    fizz();
    wobbleBottle();
    haptic();

    // Звук
    try {
      audioEl.src = item.audio || '';
      audioEl.currentTime = 0;
      audioEl.play().catch(()=>{});
    } catch {}
  }

  // ---- События ----
  bottle.addEventListener('click', showPrediction);
  againBtn.addEventListener('click', showPrediction);
  shuffleBtn.addEventListener('click', () => {
    refillBag();
    bubble.textContent = 'Перемешали. Готово к новому предсказанию ✨';
    popBubble(); haptic();
  });

  try { tg?.ready(); } catch {}
})();