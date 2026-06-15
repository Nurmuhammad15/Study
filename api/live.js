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
      );
      CREATE TABLE IF NOT EXISTS live_participants (
        id serial primary key,
        room_id text,
        peer_id text,
        name text,
        role text,
        updated_at timestamptz default now(),
        UNIQUE(room_id, peer_id)
      );
    `);

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'join') {
        // Ishtirokchi qo'shilish / heartbeat
        const { room_id, peer_id, name, role } = req.body;
        await client.query(`
          INSERT INTO live_participants (room_id, peer_id, name, role)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (room_id, peer_id) DO UPDATE SET updated_at=now(), name=$3
        `, [room_id, peer_id, name, role]);
        // 20 soniyadan beri yangilanmagan ishtirokchilarni o'chirish (stale)
        await client.query(`DELETE FROM live_participants WHERE updated_at < now() - interval '20 seconds'`);
        const r = await client.query('SELECT peer_id, name, role FROM live_participants WHERE room_id=$1', [room_id]);
        res.json({ ok: true, participants: r.rows });
        return;
      }

      if (action === 'leave') {
        const { room_id, peer_id } = req.body;
        await client.query('DELETE FROM live_participants WHERE room_id=$1 AND peer_id=$2', [room_id, peer_id]);
        res.json({ ok: true });
        return;
      }

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
      const { teacher_login, room_id } = req.body;
      if (teacher_login) {
        await client.query('DELETE FROM live_sessions WHERE teacher_login=$1', [teacher_login]);
      }
      if (room_id) {
        await client.query('DELETE FROM live_participants WHERE room_id=$1', [room_id]);
      }
      res.json({ ok: true });

    } else {
      // GET
      const { teacher_login, room_id } = req.query;

      if (room_id) {
        // Stale ishtirokchilarni tozalash va ro'yxatni qaytarish
        await client.query(`DELETE FROM live_participants WHERE updated_at < now() - interval '20 seconds'`);
        const r = await client.query('SELECT peer_id, name, role FROM live_participants WHERE room_id=$1', [room_id]);
        res.json(r.rows);
        return;
      }

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
