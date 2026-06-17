import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function sanitize(str, max = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, max);
}
function isValidLogin(s) { return /^[a-zA-Z0-9_]{3,50}$/.test(s); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const name  = sanitize(req.body?.name  || '', 100);
  const login = sanitize(req.body?.login || '', 50);
  const pass  = sanitize(req.body?.pass  || '', 200);
  const phone = sanitize(req.body?.phone || '', 20);
  const email = sanitize(req.body?.email || '', 200);

  if (!name || !login || !pass) { res.json({ ok: false, msg: 'Maydonlar to\'liq emas' }); return; }
  if (!isValidLogin(login)) { res.json({ ok: false, msg: 'Login faqat harf, raqam va _ (3-50 belgi)' }); return; }
  if (pass.length < 4) { res.json({ ok: false, msg: 'Parol kamida 4 ta belgi' }); return; }

  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email text DEFAULT ''`);
    const dup = await client.query(
      `SELECT login FROM teachers WHERE login=$1 UNION SELECT login FROM students WHERE login=$1 LIMIT 1`, [login]
    );
    if (dup.rows.length > 0) { res.json({ ok: false, msg: 'Bu login band!' }); return; }
    await client.query(
      'INSERT INTO teachers (name, login, pass, phone, email) VALUES ($1,$2,$3,$4,$5)',
      [name, login, pass, phone, email]
    );
    const r = await client.query('SELECT id, name, login, phone, email FROM teachers WHERE login=$1', [login]);
    res.json({ ok: true, teacher: r.rows[0] });
  } catch(e) {
    res.status(500).json({ ok: false, msg: 'Server xatosi' });
  } finally { client.release(); }
}
