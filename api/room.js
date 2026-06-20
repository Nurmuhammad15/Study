/**
 * Room management API
 * POST /api/room/create  — bot yaratadi (ADMIN_SECRET kerak)
 * GET  /api/room/info    — room ma'lumotlari (room_token kerak)
 * POST /api/room/join    — o'quvchi room_token bilan kiradi
 */
import pkg from 'pg';
const { Pool } = pkg;
import { signRoomToken, verifyRoomToken, generateRoomId, verifyAdminSecret } from './auth.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SITE_URL = process.env.SITE_URL || 'https://study-zeta-neon.vercel.app';

function sanitize(str, max = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, max);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Room-Token, X-Admin-Secret');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // URL dan action olish
  const action = req.query.action || '';
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id text primary key,
        title text NOT NULL,
        teacher_name text NOT NULL,
        teacher_token text NOT NULL,
        scheduled_at timestamptz,
        is_active boolean DEFAULT false,
        peer_room_id text,
        created_at timestamptz DEFAULT now(),
        expires_at timestamptz DEFAULT now() + interval '24 hours'
      );
      CREATE TABLE IF NOT EXISTS room_participants (
        id serial primary key,
        room_id text REFERENCES rooms(id) ON DELETE CASCADE,
        peer_id text NOT NULL,
        name text,
        role text CHECK(role IN ('teacher','student')),
        joined_at timestamptz DEFAULT now(),
        last_seen timestamptz DEFAULT now(),
        UNIQUE(room_id, peer_id)
      );
    `);

    // ── BOT: Yangi dars xonasi yaratish ──────────────────────
    if (action === 'create' && req.method === 'POST') {
      if (!verifyAdminSecret(req)) {
        res.status(403).json({ ok: false, msg: 'Admin ruxsati kerak' }); return;
      }
      const title        = sanitize(req.body?.title        || 'Yangi dars', 200);
      const teacher_name = sanitize(req.body?.teacher_name || 'Ustoz', 100);
      const scheduled_at = req.body?.scheduled_at || null;

      const room_id    = generateRoomId();
      const peer_room  = 'peer-' + room_id;

      // Ustoz token (24 soat)
      const teacherToken = signRoomToken({
        room_id, role: 'teacher', name: teacher_name, iat: Date.now()
      });

      await client.query(
        `INSERT INTO rooms (id, title, teacher_name, teacher_token, scheduled_at, peer_room_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [room_id, title, teacher_name, teacherToken, scheduled_at, peer_room]
      );

      // O'quvchi havola uchun token (har bir o'quvchi bir xil havola ishlatadi)
      const studentToken = signRoomToken({
        room_id, role: 'student', name: 'O\'quvchi', iat: Date.now()
      });

      const teacherUrl = `${SITE_URL}/?t=${teacherToken}`;
      const studentUrl = `${SITE_URL}/?s=${studentToken}`;

      res.json({
        ok: true,
        room_id,
        title,
        teacher_url: teacherUrl,
        student_url: studentUrl,
        peer_room_id: peer_room,
        expires_in: '24 soat'
      });
      return;
    }

    // ── Xona ma'lumotlari olish ───────────────────────────────
    if (action === 'info' && req.method === 'GET') {
      const token = req.headers['x-room-token'] || req.query.token || '';
      const user  = verifyRoomToken(token);
      if (!user) {
        res.status(401).json({ ok: false, msg: 'Havola noto\'g\'ri yoki muddati o\'tgan' }); return;
      }

      const r = await client.query(
        'SELECT id, title, teacher_name, peer_room_id, is_active, scheduled_at FROM rooms WHERE id=$1 AND expires_at > now()',
        [user.room_id]
      );
      if (!r.rows.length) {
        res.status(404).json({ ok: false, msg: 'Dars xonasi topilmadi yoki muddati o\'tgan' }); return;
      }
      res.json({ ok: true, room: r.rows[0], user: { role: user.role, name: user.name } });
      return;
    }

    // ── Ishtirokchi qo'shish / heartbeat ─────────────────────
    if (action === 'join' && req.method === 'POST') {
      const token = req.headers['x-room-token'] || '';
      const user  = verifyRoomToken(token);
      if (!user) {
        res.status(401).json({ ok: false, msg: 'Token noto\'g\'ri' }); return;
      }

      const peer_id = sanitize(req.body?.peer_id || '', 200);
      const name    = sanitize(req.body?.name    || user.name || 'Foydalanuvchi', 100);

      if (!peer_id) { res.status(400).json({ ok: false, msg: 'peer_id kerak' }); return; }

      // Xona mavjudligini tekshirish
      const room = await client.query(
        'SELECT id, peer_room_id, is_active FROM rooms WHERE id=$1 AND expires_at > now()',
        [user.room_id]
      );
      if (!room.rows.length) {
        res.status(404).json({ ok: false, msg: 'Dars xonasi topilmadi' }); return;
      }

      // Agar ustoz bo'lsa — xonani faol qilish
      if (user.role === 'teacher') {
        await client.query('UPDATE rooms SET is_active=true WHERE id=$1', [user.room_id]);
      }

      // Ishtirokchini qo'shish
      await client.query(`
        INSERT INTO room_participants (room_id, peer_id, name, role)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (room_id, peer_id) DO UPDATE SET last_seen=now(), name=$3
      `, [user.room_id, peer_id, name, user.role]);

      // Eskirgan (15s) ishtirokchilarni tozalash
      await client.query(`DELETE FROM room_participants WHERE last_seen < now() - interval '15 seconds'`);

      const participants = await client.query(
        'SELECT peer_id, name, role FROM room_participants WHERE room_id=$1',
        [user.room_id]
      );

      res.json({ ok: true, participants: participants.rows, peer_room_id: room.rows[0].peer_room_id });
      return;
    }


    // ── Heartbeat (lightweight keep-alive) ───────────────────
    if (action === 'heartbeat' && req.method === 'POST') {
      const token = req.headers['x-room-token'] || '';
      const user  = verifyRoomToken(token);
      if (!user) { res.status(401).json({ ok:false }); return; }
      const peer_id = sanitize(req.body?.peer_id || '', 200);
      await client.query(
        `UPDATE room_participants SET last_seen=now()
         WHERE room_id=$1 AND peer_id=$2`,
        [user.room_id, peer_id]
      );
      const rr = await client.query(
        'SELECT is_active FROM rooms WHERE id=$1 AND expires_at > now()',
        [user.room_id]
      );
      if (!rr.rows.length || !rr.rows[0].is_active) {
        res.status(404).json({ ok:false, msg:'Room closed' }); return;
      }
      res.json({ ok:true }); return;
    }

    // ── Xonadan chiqish ───────────────────────────────────────
    if (action === 'leave' && req.method === 'POST') {
      const token = req.headers['x-room-token'] || '';
      const user  = verifyRoomToken(token);
      if (!user) { res.status(401).end(); return; }

      const peer_id = sanitize(req.body?.peer_id || '', 200);
      await client.query(
        'DELETE FROM room_participants WHERE room_id=$1 AND peer_id=$2',
        [user.room_id, peer_id]
      );

      // Agar ustoz chiqsa — xonani yopish va link ni o'chirish
      if (user.role === 'teacher') {
        await client.query(
          'UPDATE rooms SET is_active=false, expires_at=now() WHERE id=$1',
          [user.room_id]
        );
        // Barcha ishtirokchilarni ham chiqarish
        await client.query('DELETE FROM room_participants WHERE room_id=$1', [user.room_id]);
      }
      res.json({ ok: true }); return;
    }

    // ── Ishtirokchilar ro'yxati (polling o'rniga — faqat join/leave eventlari) ──
    if (action === 'participants' && req.method === 'GET') {
      const token = req.headers['x-room-token'] || req.query.token || '';
      const user  = verifyRoomToken(token);
      if (!user) { res.status(401).end(); return; }

      await client.query(`DELETE FROM room_participants WHERE last_seen < now() - interval '15 seconds'`);
      const r = await client.query(
        'SELECT peer_id, name, role FROM room_participants WHERE room_id=$1',
        [user.room_id]
      );
      res.json(r.rows);
      return;
    }

    res.status(404).json({ ok: false, msg: 'Noto\'g\'ri so\'rov' });

  } catch(e) {
    console.error('Room error:', e.message);
    res.status(500).json({ ok: false, msg: 'Server xatosi' });
  } finally { client.release(); }
}
