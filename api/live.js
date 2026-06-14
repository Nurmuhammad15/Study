import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS live_sessions (
        id serial primary key,
        teacher_login text unique,
        teacher_name text,
        room_id text,
        title text,
        started_at timestamptz default now()
      )
    `);

    if (req.method === 'POST') {
      // Ustoz dars boshladi
      const { teacher_login, teacher_name, room_id, title } = req.body;
      await client.query(`
        INSERT INTO live_sessions (teacher_login, teacher_name, room_id, title)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (teacher_login) DO UPDATE
        SET room_id=$3, title=$4, started_at=now()
      `, [teacher_login, teacher_name, room_id, title || 'Jonli dars']);
      res.json({ ok: true });

    } else if (req.method === 'DELETE') {
      // Ustoz darsni tugatdi
      const { teacher_login } = req.body;
      await client.query('DELETE FROM live_sessions WHERE teacher_login=$1', [teacher_login]);
      res.json({ ok: true });

    } else {
      // GET — barcha jonli darslar yoki o'quvchi uchun o'z ustozi
      const { teacher_login } = req.query;
      let r;
      if (teacher_login) {
        r = await client.query(
          'SELECT * FROM live_sessions WHERE teacher_login=$1', [teacher_login]
        );
      } else {
        r = await client.query('SELECT * FROM live_sessions ORDER BY started_at DESC');
      }
      res.json(r.rows);
    }
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  } finally { client.release(); }
}
