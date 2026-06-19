"""
Study Bot — dars xonasi yaratish va boshqaruv
"""
import os, json, random, string, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler

BOT_TOKEN    = os.environ.get("BOT_TOKEN", "")
DB_URL       = os.environ.get("DATABASE_URL", "")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "admin-secret-change-me")
SITE_URL     = os.environ.get("SITE_URL", "https://study-zeta-neon.vercel.app")
API_BASE     = SITE_URL + "/api"

# ── Telegram ───────────────────────────────────────────────────
def tg(method, data):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    req = urllib.request.Request(
        url, data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"}
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read())
    except Exception as e:
        print(f"TG error [{method}]: {e}")
        return {}

def send(chat_id, text, kb=None, parse_mode="Markdown"):
    d = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if kb: d["reply_markup"] = kb
    return tg("sendMessage", d)

def answer_cb(cb_id, text=""):
    tg("answerCallbackQuery", {"callback_query_id": cb_id, "text": text})

# ── Room API chaqiruv ──────────────────────────────────────────
def create_room(title, teacher_name, scheduled_at=None):
    url = f"{API_BASE}/room?action=create"
    data = {"title": title, "teacher_name": teacher_name}
    if scheduled_at:
        data["scheduled_at"] = scheduled_at
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        url, data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Admin-Secret": ADMIN_SECRET
        }
    )
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read())
    except Exception as e:
        print(f"Room API error: {e}")
        return {"ok": False, "msg": str(e)}

# ── Foydalanuvchi holatlari ────────────────────────────────────
user_states = {}  # chat_id -> {"state": ..., "data": {...}}

def get_state(chat_id):
    return user_states.get(chat_id, {})

def set_state(chat_id, state, data=None):
    user_states[chat_id] = {"state": state, "data": data or {}}

def clear_state(chat_id):
    user_states.pop(chat_id, None)

# ── Klaviaturalar ──────────────────────────────────────────────
def main_kb():
    return {"inline_keyboard": [
        [{"text": "🎓 Yangi dars yaratish", "callback_data": "newlesson"}],
        [
            {"text": "📊 Statistika", "callback_data": "stats"},
            {"text": "📋 Darslar",    "callback_data": "rooms"}
        ]
    ]}

def cancel_kb():
    return {"inline_keyboard": [[{"text": "❌ Bekor qilish", "callback_data": "cancel"}]]}

def back_kb():
    return {"inline_keyboard": [[{"text": "🏠 Bosh sahifa", "callback_data": "home"}]]}

# ── Buyruqlar ──────────────────────────────────────────────────
def do_start(chat_id, name):
    clear_state(chat_id)
    send(chat_id,
        f"👋 Salom, *{name or 'Ustoz'}*!\n\n"
        "📚 *Study Bot* — onlayn dars boshqaruv tizimi\n\n"
        "Yangi dars yaratish uchun quyidagi tugmani bosing:",
        main_kb()
    )

def do_newlesson_start(chat_id):
    set_state(chat_id, "waiting_title")
    send(chat_id,
        "🎓 *Yangi dars yaratish*\n\n"
        "Dars mavzusini kiriting:\n"
        "_Masalan: Matematika — Kvadrat tenglamalar_",
        cancel_kb()
    )

def do_newlesson_title(chat_id, title, teacher_name):
    set_state(chat_id, "waiting_time", {"title": title, "teacher_name": teacher_name})
    send(chat_id,
        f"✅ Mavzu: *{title}*\n\n"
        "Dars vaqtini kiriting yoki o'tkazib yuboring:\n"
        "_Masalan: 15:30 yoki bo'sh qoldiring_",
        {"inline_keyboard": [
            [{"text": "⏩ O'tkazib yuborish", "callback_data": "skip_time"}],
            [{"text": "❌ Bekor qilish", "callback_data": "cancel"}]
        ]}
    )

def do_create_room(chat_id, title, teacher_name, scheduled_at=None):
    send(chat_id, "⏳ Dars xonasi yaratilmoqda...")
    result = create_room(title, teacher_name, scheduled_at)

    if not result.get("ok"):
        send(chat_id, f"❌ Xato: {result.get('msg', 'Noma\'lum xato')}", back_kb())
        return

    time_info = f"\n🕐 Vaqt: *{scheduled_at}*" if scheduled_at else ""
    
    send(chat_id,
        f"✅ *Dars xonasi yaratildi!*\n\n"
        f"📚 Mavzu: *{result['title']}*{time_info}\n"
        f"⏱ Muddati: *{result['expires_in']}*\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👨‍🏫 *USTOZ havolasi:*\n"
        f"(Faqat siz uchun — hech kimga bermang!)\n"
        f"`{result['teacher_url']}`\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🎓 *O'QUVCHILAR havolasi:*\n"
        f"(O'quvchilarga yuboring)\n"
        f"`{result['student_url']}`\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"⚠️ Havola *24 soat* amal qiladi",
        back_kb()
    )
    clear_state(chat_id)

# ── Update router ──────────────────────────────────────────────
def handle(update):
    # Callback query
    if "callback_query" in update:
        cb   = update["callback_query"]
        cid  = cb["message"]["chat"]["id"]
        data = cb.get("data", "")
        name = cb.get("from", {}).get("first_name", "Ustoz")
        answer_cb(cb["id"])

        if data == "home"       : do_start(cid, name)
        elif data == "newlesson": do_newlesson_start(cid)
        elif data == "cancel"   : clear_state(cid); do_start(cid, name)
        elif data == "skip_time":
            state = get_state(cid)
            if state.get("state") == "waiting_time":
                d = state.get("data", {})
                do_create_room(cid, d.get("title","Dars"), d.get("teacher_name", name))
        elif data == "stats"    : do_stats(cid)
        elif data == "rooms"    : do_rooms(cid)
        return

    # Message
    msg  = update.get("message") or {}
    if not msg: return
    cid  = msg["chat"]["id"]
    text = msg.get("text", "").strip()
    name = msg.get("from", {}).get("first_name", "Ustoz")
    state = get_state(cid)

    # Komandalar
    if text.startswith("/start") or text.startswith("/menu"):
        do_start(cid, name); return

    if text.startswith("/newlesson") or text.startswith("/lesson"):
        do_newlesson_start(cid); return

    # Holat mashinalari
    if state.get("state") == "waiting_title":
        if len(text) < 3:
            send(chat_id=cid, text="❌ Mavzu kamida 3 ta belgi bo'lsin")
            return
        do_newlesson_title(cid, text, name)
        return

    if state.get("state") == "waiting_time":
        d = state.get("data", {})
        do_create_room(cid, d.get("title","Dars"), name, text)
        return

    # Default
    do_start(cid, name)

def do_stats(chat_id):
    try:
        import psycopg2
        conn = psycopg2.connect(DB_URL, sslmode="require")
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM rooms")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM rooms WHERE is_active=true")
        active = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM rooms WHERE expires_at > now()")
        valid = cur.fetchone()[0]
        conn.close()
        send(chat_id,
            f"📊 *Statistika:*\n\n"
            f"📚 Jami darslar: *{total}*\n"
            f"🔴 Hozir faol: *{active}*\n"
            f"✅ Muddati o'tmagan: *{valid}*",
            back_kb()
        )
    except Exception as e:
        send(chat_id, f"❌ {e}", back_kb())

def do_rooms(chat_id):
    try:
        import psycopg2, psycopg2.extras
        conn = psycopg2.connect(DB_URL, sslmode="require")
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute("SELECT title, teacher_name, is_active, created_at FROM rooms WHERE expires_at > now() ORDER BY created_at DESC LIMIT 10")
        rows = cur.fetchall()
        conn.close()
        if not rows:
            send(chat_id, "📭 Hali dars yaratilmagan", back_kb()); return
        text = f"📋 *So'nggi darslar:*\n\n"
        for r in rows:
            st = "🔴 Faol" if r["is_active"] else "⏸ Kutmoqda"
            d  = str(r["created_at"])[:16]
            text += f"{st} | *{r['title']}*\n👤 {r['teacher_name']} | {d}\n\n"
        send(chat_id, text, back_kb())
    except Exception as e:
        send(chat_id, f"❌ {e}", back_kb())

# ── Vercel Handler ─────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type","text/plain")
        self.end_headers()
        self.wfile.write(b"Study Bot is active!")

    def do_POST(self):
        n    = int(self.headers.get("Content-Length",0))
        body = self.rfile.read(n)
        try:
            handle(json.loads(body))
        except Exception as e:
            print(f"Webhook error: {e}")
        self.send_response(200)
        self.send_header("Content-Type","text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a): pass
