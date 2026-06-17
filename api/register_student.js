import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const regAttempts = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const list = (regAttempts.get(ip) || []).filter(t => now - t < 3600000); // 1 hour
  list.push(now);
  regAttempts.set(ip, list);
  return list.length > 5; // max 5 registrations per hour per IP
}

function sanitize(str, max = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, max);
}
function isValidLogin(s) { return /^[a-zA-Z0-9_]{3,50}$/.test(s); }
function isValidEmail(s) { return !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
  if (rateLimit(ip)) {
    res.status(429).json({ ok: false, msg: 'Juda ko\'p ro\'yxatdan o\'tish. 1 soat kuting.' });
    return;
  }

  const name  = sanitize(req.body?.name  || '', 100);
  const phone = sanitize(req.body?.phone || '', 20);
  const email = sanitize(req.body?.email || '', 200);
  const login = sanitize(req.body?.login || '', 50);
  const pass  = sanitize(req.body?.pass  || '', 200);

  if (!name || !login || !pass) { res.json({ ok: false, msg: 'Ism, login va parol majburiy' }); return; }
  if (!isValidLogin(login)) { res.json({ ok: false, msg: 'Login faqat harf, raqam va _ bo\'lishi mumkin (3-50 belgi)' }); return; }
  if (pass.length < 4) { res.json({ ok: false, msg: 'Parol kamida 4 ta belgi' }); return; }
  if (!isValidEmail(email)) { res.json({ ok: false, msg: 'Email formati noto\'g\'ri' }); return; }

  const client = await pool.connect();
  try {
    const dup = await client.query(
      `SELECT login FROM teachers WHERE login=$1 UNION SELECT login FROM students WHERE login=$1`, [login]
    );
    if (dup.rows.length > 0) { res.json({ ok: false, msg: 'Bu login band!' }); return; }

    await client.query(
      `INSERT INTO students (name, phone, email, login, pass) VALUES ($1,$2,$3,$4,$5)`,
      [name, phone, email, login, pass]
    );
    const r = await client.query('SELECT id, name, login, phone, email FROM students WHERE login=$1', [login]);
    res.json({ ok: true, student: r.rows[0] });
  } catch(e) {
    res.status(500).json({ ok: false, msg: 'Server xatosi' });
  } finally { client.release(); }
}
