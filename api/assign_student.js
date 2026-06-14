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
      CREATE TABLE IF NOT EXISTS teacher_students (
        id serial primary key,
        teacher_login text,
        student_login text,
        created_at timestamptz default now(),
        UNIQUE(teacher_login, student_login)
      )
    `);

    if (req.method === 'POST') {
      const { teacher_login, student_login } = req.body;
      await client.query(
        'INSERT INTO teacher_students (teacher_login, student_login) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [teacher_login, student_login]
      );
      res.json({ ok: true });

    } else if (req.method === 'DELETE') {
      const { teacher_login, student_login } = req.body;
      await client.query(
        'DELETE FROM teacher_students WHERE teacher_login=$1 AND student_login=$2',
        [teacher_login, student_login]
      );
      res.json({ ok: true });

    } else {
      // GET o'quvchiga biriktirilgan ustozni topish
      const { student_login, teacher_login } = req.query;
      if (student_login) {
        // O'quvchining ustozlari
        const r = await client.query(`
          SELECT t.name, t.login, t.phone, t.email
          FROM teacher_students ts
          JOIN teachers t ON t.login = ts.teacher_login
          WHERE ts.student_login=$1
        `, [student_login]);
        res.json(r.rows);
      } else if (teacher_login) {
        // Ustoz ning o'quvchilari
        const r = await client.query(`
          SELECT s.name, s.login, s.phone, s.email
          FROM teacher_students ts
          JOIN students s ON s.login = ts.student_login
          WHERE ts.teacher_login=$1
        `, [teacher_login]);
        res.json(r.rows);
      } else {
        res.json([]);
      }
    }
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  } finally { client.release(); }
}
