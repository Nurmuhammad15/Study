export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;
  const headers = {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json'
  };
  const r = await fetch(`${SUPA_URL}/rest/v1/teachers?select=name,login,pass,phone`, { headers });
  const data = await r.json();
  res.json(data);
}
