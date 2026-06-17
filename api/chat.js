import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Rate limiting (in-memory, per IP)
const rateLimitMap = new Map();
function rateLimit(ip, limit = 30, windowMs = 60000) {
  const now = Date.now();
  const key = ip;
  if (!rateLimitMap.has(key)) rateLimitMap.set(key, []);
  const hits = rateLimitMap.get(key).filter(t => now - t < windowMs);
  hits.push(now);
  rateLimitMap.set(key, hits);
  return hits.length > limit;
}

// Input sanitization
function sanitize(str, maxLen = 1000) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

export default async function handler(req, res) {
  // Security headers
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Login, X-User-Role');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Rate limiting
  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (rateLimit(ip, 60, 60000)) {
    res.status(429).json({ ok: false, msg: 'Juda ko\'p so\'rov. Bir daqiqa kuting.' });
    return;
  }

  // Auth header check
  const userLogin = sanitize(req.headers['x-user-login'] || '', 100);
  const userRole  = req.headers['x-user-role'] || '';
  if (!userLogin) { res.status(401).json({ ok: false, msg: 'Autentifikatsiya talab qilinadi' }); return; }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id serial primary key,
        teacher_login text NOT NULL,
        student_login text NOT NULL,
        created_at timestamptz default now(),
        UNIQUE(teacher_login, student_login)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id serial primary key,
        chat_id integer REFERENCES chats(id) ON DELETE CASCADE,
        sender_login text NOT NULL,
        sender_role text NOT NULL CHECK(sender_role IN ('teacher','student')),
        content text NOT NULL CHECK(char_length(content) <= 2000),
        is_read boolean DEFAULT false,
        created_at timestamptz default now()
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
    `);

    if (req.method === 'GET') {
      const { action, chat_id, teacher_login, student_login } = req.query;

      if (action === 'list') {
        // Ustoz uchun barcha chatlari
        if (userRole !== 'teacher') { res.json([]); return; }
        if (userLogin !== sanitize(teacher_login || '', 100)) {
          res.status(403).json({ ok: false, msg: 'Ruxsat yo\'q' }); return;
        }
        const r = await client.query(`
          SELECT c.id, c.student_login, s.name as student_name,
            (SELECT content FROM messages WHERE chat_id=c.id ORDER BY created_at DESC LIMIT 1) as last_msg,
            (SELECT created_at FROM messages WHERE chat_id=c.id ORDER BY created_at DESC LIMIT 1) as last_time,
            (SELECT COUNT(*) FROM messages WHERE chat_id=c.id AND is_read=false AND sender_role='student') as unread
          FROM chats c
          LEFT JOIN students s ON s.login = c.student_login
          WHERE c.teacher_login=$1
          ORDER BY last_time DESC NULLS LAST
        `, [userLogin]);
        res.json(r.rows);
        return;
      }

      if (action === 'messages') {
        const cid = parseInt(chat_id);
        if (!cid) { res.json([]); return; }

        // Verify access
        const access = await client.query(
          'SELECT id FROM chats WHERE id=$1 AND (teacher_login=$2 OR student_login=$2)',
          [cid, userLogin]
        );
        if (!access.rows.length) { res.status(403).json({ ok: false, msg: 'Ruxsat yo\'q' }); return; }

        // Mark as read
        const readRole = userRole === 'teacher' ? 'student' : 'teacher';
        await client.query(
          'UPDATE messages SET is_read=true WHERE chat_id=$1 AND sender_role=$2 AND is_read=false',
          [cid, readRole]
        );

        const r = await client.query(
          'SELECT id, sender_login, sender_role, content, is_read, created_at FROM messages WHERE chat_id=$1 ORDER BY created_at ASC LIMIT 200',
          [cid]
        );
        res.json(r.rows);
        return;
      }

      if (action === 'student_chat') {
        // O'quvchi o'z chatini oladi
        if (!sanitize(teacher_login || '', 100)) { res.json(null); return; }
        const r = await client.query(
          'SELECT id FROM chats WHERE teacher_login=$1 AND student_login=$2',
          [sanitize(teacher_login, 100), userLogin]
        );
        if (!r.rows.length) { res.json(null); return; }

        const cid = r.rows[0].id;
        await client.query(
          'UPDATE messages SET is_read=true WHERE chat_id=$1 AND sender_role=$2 AND is_read=false',
          [cid, 'teacher']
        );
        const msgs = await client.query(
          'SELECT id, sender_login, sender_role, content, is_read, created_at FROM messages WHERE chat_id=$1 ORDER BY created_at ASC LIMIT 200',
          [cid]
        );
        res.json({ chat_id: cid, messages: msgs.rows });
        return;
      }

      if (action === 'unread_count') {
        // Ustozning o'qilmagan xabarlari soni
        if (userRole !== 'teacher') { res.json({ count: 0 }); return; }
        const r = await client.query(`
          SELECT COUNT(*) as count FROM messages m
          JOIN chats c ON c.id = m.chat_id
          WHERE c.teacher_login=$1 AND m.is_read=false AND m.sender_role='student'
        `, [userLogin]);
        res.json({ count: parseInt(r.rows[0].count) });
        return;
      }
      res.json([]);

    } else if (req.method === 'POST') {
      const { action, chat_id, content, teacher_login, student_login } = req.body;

      if (action === 'create') {
        // Chat yaratish (ustoz o'quvchi qo'shganda avtomatik)
        if (userRole !== 'teacher') { res.status(403).json({ ok: false, msg: 'Faqat ustoz uchun' }); return; }
        const tl = sanitize(teacher_login || userLogin, 100);
        const sl = sanitize(student_login || '', 100);
        if (!sl) { res.json({ ok: false, msg: 'Student login kerak' }); return; }

        // Verify student exists
        const scheck = await client.query('SELECT login FROM students WHERE login=$1', [sl]);
        if (!scheck.rows.length) { res.json({ ok: false, msg: 'Bunday o\'quvchi topilmadi' }); return; }

        const r = await client.query(`
          INSERT INTO chats (teacher_login, student_login)
          VALUES ($1,$2)
          ON CONFLICT (teacher_login, student_login) DO UPDATE SET teacher_login=EXCLUDED.teacher_login
          RETURNING id
        `, [tl, sl]);
        res.json({ ok: true, chat_id: r.rows[0].id });
        return;
      }

      if (action === 'send') {
        const cid = parseInt(chat_id);
        const text = sanitize(content || '', 2000);
        if (!cid || !text) { res.json({ ok: false, msg: 'Xabar bo\'sh bo\'lmasin' }); return; }

        // Verify access
        const access = await client.query(
          'SELECT id FROM chats WHERE id=$1 AND (teacher_login=$2 OR student_login=$2)',
          [cid, userLogin]
        );
        if (!access.rows.length) { res.status(403).json({ ok: false, msg: 'Ruxsat yo\'q' }); return; }

        // Rate limit messages (10 per minute per user)
        if (rateLimit(userLogin + '_msg', 10, 60000)) {
          res.status(429).json({ ok: false, msg: 'Juda tez yuboryapsiz' }); return;
        }

        await client.query(
          'INSERT INTO messages (chat_id, sender_login, sender_role, content) VALUES ($1,$2,$3,$4)',
          [cid, userLogin, userRole, text]
        );
        res.json({ ok: true });
        return;
      }
      res.json({ ok: false, msg: 'Noma\'lum action' });
    }
  } catch(e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ ok: false, msg: 'Server xatosi' });
  } finally { client.release(); }
}
