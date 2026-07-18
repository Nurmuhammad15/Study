"""
Avtomatik dars xonasi yaratish (Vercel Cron orqali).
Har chorshanba va shanba kuni 22:00 (Toshkent vaqti) da ishga tushadi
va tayyor xona havolalarini belgilangan Telegram chatiga yuboradi.
"""
import os, json, hmac, hashlib, secrets, base64, urllib.request, traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

BOT_TOKEN      = os.environ.get("BOT_TOKEN", "")
DB_URL         = os.environ.get("DATABASE_URL", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "study-secret-2024")
SITE_URL       = os.environ.get("SITE_URL", "https://study-zeta-neon.vercel.app")
CRON_SECRET    = os.environ.get("CRON_SECRET", "")

# Sozlamalar — Vercel loyihasi sozlamalarida (Environment Variables) o'zgartirishingiz mumkin:
TARGET_CHAT_ID = int(os.environ.get("LESSON_CHAT_ID", "-1004292897305"))
TEACHER_NAME   = os.environ.get("LESSON_TEACHER_NAME", "Alisherov Nurmuhammad")
LESSON_TITLE   = os.environ.get("LESSON_TITLE", "Math")
LESSON_TIME    = os.environ.get("LESSON_TIME", "10:00")


def sign_token(payload_dict):
    payload = base64.urlsafe_b64encode(
        json.dumps(payload_dict, separators=(',', ':')).encode()
    ).rstrip(b'=').decode()
    sig = hmac.new(
        SESSION_SECRET.encode(), payload.encode(), hashlib.sha256
    ).digest()
    return payload + "." + base64.urlsafe_b64encode(sig).rstrip(b'=').decode()


def gen_id():
    return secrets.token_hex(12)


def db():
    import psycopg2
    return psycopg2.connect(DB_URL, sslmode="require")


def init_db():
    with db() as conn:
        with conn.cursor() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS rooms (
                    id            text PRIMARY KEY,
                    title         text NOT NULL,
                    teacher_name  text NOT NULL,
                    teacher_token text NOT NULL,
                    student_token text NOT NULL,
                    scheduled_at  text,
                    is_active     boolean DEFAULT false,
                    peer_room_id  text,
                    created_at    timestamptz DEFAULT now(),
                    expires_at    timestamptz DEFAULT now() + interval '24 hours'
                );
            """)
        conn.commit()


def create_room(title, teacher_name, scheduled_at=None):
    rid  = gen_id()
    peer = "peer-" + rid
    ts   = int(datetime.now(timezone.utc).timestamp() * 1000)
    tt   = sign_token({"room_id": rid, "role": "teacher", "name": teacher_name, "iat": ts})
    st   = sign_token({"room_id": rid, "role": "student", "name": "Oquvchi", "iat": ts})
    with db() as conn:
        with conn.cursor() as c:
            c.execute("""
                INSERT INTO rooms(id,title,teacher_name,teacher_token,
                                  student_token,scheduled_at,peer_room_id)
                VALUES(%s,%s,%s,%s,%s,%s,%s)
            """, (rid, title, teacher_name, tt, st, scheduled_at, peer))
        conn.commit()
    return {
        "title":       title,
        "teacher_url": f"{SITE_URL}/?t={tt}",
        "student_url": f"{SITE_URL}/?s={st}",
    }


def tg(method, data):
    url  = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    body = json.dumps(data).encode()
    req  = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read())
    except Exception as e:
        print(f"TG {method} error: {e}")
        return {}


def send(cid, text):
    return tg("sendMessage", {"chat_id": cid, "text": text, "parse_mode": "HTML"})


def run_scheduled_lesson():
    init_db()
    r = create_room(LESSON_TITLE, TEACHER_NAME, LESSON_TIME)
    text = (
        f"✅ <b>Dars xonasi yaratildi!</b>\n\n"
        f"📚 <b>{r['title']}</b>\n"
        f"🕐 Vaqt: <b>{LESSON_TIME}</b>\n"
        f"⏱ Muddat: <b>24 soat</b>\n\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"👨‍🏫 <b>USTOZ havolasi</b> (faqat siz uchun):\n"
        f"<code>{r['teacher_url']}</code>\n\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"🎓 <b>O'QUVCHILAR havolasi:</b>\n"
        f"<code>{r['student_url']}</code>\n\n"
        f"━━━━━━━━━━━━━━━━\n"
        f"⚠️ Havolalar <b>24 soat</b> amal qiladi"
    )
    send(TARGET_CHAT_ID, text)


class handler(BaseHTTPRequestHandler):
    def _authorized(self):
        # Agar Vercel loyihasida CRON_SECRET o'rnatilgan bo'lsa, faqat
        # shu maxfiy kalit bilan kelgan so'rovlarga ruxsat beramiz —
        # aks holda bu manzilni istalgan kishi chaqirib, spam xona
        # yaratishi mumkin edi.
        if not CRON_SECRET:
            return True
        auth = self.headers.get("Authorization", "")
        return auth == f"Bearer {CRON_SECRET}"

    def do_GET(self):
        if not self._authorized():
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b"unauthorized")
            return
        try:
            run_scheduled_lesson()
            ok = True
        except Exception:
            print("cron-lesson error:", traceback.format_exc())
            ok = False
        self.send_response(200 if ok else 500)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok" if ok else b"error")

    def log_message(self, *a):
        pass
