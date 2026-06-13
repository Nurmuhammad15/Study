import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { name, login, pass, phone, email } = req.body;
  if (!name || !login || !pass) { res.json({ ok: false, msg: 'Maydonlar to\'liq emas' }); return; }

  const client = await pool.connect();
  try {
    // Add email column if not exists
    await client.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email text DEFAULT ''`);

    // Check duplicate login across both tables
    const dup = await client.query(
      `SELECT login FROM teachers WHERE login=$1
       UNION SELECT login FROM students WHERE login=$1 LIMIT 1`, [login]
    );
    if (dup.rows.length > 0) { res.json({ ok: false, msg: 'Bu login band!' }); return; }

    await client.query(
      'INSERT INTO teachers (name, login, pass, phone, email) VALUES ($1,$2,$3,$4,$5)',
      [name, login, pass, phone || '', email || '']
    );
    const r = await client.query('SELECT id, name, login, phone, email FROM teachers WHERE login=$1', [login]);
    res.json({ ok: true, teacher: r.rows[0] });
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  } finally { client.release(); }
}
