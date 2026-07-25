/**
 * WebRTC signalizatsiya relay — endi alohida PeerJS serveriga ehtiyoj yo'q.
 * Offer/answer/ICE candidate xabarlari shu Vercel funksiyasi orqali
 * (bazaga yozib, keyin so'rab olish - "short polling") uzatiladi.
 *
 * POST /api/signal?action=send   — xabar yuborish
 * GET  /api/signal?action=poll   — o'ziga kelgan xabarlarni olish
 */
import pkg from 'pg';
const { Pool } = pkg;
import { verifyRoomToken } from './auth.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Room-Token');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const token = req.headers['x-room-token'] || '';
  const user  = verifyRoomToken(token);
  if (!user) { res.status(401).json({ ok: false, msg: 'Token xato' }); return; }

  const action = req.query.action || '';
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS signals (
        id         serial PRIMARY KEY,
        room_id    text NOT NULL,
        from_peer  text NOT NULL,
        to_peer    text NOT NULL,
        type       text NOT NULL,
        data       text,
        created_at timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_signals_lookup ON signals(room_id, to_peer, id);
    `);

    // Eski (10 daqiqadan katta) xabarlarni asta-sekin tozalab boramiz —
    // alohida cron shart emas, shu funksiya chaqirilganda bajariladi.
    client.query(`DELETE FROM signals WHERE created_at < now() - interval '10 minutes'`).catch(() => {});

    // ── Xabar yuborish (offer / answer / candidate / bye) ────
    if (action === 'send' && req.method === 'POST') {
      const from = String(req.body?.from || '').slice(0, 200);
      const to   = String(req.body?.to   || '').slice(0, 200);
      const type = String(req.body?.type || '').slice(0, 30);
      const data = typeof req.body?.data === 'string' ? req.body.data.slice(0, 20000) : '';
      if (!from || !to || !type) { res.status(400).json({ ok: false, msg: "Ma'lumot yetarli emas" }); return; }

      await client.query(
        `INSERT INTO signals(room_id, from_peer, to_peer, type, data) VALUES($1,$2,$3,$4,$5)`,
        [user.room_id, from, to, type, data]
      );
      res.json({ ok: true });
      return;
    }

    // ── O'ziga kelgan xabarlarni olish ───────────────────────
    if (action === 'poll' && req.method === 'GET') {
      const peerId = String(req.query.peer_id || '').slice(0, 200);
      const since   = parseInt(req.query.since || '0', 10) || 0;
      if (!peerId) { res.status(400).json({ ok: false, msg: 'peer_id kerak' }); return; }

      const r = await client.query(
        `SELECT id, from_peer, type, data FROM signals
         WHERE room_id = $1 AND to_peer = $2 AND id > $3
         ORDER BY id ASC LIMIT 200`,
        [user.room_id, peerId, since]
      );
      res.json({ ok: true, messages: r.rows });
      return;
    }

    res.status(404).json({ ok: false, msg: 'Noma\'lum amal' });
  } catch (e) {
    console.error('signal.js error:', e);
    res.status(500).json({ ok: false, msg: 'Server xatosi' });
  } finally {
    client.release();
  }
}
