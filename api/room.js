/**
 * room.js — Dars xonasi API
 *
 * Shifrlangan maydonlar (AES-256-GCM):
 *   rooms              : title, teacher_name, teacher_token, peer_room_id
 *   room_participants  : name, peer_id
 *
 * Ochiq maydonlar (indeks/kalit sifatida ishlatiladi):
 *   rooms.id, rooms.is_active, rooms.expires_at, rooms.created_at
 *   room_participants.role, room_participants.last_seen
 */
import pkg from 'pg';
const { Pool } = pkg;
import {
  signRoomToken, verifyRoomToken,
  generateRoomId, verifyAdminSecret,
  encrypt, decrypt
} from './auth.js';

const pool     = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SITE_URL = process.env.SITE_URL || 'https://study-zeta-neon.vercel.app';

// ── Input tozalash ────────────────────────────────────────────
function sanitize(str, max = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, max);
}

// ── Shifrlangan qatorni decrypt qilib qaytarish ───────────────
function dec(val, fallback = '') {
  if (!val) return fallback;
  return decrypt(val) ?? fallback;
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Room-Token, X-Admin-Secret');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action || '';
  const client = await pool.connect();

  try {
    // Jadvallarni yaratish (encrypted sifatida belgilangan)
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id           text PRIMARY KEY,
        title        text NOT NULL,
        teacher_name text NOT NULL,
        teacher_token text NOT NULL,
        scheduled_at  timestamptz,
        is_active     boolean DEFAULT false,
        peer_room_id  text,
        enc           boolean DEFAULT true,
        created_at    timestamptz DEFAULT now(),
        expires_at    timestamptz DEFAULT now() + interval '24 hours'
      );
      CREATE TABLE IF NOT EXISTS room_participants (
        id        serial PRIMARY KEY,
        room_id   text REFERENCES rooms(id) ON DELETE CASCADE,
        peer_id   text NOT NULL,
        name      text,
        role      text CHECK(role IN ('teacher','student')),
        joined_at timestamptz DEFAULT now(),
        last_seen timestamptz DEFAULT now(),
        UNIQUE(room_id, peer_id)
      );
    `);

    // ── BOT: Yangi xona yaratish ──────────────────────────────
    if (action === 'create' && req.method === 'POST') {
      if (!verifyAdminSecret(req)) {
        res.status(403).json({ ok: false, msg: 'Admin ruxsati kerak' }); return;
      }

      const title        = sanitize(req.body?.title        || 'Yangi dars', 200);
      const teacher_name = sanitize(req.body?.teacher_name || 'Ustoz', 100);
      const scheduled_at = req.body?.scheduled_at || null;

      const room_id   = generateRoomId();
      const peer_room = 'peer-' + room_id;

      // Token yaratish
      const teacherToken = signRoomToken({ room_id, role: 'teacher', name: teacher_name, iat: Date.now() });
      const studentToken = signRoomToken({ room_id, role: 'student', name: "O'quvchi",   iat: Date.now() });

      // DB ga yozishdan oldin shifrlash
      await client.query(
        `INSERT INTO rooms (id, title, teacher_name, teacher_token, scheduled_at, peer_room_id, enc)
         VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [
          room_id,
          encrypt(title),
          encrypt(teacher_name),
          encrypt(teacherToken),
          scheduled_at,
          encrypt(peer_room)
        ]
      );

      res.json({
        ok: true,
        room_id,
        title,
        teacher_url:  `${SITE_URL}/?t=${teacherToken}`,
        student_url:  `${SITE_URL}/?s=${studentToken}`,
        peer_room_id: peer_room,
        expires_in:   '24 soat'
      });
      return;
    }

    // ── Xona ma'lumotlari ─────────────────────────────────────
    if (action === 'info' && req.method === 'GET') {
      const token = req.headers['x-room-token'] || req.query.token || '';
      const user  = verifyRoomToken(token);
      if (!user) {
        res.status(401).json({ ok: false, msg: "Havola noto'g'ri yoki muddati o'tgan" }); return;
      }

      const r = await client.query(
        'SELECT id, title, teacher_name, peer_room_id, is_active, scheduled_at FROM rooms WHERE id=$1 AND expires_at > now()',
        [user.room_id]
      );
      if (!r.rows.length) {
        res.status(404).json({ ok: false, msg: "Dars xonasi topilmadi yoki muddati o'tgan" }); return;
      }

      const row = r.rows[0];
      res.json({
        ok: true,
        room: {
          id:           row.id,
          title:        dec(row.title,        'Dars'),
          teacher_name: dec(row.teacher_name, 'Ustoz'),
          peer_room_id: dec(row.peer_room_id, ''),
          is_active:    row.is_active,
          scheduled_at: row.scheduled_at
        },
        user: { role: user.role, name: user.name }
      });
      return;
    }

    // ── Ishtirokchi qo'shish / heartbeat ─────────────────────
    if (action === 'join' && req.method === 'POST') {
      const token = req.headers['x-room-token'] || '';
      const user  = verifyRoomToken(token);
      if (!user) {
        res.status(401).json({ ok: false, msg: "Token noto'g'ri" }); return;
      }

      const peer_id = sanitize(req.body?.peer_id || '', 200);
      const name    = sanitize(req.body?.name || user.name || 'Foydalanuvchi', 100);
      if (!peer_id) { res.status(400).json({ ok: false, msg: 'peer_id kerak' }); return; }

      // Xona mavjudligini tekshirish
      const room = await client.query(
        'SELECT id, peer_room_id, is_active FROM rooms WHERE id=$1 AND expires_at > now()',
        [user.room_id]
      );
      if (!room.rows.length) {
        res.status(404).json({ ok: false, msg: "Dars xonasi topilmadi" }); return;
      }

      // Ustoz kirsa — xonani faollashtirish
      if (user.role === 'teacher') {
        await client.query('UPDATE rooms SET is_active=true WHERE id=$1', [user.room_id]);
      }

      // Ishtirokchini shifrlangan holda qo'shish
      await client.query(`
        INSERT INTO room_participants (room_id, peer_id, name, role)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (room_id, peer_id) DO UPDATE SET last_seen=now(), name=$3
      `, [
        user.room_id,
        encrypt(peer_id),
        encrypt(name),
        user.role        // role — tekshirish uchun ochiq qoladi
      ]);

      // Eskirgan ishtirokchilarni tozalash
      await client.query(`DELETE FROM room_participants WHERE last_seen < now() - interval '20 seconds'`);

      // Ro'yxat qaytarishda decrypt
      const parts = await client.query(
        'SELECT peer_id, name, role FROM room_participants WHERE room_id=$1',
        [user.room_id]
      );
      const participants = parts.rows.map(p => ({
        peer_id: dec(p.peer_id, p.peer_id),
        name:    dec(p.name,    'Foydalanuvchi'),
        role:    p.role
      }));

      res.json({
        ok: true,
        participants,
        peer_room_id: dec(room.rows[0].peer_room_id, '')
      });
      return;
    }

    // ── Xonadan chiqish ───────────────────────────────────────
    if (action === 'leave' && req.method === 'POST') {
      const token = req.headers['x-room-token'] || '';
      const user  = verifyRoomToken(token);
      if (!user) { res.status(401).end(); return; }

      const peer_id = sanitize(req.body?.peer_id || '', 200);

      // peer_id shifrlangan — barcha ishtirokchilarni olib tekshiramiz
      const parts = await client.query(
        'SELECT id, peer_id FROM room_participants WHERE room_id=$1',
        [user.room_id]
      );
      for (const p of parts.rows) {
        if (dec(p.peer_id, '') === peer_id) {
          await client.query('DELETE FROM room_participants WHERE id=$1', [p.id]);
          break;
        }
      }

      if (user.role === 'teacher') {
        await client.query('UPDATE rooms SET is_active=false WHERE id=$1', [user.room_id]);
      }
      res.json({ ok: true }); return;
    }

    // ── Ishtirokchilar ro'yxati ───────────────────────────────
    if (action === 'participants' && req.method === 'GET') {
      const token = req.headers['x-room-token'] || req.query.token || '';
      const user  = verifyRoomToken(token);
      if (!user) { res.status(401).end(); return; }

      await client.query(`DELETE FROM room_participants WHERE last_seen < now() - interval '20 seconds'`);
      const r = await client.query(
        'SELECT peer_id, name, role FROM room_participants WHERE room_id=$1',
        [user.room_id]
      );
      const participants = r.rows.map(p => ({
        peer_id: dec(p.peer_id, p.peer_id),
        name:    dec(p.name,    'Foydalanuvchi'),
        role:    p.role
      }));
      res.json(participants);
      return;
    }

    res.status(404).json({ ok: false, msg: "Noto'g'ri so'rov" });

  } catch(e) {
    console.error('Room error:', e.message);
    res.status(500).json({ ok: false, msg: 'Server xatosi' });
  } finally { client.release(); }
}
