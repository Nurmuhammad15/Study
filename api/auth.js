/**
 * Room token auth — login kerak emas
 * Token: HMAC-SHA256, base64url
 * Payload: { room_id, role, name, iat }
 */
import { createHmac, randomBytes } from 'crypto';

const SECRET = process.env.SESSION_SECRET || 'study-secret-must-change-2024';
const ROOM_TTL = 24 * 60 * 60 * 1000; // 24 soat

export function signRoomToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyRoomToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() - payload.iat > ROOM_TTL) return null;
    return payload; // { room_id, role, name, teacher_login?, iat }
  } catch { return null; }
}

export function generateRoomId() {
  return randomBytes(12).toString('hex'); // 24 char hex
}

/** Middleware — req.roomUser ni to'ldiradi */
export function requireRoomToken(req, res, allowedRole = null) {
  const token = req.headers['x-room-token'] || req.query?.room_token || '';
  const user  = verifyRoomToken(token);
  if (!user) {
    res.status(401).json({ ok: false, msg: 'Havola noto\'g\'ri yoki muddati o\'tgan. Yangi havola oling.' });
    return null;
  }
  if (allowedRole && user.role !== allowedRole) {
    res.status(403).json({ ok: false, msg: 'Ruxsat yo\'q' });
    return null;
  }
  return user;
}

// Admin token — faqat bot uchun (ADMIN_SECRET env var)
export function verifyAdminSecret(req) {
  const secret = req.headers['x-admin-secret'] || '';
  const expected = process.env.ADMIN_SECRET || 'admin-secret-change-me';
  if (secret.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
