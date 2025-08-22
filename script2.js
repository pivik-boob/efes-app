(function () {
  const API_BASE = window.__API_BASE__ || '';
  const BOT_USERNAME = window.__BOT_USERNAME__ || '';

  // --- DOM ---
  const els = {
    username: document.getElementById('username'),
    score: document.getElementById('score'),
    status: document.getElementById('status'),
    partner: document.getElementById('partner'),
    bottle: document.getElementById('bottle'),
    cap: document.getElementById('cap'),
    foam: document.getElementById('foam'),
    shakeBtn: document.getElementById('shakeBtn'),
    openFromBotBtn: document.getElementById('openFromBotBtn'),
    themeSel: document.getElementById('themeSel'),
    sfxBottle: document.getElementById('sfx-bottle'),
    sfxCan: document.getElementById('sfx-can'),
    instaInput: document.getElementById('instaInput'),
    saveInstaBtn: document.getElementById('saveInstaBtn'),
    historyList: document.getElementById('historyList')
  };

  // --- Telegram WebApp detection ---
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const inTelegram = Boolean(tg && tg.initDataUnsafe);

  // ---- per-user keys ----
  const meId = inTelegram && tg.initDataUnsafe?.user?.id ? String(tg.initDataUnsafe.user.id) : 'guest';
  const KEY_SCORE   = `cheers_score_${meId}`;
  const KEY_HISTORY = `cheers_history_${meId}`;

  // --- Instagram helpers ---
  function getInsta(){ return localStorage.getItem('insta') || ''; }
  function saveInsta(nick){
    if (!nick) return;
    const clean = String(nick).trim().replace(/^@/,''); if(!clean) return;
    localStorage.setItem('insta', clean);
    els.status.textContent = 'Instagram сохранён';
    setTimeout(()=>els.status.textContent='Нажми «Чок!» → тряси телефон', 1200);
    if (els.instaInput) els.instaInput.value = '@' + clean;
  }

  // --- История ---
  function loadHistory(){ try{ return JSON.parse(localStorage.getItem(KEY_HISTORY) || '[]'); }catch{return [];} }
  function saveHistory(arr){ try{ localStorage.setItem(KEY_HISTORY, JSON.stringify(arr.slice(-100))); }catch{} }
  function addHistoryItem(partner, dateStr){
    const arr = loadHistory();
    arr.push({ userId: partner.userId||null, username: partner.username||null, insta: partner.insta||null, date: dateStr });
    saveHistory(arr); renderHistory();
  }
  function renderHistory(){
    if (!els.historyList) return;
    const items = loadHistory().slice().reverse();
    els.historyList.innerHTML = items.map(it=>{
      const u = it.username ? '@'+it.username : (it.userId ? `#${it.userId}` : 'гость');
      const inst = it.insta ? ` — insta: @${it.insta}` : '';
      return `<li><span>${it.date}</span> · <strong>${u}</strong>${inst}</li>`;
    }).join('') || `<li style="opacity:.7;">Пока пусто. Нажми «Чок!» и встряхни телефон!</li>`;
  }

  // --- Счёт (persist) ---
  function setScoreUI(n){ els.score.textContent=String(n); try{localStorage.setItem(KEY_SCORE,String(n))}catch{} }
  function getScoreCache(){ const v=localStorage.getItem(KEY_SCORE); return v?Number(v):0; }
  async function loadServerProgress(){
    const user = inTelegram && tg.initDataUnsafe?.user;
    if (!user?.id){ setScoreUI(getScoreCache()); return; }
    try{
      const res = await fetch(`${API_BASE}/progress`,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId:user.id})});
      const data = await res.json().catch(()=>({}));
      if (data?.ok) setScoreUI(Number(data.total||0)); else setScoreUI(getScoreCache());
    }catch{ setScoreUI(getScoreCache()); }
  }

  // --- Header/init ---
  (function init(){
    if (inTelegram){
      try{ tg.ready(); const u=tg.initDataUnsafe?.user; els.username.textContent = u?.first_name?`Привет, ${u.first_name}!`:'Готов к чок 🥂'; }
      catch{ els.username.textContent='Готов к чок 🥂'; }
    } else {
      els.username.textContent='Открой из Telegram 👇';
      if (els.openFromBotBtn && BOT_USERNAME){
        els.openFromBotBtn.style.display='inline-block';
        els.openFromBotBtn.onclick=()=>window.open(`https://t.me/${BOT_USERNAME}?startapp=home`,'_blank');
      }
    }
    // insta
    if (els.instaInput){ const cur=getInsta(); els.instaInput.value = cur?('@'+cur):''; }
    if (els.saveInstaBtn){ els.saveInstaBtn.addEventListener('click', ()=>{ const v=els.instaInput?.value||''; if(v) saveInsta(v); }); }
    // history + score
    renderHistory(); setScoreUI(getScoreCache()); loadServerProgress();
  })();

  // --- Audio unlock (iOS) ---
  let audioUnlocked=false;
  function unlockAudioOnce(){
    if (audioUnlocked) return;
    // ВАЖНО: используем именно bottle_open.mp3
    try{ els.sfxBottle.play().then(()=>els.sfxBottle.pause()).catch(()=>{}); }catch{}
    audioUnlocked=true;
    window.removeEventListener('touchstart', unlockAudioOnce, {passive:true});
    window.removeEventListener('click', unlockAudioOnce);
  }
  window.addEventListener('touchstart', unlockAudioOnce, {passive:true});
  window.addEventListener('click', unlockAudioOnce);

  // --- STATES ---
  let busy=false, lastShakeAt=0, armed=false, armTimer=null;
  const THRESHOLD=14, MIN_INTERVAL=1200, ARM_WINDOW_MS=10000;

  // --- АНИМАЦИЯ “увеличение + тряска” + пена/крышка ---
  function restartClass(el, cls){
    if(!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // reflow
    requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add(cls)));
  }
  // фолбэк на WAAPI для некоторых WebView
  function waapiGrowShake(){
    const b = els.bottle;
    if (!b || !b.animate) return;
    try{
      b.animate(
        [
          { transform:'scale(1.00) rotate(0deg)', filter:'none' },
          { transform:'scale(1.10) rotate(-2deg)' },
          { transform:'scale(1.12) rotate(2deg)' },
          { transform:'scale(1.14) rotate(-2deg)' },
          { transform:'scale(1.20) rotate(2deg)', filter:'drop-shadow(0 6px 14px rgba(255,255,255,0.25))' },
          { transform:'scale(1.08) rotate(1deg)' },
          { transform:'scale(1.00) rotate(0deg)', filter:'none' }
        ],
        { duration: 850, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    }catch{}
  }
  function animateBottleBigShake(){
    restartClass(els.bottle, 'growshake');
    restartClass(els.cap, 'pop');
    restartClass(els.foam, 'spray');
    waapiGrowShake();
  }
  function playBottleSfx(){
    const node = els.sfxBottle; // именно bottle_open.mp3
    try{ node.currentTime=0; node.play().catch(()=>{});}catch{}
  }

  // --- date fmt ---
  function formatDateYMD(d){ const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }

  // --- NETWORK ---
  async function sendShake(){
    const user = inTelegram && tg.initDataUnsafe ? tg.initDataUnsafe.user : null;
    const payload = {
      userId: user?.id || null,
      username: user?.username || null,
      insta: getInsta(),
      clientTs: Date.now(),
      source:'shake',
      device: navigator.userAgent || '',
      initData: inTelegram ? (tg.initData || '') : ''
    };
    try{
      const res = await fetch(`${API_BASE}/shake`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(()=>({}));
      if (data?.ok){
        if (typeof data.total === 'number') setScoreUI(Number(data.total));
        els.status.textContent = data.message || (data.awarded ? 'Чок засчитан!' : 'Ожидаем второго чока...');
        if (data.partner){
          const dateStr = data.date || formatDateYMD(new Date());
          const nick = data.partner.username || data.partner.userId || 'гость';
          const instaTxt = data.partner.insta ? ` (insta: @${data.partner.insta})` : '';
          els.partner.textContent = `Ты чокнулся с @${nick}${instaTxt} · ${dateStr}`;
          addHistoryItem(data.partner, dateStr);
        }
      } else {
        els.status.textContent = (data && data.message) || 'Попробуй ещё раз';
      }
    }catch{
      els.status.textContent='Нет связи. Проверь интернет';
    }
  }

  // --- ARM BY BUTTON ---
  async function armShakeWindow(){
    const Sensor = window.DeviceMotionEvent;
    if (Sensor && typeof Sensor.requestPermission==='function'){
      try{ const p=await Sensor.requestPermission().catch(()=> 'denied'); if(p!=='granted'){ els.status.textContent='Разреши доступ к датчику движения'; return; } }catch{}
    }
    armed=true;
    const origText = els.shakeBtn.textContent;
    els.shakeBtn.textContent='Тряси!';
    els.status.textContent='Готов к чок: встряхни телефон (10 сек)';
    if (navigator.vibrate){ try{ navigator.vibrate([40,40,40]); }catch{} }
    clearTimeout(armTimer);
    armTimer=setTimeout(()=>{ armed=false; els.shakeBtn.textContent=origText; els.status.textContent='Время вышло. Нажми «Чок!» и тряси'; }, ARM_WINDOW_MS);
  }

  // кнопка — только «вооружение» + лёгкий локальный пинг
  if (els.shakeBtn){
    els.shakeBtn.addEventListener('click', ()=>{
      if (busy) return;
      busy=true;
      // маленький намёк-анимация, но БЕЗ передачи
      restartClass(els.bottle, 'growshake');
      setTimeout(()=>busy=false, 350);
      armShakeWindow();
    });
  }

  // --- SHAKE LISTENER (active only when armed) ---
  let lastAccel={x:null,y:null,z:null};
  function onMotion(e){
    if (!armed) return;
    const a=e.accelerationIncludingGravity||e.acceleration||{}; const {x,y,z}=a;
    if([x,y,z].some(v=>typeof v!=='number')) return;
    if(lastAccel.x===null){ lastAccel={x,y,z}; return; }
    const dx=Math.abs(x-lastAccel.x), dy=Math.abs(y-lastAccel.y), dz=Math.abs(z-lastAccel.z);
    lastAccel={x,y,z};
    const magnitude=dx+dy+dz, now=Date.now();
    if (magnitude>14 && (now-lastShakeAt)>1200){
      lastShakeAt=now;
      // ГЛАВНЫЙ эффект чока:
      playBottleSfx();           // звук bottle_open.mp3
      animateBottleBigShake();   // бутылка становится большой и дрожит + пена/крышка
      sendShake();               // и только тут уходим на сервер
      armed=false; clearTimeout(armTimer);
      if (els.shakeBtn) els.shakeBtn.textContent='Чок!';
      if (navigator.vibrate){ try{ navigator.vibrate(40);}catch{} }
    }
  }
  (function enableShake(){ const Sensor=window.DeviceMotionEvent; if(!Sensor) return; try{ window.addEventListener('devicemotion', onMotion, {passive:true}); }catch{} })();

  // --- theme ---
  if (els.themeSel){
    els.themeSel.innerHTML = `<option value="light">Светлая</option><option value="dark">Тёмная</option>`;
    els.themeSel.addEventListener('change', ()=>{ document.documentElement.dataset.theme=els.themeSel.value; });
  }
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) els.status.textContent='Нажми «Чок!» → тряси телефон'; });
})();