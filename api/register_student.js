import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { name, phone, email, login, pass } = req.body;
  if (!name || !login || !pass) { res.json({ ok: false, msg: 'Maydonlar to\'liq emas' }); return; }

  const client = await pool.connect();
  try {
    // Check login unique across both tables
    const dup = await client.query(
      `SELECT login FROM teachers WHERE login=$1
       UNION SELECT login FROM students WHERE login=$1`, [login]
    );
    if (dup.rows.length > 0) { res.json({ ok: false, msg: 'Bu login band!' }); return; }

    await client.query(
      `CREATE TABLE IF NOT EXISTS students (
        id serial primary key, name text, phone text, email text,
        login text unique, pass text, created_at timestamptz default now()
      )`
    );
    await client.query(
      'INSERT INTO students (name, phone, email, login, pass) VALUES ($1,$2,$3,$4,$5)',
      [name, phone || '', email || '', login, pass]
    );
    const r = await client.query('SELECT * FROM students WHERE login=$1', [login]);
    res.json({ ok: true, student: r.rows[0] });
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  } finally { client.release(); }
}
