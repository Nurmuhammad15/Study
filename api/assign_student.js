import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function sanitize(str, max = 100) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>'"`;]/g, '').trim().slice(0, max);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Login, X-User-Role');
  res.setHeader('X-Content-Type-Options', 'nosniff');
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
      const tl = sanitize(req.body?.teacher_login || '', 100);
      const sl = sanitize(req.body?.student_login || '', 100);
      if (!tl || !sl) { res.json({ ok: false, msg: 'Parametrlar kerak' }); return; }

      await client.query(
        'INSERT INTO teacher_students (teacher_login, student_login) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [tl, sl]
      );
      // Auto-create chat
      await client.query(`
        CREATE TABLE IF NOT EXISTS chats (
          id serial primary key, teacher_login text NOT NULL,
          student_login text NOT NULL, created_at timestamptz default now(),
          UNIQUE(teacher_login, student_login)
        )
      `);
      await client.query(
        'INSERT INTO chats (teacher_login, student_login) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [tl, sl]
      );
      res.json({ ok: true });

    } else if (req.method === 'DELETE') {
      const tl = sanitize(req.body?.teacher_login || '', 100);
      const sl = sanitize(req.body?.student_login || '', 100);
      if (!tl || !sl) { res.json({ ok: false }); return; }
      await client.query('DELETE FROM teacher_students WHERE teacher_login=$1 AND student_login=$2', [tl, sl]);
      res.json({ ok: true });

    } else {
      const sl = sanitize(req.query?.student_login || '', 100);
      const tl = sanitize(req.query?.teacher_login || '', 100);
      if (sl) {
        const r = await client.query(`
          SELECT t.name, t.login, t.phone, t.email
          FROM teacher_students ts JOIN teachers t ON t.login=ts.teacher_login
          WHERE ts.student_login=$1`, [sl]);
        res.json(r.rows);
      } else if (tl) {
        const r = await client.query(`
          SELECT s.name, s.login, s.phone, s.email
          FROM teacher_students ts JOIN students s ON s.login=ts.student_login
          WHERE ts.teacher_login=$1`, [tl]);
        res.json(r.rows);
      } else {
        res.json([]);
      }
    }
  } catch(e) {
    res.status(500).json({ ok: false, msg: 'Server xatosi' });
  } finally { client.release(); }
}
