import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS students (
      id serial primary key, name text, phone text, email text,
      login text unique, pass text, created_at timestamptz default now()
    )`);
    const r = await client.query('SELECT id, name, phone, email, login FROM students ORDER BY created_at DESC');
    res.json(r.rows);
  } catch(e) {
    res.json([]);
  } finally { client.release(); }
}
