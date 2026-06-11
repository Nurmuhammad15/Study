import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { name, login, pass, phone } = req.body;
  const client = await pool.connect();
  try {
    await client.query(
      "INSERT INTO teachers (name, login, pass, phone) VALUES ($1,$2,$3,$4)",
      [name, login, pass, phone]
    );
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  } finally { client.release(); }
}
