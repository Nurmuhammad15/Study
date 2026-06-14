import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM teacher_students');
    await client.query('DELETE FROM live_sessions');
    await client.query('DELETE FROM teachers');
    await client.query('DELETE FROM students');
    res.json({ ok: true, msg: 'Hammasi o\'chirildi: teachers, students, teacher_students, live_sessions' });
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  } finally { client.release(); }
}
