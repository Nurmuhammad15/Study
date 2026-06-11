import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const client = await pool.connect();
  try {
    const r = await client.query("SELECT name, login, pass, phone FROM teachers");
    res.json(r.rows);
  } finally { client.release(); }
}
