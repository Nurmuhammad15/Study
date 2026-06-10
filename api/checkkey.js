export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const key      = req.query.key || '';
  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;

  if (!key || !SUPA_URL) { res.json({ ok: false }); return; }

  const headers = {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  // Kalitni qidirish
  const r = await fetch(
    `${SUPA_URL}/rest/v1/keys?key=eq.${encodeURIComponent(key)}&used=eq.false&select=id`,
    { headers }
  );
  const rows = await r.json();
  if (!rows || rows.length === 0) { res.json({ ok: false }); return; }

  // Ishlatilgan deb belgilash
  await fetch(`${SUPA_URL}/rest/v1/keys?key=eq.${encodeURIComponent(key)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ used: true })
  });

  res.json({ ok: true });
}
