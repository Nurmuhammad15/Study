export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    url: process.env.SUPA_URL || '',
    key: process.env.SUPA_KEY || ''
  });
}
