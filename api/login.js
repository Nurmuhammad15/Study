import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { login, pass } = req.body;
  if (!login || !pass) { res.json({ ok: false, msg: 'Login va parol kerak' }); return; }

  const client = await pool.connect();
  try {
    // Try teacher
    const tr = await client.query(
      'SELECT id, name, phone, email, login FROM teachers WHERE login=$1 AND pass=$2',
      [login, pass]
    );
    if (tr.rows.length > 0) {
      res.json({ ok: true, role: 'teacher', user: tr.rows[0] }); return;
    }
    // Try student
    await client.query(`CREATE TABLE IF NOT EXISTS students (
      id serial primary key, name text, phone text, email text,
      login text unique, pass text, created_at timestamptz default now()
    )`);
    const sr = await client.query(
      'SELECT id, name, phone, email, login FROM students WHERE login=$1 AND pass=$2',
      [login, pass]
    );
    if (sr.rows.length > 0) {
      res.json({ ok: true, role: 'student', user: sr.rows[0] }); return;
    }
    res.json({ ok: false, msg: 'Login yoki parol noto\'g\'ri' });
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  } finally { client.release(); }
}
