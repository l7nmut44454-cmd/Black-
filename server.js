'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const { DATABASE_URL, ADMIN_USER, ADMIN_PASSWORD, JWT_SECRET } = process.env;
if (!DATABASE_URL || !ADMIN_USER || !ADMIN_PASSWORD || !JWT_SECRET) {
  console.error('متغيرات البيئة ناقصة: DATABASE_URL, ADMIN_USER, ADMIN_PASSWORD, JWT_SECRET');
  process.exit(1);
}
if (JWT_SECRET.length < 32) { console.error('JWT_SECRET لازم يكون 32 حرف على الأقل'); process.exit(1); }

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS people (
      id BIGSERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS people_created_idx ON people (created_at DESC);
  `);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// ---------- أدوات مساعدة ----------
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const COOKIE = 'admin_session';

function requireAdmin(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[COOKIE] || '', JWT_SECRET);
    if (payload.role !== 'admin') throw new Error();
    next();
  } catch {
    res.status(401).json({ error: 'غير مصرح لك. سجّل الدخول أولًا.' });
  }
}

// ---------- التسجيل العام (إضافة فقط، لا يعرض أي بيانات) ----------
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'محاولات كثيرة. حاول مرة أخرى بعد قليل.' }
});

app.post('/api/register', registerLimiter, async (req, res) => {
  const body = req.body || {};
  const full_name = String(body.full_name || '').trim().replace(/\s+/g, ' ');
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim().toLowerCase();

  if (full_name.length < 3 || full_name.length > 100)
    return res.status(400).json({ error: 'اكتب الاسم بالكامل (من 3 إلى 100 حرف).' });
  if (!/^\+?[0-9\s\-]{7,20}$/.test(phone) || phone.replace(/\D/g, '').length < 7)
    return res.status(400).json({ error: 'رقم الهاتف غير صحيح.' });
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح.' });

  try {
    await pool.query('INSERT INTO people (full_name, phone, email) VALUES ($1,$2,$3)', [full_name, phone, email]);
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'حدث خطأ أثناء الحفظ. حاول مرة أخرى.' });
  }
});

// ---------- دخول الأدمن ----------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
  message: { error: 'محاولات دخول كثيرة. حاول بعد 15 دقيقة.' }
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const ok = safeEqual(username || '', ADMIN_USER) & safeEqual(password || '', ADMIN_PASSWORD);
  if (!ok) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000, path: '/'
  });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

// ---------- لوحة التحكم ----------
app.get('/api/admin/people', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const limit = 50;
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const params = [];
  let where = '';
  if (q) {
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const digits = q.replace(/\D/g, '');
    params.push(like);
    where = 'WHERE full_name ILIKE $1';
    if (digits.length >= 3) {
      params.push('%' + digits + '%');
      where += " OR regexp_replace(phone, '\\D', '', 'g') LIKE $2";
    } else {
      where += ' OR phone ILIKE $1';
    }
  }
  try {
    const total = await pool.query(`SELECT count(*)::int AS n FROM people ${where}`, params);
    const rows = await pool.query(
      `SELECT id, full_name, phone, email, created_at FROM people ${where}
       ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ total: total.rows[0].n, rows: rows.rows, hasMore: offset + rows.rows.length < total.rows[0].n });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'تعذّر تحميل البيانات.' });
  }
});

app.delete('/api/admin/people/:id', requireAdmin, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'معرّف غير صحيح.' });
  try {
    const r = await pool.query('DELETE FROM people WHERE id = $1', [req.params.id]);
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'تعذّر الحذف.' });
  }
});

// ---------- الملفات الثابتة ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ error: 'غير موجود' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log('الموقع يعمل على المنفذ ' + PORT)))
  .catch((e) => { console.error('فشل الاتصال بقاعدة البيانات:', e.message); process.exit(1); });
