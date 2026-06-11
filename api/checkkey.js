import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const key = req.query.key || '';
  if (!key) { res.json({ ok: false }); return; }

  const client = await pool.connect();
  try {
    const r = await client.query("SELECT id FROM keys WHERE key=$1 AND used=false", [key]);
    if (r.rows.length === 0) { res.json({ ok: false }); return; }
    await client.query("UPDATE keys SET used=true WHERE key=$1", [key]);
    res.json({ ok: true });
  } finally { client.release(); }
}
