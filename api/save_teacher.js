export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { name, login, pass, phone } = req.body;
  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;

  const headers = {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  const r = await fetch(`${SUPA_URL}/rest/v1/teachers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, login, pass, phone })
  });

  res.json({ ok: r.ok });
}
