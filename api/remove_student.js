import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function sanitize(str, max = 100) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>'"`;]/g, '').trim().slice(0, max);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Login, X-User-Role');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }

  // Auth check
  const teacherLogin = sanitize(req.headers['x-user-login'] || '', 100);
  const userRole     = req.headers['x-user-role'] || '';
  if (!teacherLogin || userRole !== 'teacher') {
    res.status(403).json({ ok: false, msg: 'Faqat ustoz uchun' }); return;
  }

  const { student_login, confirm } = req.body;
  const sl = sanitize(student_login || '', 100);

  if (!sl) { res.json({ ok: false, msg: 'Student login kerak' }); return; }
  if (confirm !== true) { res.json({ ok: false, msg: 'Tasdiqlash kerak' }); return; }

  const client = await pool.connect();
  try {
    // Remove from teacher_students
    const r = await client.query(
      'DELETE FROM teacher_students WHERE teacher_login=$1 AND student_login=$2 RETURNING id',
      [teacherLogin, sl]
    );
    if (!r.rows.length) {
      res.json({ ok: false, msg: 'O\'quvchi topilmadi' }); return;
    }
    // Remove chat between them
    await client.query(
      'DELETE FROM chats WHERE teacher_login=$1 AND student_login=$2',
      [teacherLogin, sl]
    );
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, msg: 'Server xatosi' });
  } finally { client.release(); }
}
