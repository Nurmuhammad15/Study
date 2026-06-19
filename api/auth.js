/**
 * auth.js — Token + AES-256-GCM shifrlash
 *
 * TOKEN:    HMAC-SHA256, base64url, 24 soat muddatli
 * ENCRYPT:  AES-256-GCM — DB ga yoziladigan barcha sezgir ma'lumotlar
 *
 * Kalit ierarxiyasi:
 *   SESSION_SECRET  →  HKDF  →  TOKEN_KEY  (token imzolash)
 *                            →  ENC_KEY    (ma'lumot shifrlash)
 */
import { createHmac, randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET || 'study-secret-must-change-2024';
const ROOM_TTL       = 24 * 60 * 60 * 1000; // 24 soat ms

// ── Kalit hosilasi (HKDF-SHA256) ─────────────────────────────
// Bir SECRET dan ikki alohida 32-baytli kalit chiqaramiz
const TOKEN_KEY = hkdfSync('sha256',
  Buffer.from(SESSION_SECRET),
  Buffer.alloc(32),          // salt
  Buffer.from('study-token-v1'),
  32
);
const ENC_KEY = hkdfSync('sha256',
  Buffer.from(SESSION_SECRET),
  Buffer.alloc(32),
  Buffer.from('study-encrypt-v1'),
  32
);

// ── AES-256-GCM shifrlash ─────────────────────────────────────
/**
 * encrypt(plaintext) → "iv:authTag:ciphertext" (hex)
 * Har safar yangi 12-baytli IV ishlatiladi
 */
export function encrypt(plaintext) {
  if (!plaintext && plaintext !== 0) return null;
  const str = String(plaintext);
  const iv   = randomBytes(12);                          // 96-bit IV
  const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc  = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();                      // 128-bit GCM tag
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * decrypt(ciphertext) → plaintext string | null
 * GCM authentication tag muvaffaqiyatsiz bo'lsa null qaytaradi
 */
export function decrypt(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') return null;
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, encHex] = parts;
    const iv      = Buffer.from(ivHex,  'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const encBuf  = Buffer.from(encHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(encBuf), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    // Authentication tag xato — ma'lumot buzilgan yoki kalit noto'g'ri
    return null;
  }
}

// ── HMAC-SHA256 Room Token ────────────────────────────────────
export function signRoomToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = createHmac('sha256', TOKEN_KEY).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyRoomToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 1) return null;
  const data = token.slice(0, dotIdx);
  const sig  = token.slice(dotIdx + 1);
  const expected = createHmac('sha256', TOKEN_KEY).update(data).digest('base64url');
  // Timing-safe taqqoslash
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() - payload.iat > ROOM_TTL) return null;
    return payload;
  } catch { return null; }
}

// ── Room ID generatsiya ───────────────────────────────────────
export function generateRoomId() {
  return randomBytes(12).toString('hex'); // 24 hex char, 96-bit entropy
}

// ── Admin Secret tekshirish (timing-safe) ────────────────────
export function verifyAdminSecret(req) {
  const secret   = req.headers['x-admin-secret'] || '';
  const expected = process.env.ADMIN_SECRET || 'admin-secret-change-me';
  if (secret.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
