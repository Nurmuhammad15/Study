"""
Telegram Bot Webhook handler — Vercel Serverless (Python)
Barcha bot logikasi shu yerda. polling() yo'q — webhook orqali ishlaydi.
"""
import os, json, random, string
import psycopg2, psycopg2.extras
import urllib.request
from http.server import BaseHTTPRequestHandler

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
DB_URL    = os.environ.get("DATABASE_URL", "")

# ── Database ─────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(DB_URL, sslmode="require")

def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS keys (
                    id serial primary key,
                    key text unique,
                    used boolean default false,
                    created_at timestamptz default now()
                );
                CREATE TABLE IF NOT EXISTS teachers (
                    id serial primary key,
                    name text,
                    login text unique,
                    pass text,
                    phone text,
                    created_at timestamptz default now()
                );
            """)
        conn.commit()

def add_key(key):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO keys (key) VALUES (%s)", (key,))
        conn.commit()

def get_keys():
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute("SELECT key, used, created_at FROM keys ORDER BY created_at DESC LIMIT 15")
            return cur.fetchall()

def get_teachers():
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute("SELECT name, login, phone, created_at FROM teachers ORDER BY created_at DESC")
            return cur.fetchall()

def get_stats():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), SUM(CASE WHEN used THEN 1 ELSE 0 END) FROM keys")
            k = cur.fetchone()
            cur.execute("SELECT COUNT(*) FROM teachers")
            t = cur.fetchone()
    return k[0] or 0, k[1] or 0, t[0] or 0

def generate_key():
    p1 = ''.join(random.choices(string.ascii_uppercase, k=6))
    p2 = ''.join(random.choices(string.digits + string.ascii_uppercase, k=4))
    return f"USTOZ-{p1}-{p2}"

# ── Telegram API ──────────────────────────────────────────────────────────────

def tg_api(method, data):
    url     = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    payload = json.dumps(data).encode()
    req     = urllib.request.Request(url, data=payload,
                                     headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"tg_api error [{method}]: {e}")

def send_message(chat_id, text, parse_mode="Markdown", reply_markup=None):
    data = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        data["reply_markup"] = reply_markup
    tg_api("sendMessage", data)

def answer_callback(callback_id):
    tg_api("answerCallbackQuery", {"callback_query_id": callback_id})

# ── Keyboards ─────────────────────────────────────────────────────────────────

def main_kb():
    return {
        "inline_keyboard": [
            [
                {"text": "🔑 Kalit yaratish", "callback_data": "getkey"},
                {"text": "📊 Statistika",      "callback_data": "stats"}
            ],
            [
                {"text": "👨‍🏫 Ustozlar", "callback_data": "teachers"},
                {"text": "🗝 Kalitlar",   "callback_data": "keys"}
            ]
        ]
    }

def getkey_kb():
    return {"inline_keyboard": [[{"text": "🔑 Yangi kalit", "callback_data": "getkey"}]]}

# ── Bot commands ──────────────────────────────────────────────────────────────

def do_start(chat_id, first_name):
    name = first_name or "Foydalanuvchi"
    send_message(chat_id,
        f"👋 Salom, *{name}*!\n\n"
        "Quyidagi buyruqlardan foydalaning:\n"
        "/getkey — kalit yaratish\n"
        "/keys — kalitlar ro'yxati\n"
        "/stats — statistika\n"
        "/teachers — ustozlar ro'yxati",
        reply_markup=main_kb()
    )

def do_getkey(chat_id):
    try:
        key = generate_key()
        add_key(key)
        send_message(chat_id,
            f"🔑 *Yangi ustoz kaliti:*\n\n`{key}`\n\n"
            "⚠️ Faqat *bir marta* ishlatiladi\n"
            "📋 Ustozga yuboring",
            reply_markup=getkey_kb()
        )
    except Exception as e:
        send_message(chat_id, f"❌ Xato: {e}")

def do_keys(chat_id):
    try:
        keys = get_keys()
        if not keys:
            send_message(chat_id, "📭 Hali kalit yaratilmagan."); return
        text = "🗝 *So'nggi 15 ta kalit:*\n\n"
        for k in keys:
            st = "✅ Ishlatilgan" if k["used"] else "⏳ Kutmoqda"
            d  = str(k["created_at"])[:16]
            text += f"{st}\n`{k['key']}`\n_{d}_\n\n"
        send_message(chat_id, text)
    except Exception as e:
        send_message(chat_id, f"❌ {e}")

def do_stats(chat_id):
    try:
        total, used, teachers = get_stats()
        free = total - used
        send_message(chat_id,
            f"📊 *Statistika:*\n\n"
            f"🔑 Jami kalitlar: *{total}*\n"
            f"  ✅ Ishlatilgan: *{used}*\n"
            f"  ⏳ Bo'sh: *{free}*\n\n"
            f"👨‍🏫 Ro'yxatdagi ustozlar: *{teachers}* ta"
        )
    except Exception as e:
        send_message(chat_id, f"❌ {e}")

def do_teachers(chat_id):
    try:
        teachers = get_teachers()
        if not teachers:
            send_message(chat_id, "📭 Hali ustoz yo'q."); return
        text = f"👨‍🏫 *Ustozlar ({len(teachers)} ta):*\n\n"
        for t in teachers:
            d = str(t.get("created_at", ""))[:10]
            text += f"👤 *{t['name']}*\n📱 {t['phone']} | 🔑 `{t['login']}` | 📅 {d}\n\n"
        send_message(chat_id, text)
    except Exception as e:
        send_message(chat_id, f"❌ {e}")

# ── Update router ─────────────────────────────────────────────────────────────

def handle_update(update):
    # Callback query (inline button press)
    if "callback_query" in update:
        cb   = update["callback_query"]
        cid  = cb["message"]["chat"]["id"]
        data = cb.get("data", "")
        answer_callback(cb["id"])
        dispatch = {
            "getkey":   do_getkey,
            "stats":    do_stats,
            "teachers": do_teachers,
            "keys":     do_keys,
        }
        if data in dispatch:
            dispatch[data](cid)
        return

    # Regular message
    msg = update.get("message") or update.get("edited_message", {})
    if not msg:
        return
    chat_id = msg["chat"]["id"]
    text    = msg.get("text", "")
    fname   = msg.get("from", {}).get("first_name", "")

    if   text.startswith("/start")    : do_start(chat_id, fname)
    elif text.startswith("/getkey")   : do_getkey(chat_id)
    elif text.startswith("/keys")     : do_keys(chat_id)
    elif text.startswith("/stats")    : do_stats(chat_id)
    elif text.startswith("/teachers") : do_teachers(chat_id)

# ── Vercel Serverless Handler ─────────────────────────────────────────────────

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        """Health check endpoint"""
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Bot webhook is active!")

    def do_POST(self):
        """Telegram sends updates here"""
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)
        try:
            update = json.loads(body)
            init_db()
            handle_update(update)
        except Exception as e:
            print(f"Webhook error: {e}")
        # Always return 200 so Telegram doesn't retry
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, format, *args):
        pass  # Suppress default HTTP logs
