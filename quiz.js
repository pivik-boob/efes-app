// quiz.js — MBTI-подобный квиз → 3 бутылочки: classic / fest / ornament
const API = window.__API_BASE__ || '';
const tg = window.Telegram?.WebApp;
tg && tg.ready();
const TG_INIT_DATA = tg?.initData || '';

function getUid() {
  const fromTG = tg?.initDataUnsafe?.user?.id;
  if (fromTG) return String(fromTG);
  const q = new URLSearchParams(location.search);
  return q.get('uid') || 'debug-user-quiz';
}
const UID = getUid();

async function postJSON(url, body) {
  const r = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ ...body, tgInitData: TG_INIT_DATA })
  });
  if (!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}

// Собираем ответы и считаем оси
function getMBTIScores() {
  // оси: E/I, S/N, T/F, J/P
  const axes = { E:0, I:0, S:0, N:0, T:0, F:0, J:0, P:0 };
  for (let i=1;i<=8;i++) {
    const el = document.querySelector(`input[name="q${i}"]:checked`);
    if (!el) return null;
    const v = el.value; // одна буква
    axes[v] += 1;
  }
  return axes;
}

// Маппинг осей в 3 «бутылки»
// - КЛАССИЧЕСКАЯ (classic): I + S + J преобладают (практичная, стабильная)
// - ПРАЗДНИЧНАЯ (fest): E + F + P преобладают (социальная, спонтанная, тёплая)
// - КРЕАТИВНАЯ (ornament): N выражено (и чаще P), любит новое/яркое
function decideBottle(axes) {
  const classicScore = (axes.I) + (axes.S) + (axes.J);
  const festScore    = (axes.E) + (axes.F) + (axes.P);
  const ornScore     = (axes.N) + Math.max(axes.E, axes.I) * 0.3 + axes.P * 0.5;

  // выберем максимум
  const arr = [
    ['classic', classicScore],
    ['fest', festScore],
    ['ornament', ornScore],
  ].sort((a,b)=>b[1]-a[1]);

  return arr[0][0]; // 'classic' | 'fest' | 'ornament'
}

document.getElementById('finishBtn').addEventListener('click', async () => {
  const axes = getMBTIScores();
  if (!axes) return alert('Ответь на все 8 вопросов 🙂');

  const design = decideBottle(axes);
  const pretty = { classic:'Классическая', fest:'Праздничная', ornament:'Креативная' }[design];

  try {
    await postJSON(`${API}/api/save_design`, { uid: UID, design });
    const res = document.getElementById('result');
    res.innerHTML = `Твой результат: <b>${pretty}</b> бутылочка. Дизайн сохранён в профиле ✔`;
    setTimeout(()=> location.href = '/', 1300);
  } catch (e) {
    console.error(e);
    alert('Не получилось сохранить. Попробуй ещё раз.');
  }
});

