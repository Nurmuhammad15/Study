import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Rate limiting
const attempts = new Map();
function isBlocked(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter(t => now - t < 15 * 60000); // 15 min window
  attempts.set(ip, list);
  return list.length >= 10; // 10 attempts per 15 min
}
function recordAttempt(ip) {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
  attempts.set(ip, list);
}

function sanitize(str, max = 100) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, max);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
  if (isBlocked(ip)) {
    res.status(429).json({ ok: false, msg: 'Juda ko\'p urinish. 15 daqiqa kuting.' });
    return;
  }

  const login = sanitize(req.body?.login || '', 100);
  const pass  = sanitize(req.body?.pass  || '', 200);
  if (!login || !pass) {
    res.status(400).json({ ok: false, msg: 'Login va parol kerak' }); return;
  }

  const client = await pool.connect();
  try {
    const tr = await client.query(
      'SELECT id, name, phone, email, login FROM teachers WHERE login=$1 AND pass=$2',
      [login, pass]
    );
    if (tr.rows.length > 0) {
      res.json({ ok: true, role: 'teacher', user: tr.rows[0] }); return;
    }
    const sr = await client.query(
      'SELECT id, name, phone, email, login FROM students WHERE login=$1 AND pass=$2',
      [login, pass]
    );
    if (sr.rows.length > 0) {
      res.json({ ok: true, role: 'student', user: sr.rows[0] }); return;
    }
    recordAttempt(ip);
    res.json({ ok: false, msg: 'Login yoki parol noto\'g\'ri' });
  } catch(e) {
    res.status(500).json({ ok: false, msg: 'Server xatosi' });
  } finally { client.release(); }
}
