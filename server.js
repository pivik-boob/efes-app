require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const { createHmac } = require('crypto');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// ==== ENV
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || '';         // напр. https://efes-app.onrender.com
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''; // подпись WebApp
const REDIS_URL = process.env.REDIS_URL || '';           // опционально
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

// ==== Prisma
const prisma = new PrismaClient();

// ==== Redis (опционально)
let redis = null;

if (process.env.REDIS_URL) {
  try {
    const Redis = require("ioredis");
    redis = new Redis(process.env.REDIS_URL, {
      tls: process.env.REDIS_URL.startsWith("rediss://") ? {} : undefined,
    });

    redis.on("connect", () => console.log("Redis: CONNECTED"));
    redis.on("error", (err) => console.error("Redis error:", err));
  } catch (err) {
    console.warn("Redis init failed, fallback to in-memory:", err.message);
    redis = null;
  }
} else {
  console.log("Redis: DISABLED (no REDIS_URL)");
}
const MATCH_WINDOW_MS = 2000;

// ==== In-memory fallback для матчинга (локально)
const pendingLocal = []; // [{uid, ts}]
function localFindMatch(uid, ts) {
  const i = pendingLocal.findIndex(s => s.uid !== uid && Math.abs(s.ts - ts) <= MATCH_WINDOW_MS);
  if (i === -1) return null;
  const partner = pendingLocal[i].uid;
  pendingLocal.splice(i, 1);
  return partner;
}
function localAdd(uid, ts) {
  pendingLocal.push({ uid, ts });
  setTimeout(() => {
    const j = pendingLocal.findIndex(s => s.uid === uid && s.ts === ts);
    if (j >= 0) pendingLocal.splice(j, 1);
  }, 5000);
}

// ==== App
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: (origin, cb) => {
    if (!ALLOWED_ORIGINS.length) return cb(null, true);
    if (!origin) return cb(null, true);
    cb(null, ALLOWED_ORIGINS.includes(origin));
  }
}));
app.use('/api', rateLimit({ windowMs: 30_000, max: 120 }));

// Статика
app.use(express.static(path.join(__dirname)));

// ==== Utils
function dayStartUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function normPairKey(a, b) {
  a = String(a); b = String(b);
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
function checkTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN) return true;  // локально подпись можно не проверять
  if (!initData) return false;
  const usp = new URLSearchParams(initData);
  const hash = usp.get('hash');
  if (!hash) return false;
  const arr = [];
  usp.forEach((v, k) => { if (k !== 'hash') arr.push(`${k}=${v}`); });
  arr.sort();
  const dataCheckString = arr.join('\n');
  const secretKey = require('crypto').createHmac('sha256', 'WebAppData')
    .update(TELEGRAM_BOT_TOKEN).digest();
  const calc = require('crypto').createHmac('sha256', secretKey)
    .update(dataCheckString).digest('hex');
  return calc === hash;
}

// ==== Schemas
const ProfileSaveSchema = z.object({
  uid: z.string().min(1),
  name: z.string().min(1),
  age: z.coerce.number().int().min(16).max(120),
  mood: z.string().min(1),
  contact: z.string().min(1),
  tgInitData: z.string().optional()
});
const SaveDesignSchema = z.object({
  uid: z.string().min(1),
  design: z.string().min(1),
  tgInitData: z.string().optional()
});
const ShakeSchema = z.object({
  uid: z.string().min(1),
  ts: z.coerce.number().int().optional(),
  tgInitData: z.string().optional()
});
const GiftCreateSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  message: z.string().optional(),
  tgInitData: z.string().optional()
});

// ==== Health
app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    if (redis) await redis.ping();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// ==== Profile
app.get('/api/profile', async (req, res, next) => {
  try {
    const uid = String(req.query.uid || '');
    if (!uid) return res.json({ exists: false, profile: null });
    const p = await prisma.profile.findUnique({ where: { userId: uid } });
    res.json({ exists: !!p, profile: p || null });
  } catch (e) { next(e); }
});

app.post('/api/profile/save', async (req, res, next) => {
  try {
    const b = ProfileSaveSchema.parse(req.body);
    if (!checkTelegramInitData(b.tgInitData)) {
      return res.status(401).json({ ok: false, error: 'bad signature' });
    }
    await prisma.profile.upsert({
      where: { userId: b.uid },
      update: { name: b.name, age: b.age, mood: b.mood, contact: b.contact },
      create: { userId: b.uid, name: b.name, age: b.age, mood: b.mood, contact: b.contact }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/save_design', async (req, res, next) => {
  try {
    const b = SaveDesignSchema.parse(req.body);
    if (!checkTelegramInitData(b.tgInitData)) {
      return res.status(401).json({ ok: false, error: 'bad signature' });
    }
    await prisma.profile.upsert({
      where: { userId: b.uid },
      update: { design: b.design },
      create: { userId: b.uid, name: '', age: 18, mood: '', contact: '', design: b.design }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ==== Shake match (Redis или локальный фоллбэк)
async function redisFindMatch(uid, ts) {
  const min = ts - MATCH_WINDOW_MS, max = ts + MATCH_WINDOW_MS;
  // используем zset efes:pending
  const key = 'efes:pending';
  const candidates = await redis.zrangebyscore(key, min, max, 'LIMIT', 0, 30);
  const partner = candidates.find(x => x !== uid);
  if (!partner) return null;
  const tx = redis.multi();
  tx.zrem(key, uid);
  tx.zrem(key, partner);
  const results = await tx.exec();
  if (!results || results[0][1] === 0 || results[1][1] === 0) return null;
  return partner;
}
async function redisAdd(uid, ts) {
  const key = 'efes:pending';
  await redis.zadd(key, ts, uid);
  await redis.expire(key, 15);
}

app.post('/api/shake', async (req, res, next) => {
  try {
    const b = ShakeSchema.parse(req.body);
    if (!checkTelegramInitData(b.tgInitData)) {
      return res.status(401).json({ status: 'error', error: 'bad signature' });
    }
    const ts = b.ts || Date.now();

    let partnerId = null;
    if (redis) {
      partnerId = await redisFindMatch(b.uid, ts);
      if (!partnerId) { await redisAdd(b.uid, ts); return res.json({ status: 'waiting' }); }
    } else {
      partnerId = localFindMatch(b.uid, ts);
      if (!partnerId) { localAdd(b.uid, ts); return res.json({ status: 'waiting' }); }
    }

    const pairKey = normPairKey(b.uid, partnerId);
    const dayKey = dayStartUTC(new Date(ts));
    await prisma.meeting.upsert({
      where: { pairKey_dayKey: { pairKey, dayKey } },
      update: {},
      create: { userAId: String(b.uid), userBId: String(partnerId), pairKey, dayKey }
    });

    const you = await prisma.profile.findUnique({ where: { userId: String(b.uid) } });
    const other = await prisma.profile.findUnique({ where: { userId: String(partnerId) } });
    res.json({ status: 'matched', you, other, partner_id: String(partnerId) });
  } catch (e) { next(e); }
});

// ==== Friends today
app.get('/api/friends/today', async (req, res, next) => {
  try {
    const uid = String(req.query.uid || '');
    const dayKey = dayStartUTC(new Date());
    const rows = await prisma.meeting.findMany({
      where: { dayKey },
      select: { userAId: true, userBId: true }
    });
    const ids = new Set();
    rows.forEach(m => { if (m.userAId === uid) ids.add(m.userBId); if (m.userBId === uid) ids.add(m.userAId); });
    const list = await prisma.profile.findMany({ where: { userId: { in: [...ids] } } });
    res.json({ list: list.map(p => ({ user_id: p.userId, profile: p })) });
  } catch (e) { next(e); }
});

// ==== Gifts
app.post('/api/gift/create', async (req, res, next) => {
  try {
    const b = GiftCreateSchema.parse(req.body);
    if (!checkTelegramInitData(b.tgInitData)) {
      return res.status(401).json({ ok: false, error: 'bad signature' });
    }
    const voucher = 'EFES-' + uuidv4().slice(0, 8).toUpperCase();

    // ensure profiles
    await prisma.profile.upsert({ where: { userId: String(b.from) }, update: {}, create: { userId: String(b.from), name: '', age: 18, mood: '', contact: '' }});
    await prisma.profile.upsert({ where: { userId: String(b.to) },   update: {}, create: { userId: String(b.to),   name: '', age: 18, mood: '', contact: '' }});

    await prisma.giftCode.create({
      data: { voucher, fromUserId: String(b.from), toUserId: String(b.to), message: b.message || null }
    });

    const targetUrl = PUBLIC_URL ? `${PUBLIC_URL}/gift/${voucher}` : `voucher:${voucher}`;
    const qr = await QRCode.toDataURL(targetUrl);
    res.json({ ok: true, voucher, qr, targetUrl });
  } catch (e) { next(e); }
});

app.get('/gift/:voucher', async (req, res, next) => {
  try {
    const v = req.params.voucher;
    const g = await prisma.giftCode.findUnique({ where: { voucher: v } });
    if (!g) return res.status(404).send('Voucher not found');
    res.send(`
      <html><body style="font-family:Arial">
        <h2>Проверка подарка</h2>
        <p><b>Код:</b> ${v}</p>
        <p><b>От:</b> ${g.fromUserId}</p>
        <p><b>Кому:</b> ${g.toUserId}</p>
        <p><b>Сообщение:</b> ${g.message ?? '—'}</p>
        <p><b>Статус:</b> ${g.redeemed ? 'УЖЕ ПОГАШЕН' : 'НЕ ИСПОЛЬЗОВАН'}</p>
        <form method="POST" action="/api/gift/redeem" onsubmit="return confirm('Погасить?')">
          <input type="hidden" name="voucher" value="${v}"/>
          <button type="submit" ${g.redeemed ? 'disabled' : ''}>Погасить</button>
        </form>
      </body></html>
    `);
  } catch (e) { next(e); }
});

app.post('/api/gift/redeem', async (req, res, next) => {
  try {
    const voucher = req.body?.voucher || req.query?.voucher;
    if (!voucher) return res.status(400).send('No voucher');
    const g = await prisma.giftCode.findUnique({ where: { voucher } });
    if (!g) return res.status(404).send('Voucher not found');
    if (g.redeemed) return res.send('Уже погашен');
    await prisma.giftCode.update({ where: { voucher }, data: { redeemed: true } });
    res.send('Успешно: пиво выдано ✅');
  } catch (e) { next(e); }
});

// SPA fallback
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  if (err?.name === 'ZodError') return res.status(400).json({ ok:false, error:'invalid_input', details: err.errors });
  res.status(500).json({ ok:false, error:'server_error' });
});

app.listen(PORT, () => {
  console.log('Efes app listening on :' + PORT);
  if (!PUBLIC_URL) console.log('TIP: set PUBLIC_URL for QR links.');
  console.log(REDIS_URL ? 'Redis: ENABLED' : 'Redis: fallback (local)');
});