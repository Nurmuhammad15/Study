"""
Study Bot — dars xonasi yaratish
Vercel serverless: state DB da saqlanadi (memory yo'q)
"""
import os, json, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler

BOT_TOKEN    = os.environ.get("BOT_TOKEN", "")
DB_URL       = os.environ.get("DATABASE_URL", "")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "admin-secret-change-me")
SITE_URL     = os.environ.get("SITE_URL", "https://study-zeta-neon.vercel.app")

# ── DB ─────────────────────────────────────────────────────────
def get_conn():
    import psycopg2
    return psycopg2.connect(DB_URL, sslmode="require")

def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bot_states (
                    chat_id bigint primary key,
                    state text,
                    data jsonb,
                    updated_at timestamptz default now()
                );
            """)
        conn.commit()

def get_state(chat_id):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT state, data FROM bot_states WHERE chat_id=%s", (chat_id,))
                row = cur.fetchone()
                if row:
                    return {"state": row[0], "data": row[1] or {}}
    except:
        pass
    return {}

def set_state(chat_id, state, data=None):
    try:
        import psycopg2.extras
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO bot_states (chat_id, state, data)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (chat_id) DO UPDATE SET state=%s, data=%s, updated_at=now()
                """, (chat_id, state, json.dumps(data or {}), state, json.dumps(data or {})))
            conn.commit()
    except Exception as e:
        print(f"set_state error: {e}")

def clear_state(chat_id):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM bot_states WHERE chat_id=%s", (chat_id,))
            conn.commit()
    except:
        pass

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

def send(chat_id, text, kb=None):
    d = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if kb:
        d["reply_markup"] = kb
    return tg("sendMessage", d)

def answer_cb(cb_id, text=""):
    tg("answerCallbackQuery", {"callback_query_id": cb_id, "text": text})

# ── Room API ───────────────────────────────────────────────────
def create_room(title, teacher_name, scheduled_at=None):
    url = f"{SITE_URL}/api/room?action=create"
    data = {"title": title, "teacher_name": teacher_name}
    if scheduled_at:
        data["scheduled_at"] = scheduled_at
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Admin-Secret": ADMIN_SECRET
        }
    )
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read())
    except Exception as e:
        print(f"create_room error: {e}")
        return {"ok": False, "msg": str(e)}

# ── Keyboards ──────────────────────────────────────────────────
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

def skip_cancel_kb():
    return {"inline_keyboard": [
        [{"text": "⏩ Vaqtsiz boshlash", "callback_data": "skip_time"}],
        [{"text": "❌ Bekor qilish",     "callback_data": "cancel"}]
    ]}

# ── Bot logika ──────────────────────────────────────────────────
def do_start(chat_id, name):
    clear_state(chat_id)
    send(chat_id,
        f"👋 Salom, *{name or 'Ustoz'}*!\n\n"
        "📚 *Study Bot* — onlayn dars boshqaruv tizimi\n\n"
        "🎓 Yangi dars yaratish uchun quyidagi tugmani bosing.\n"
        "Bot sizga ustoz va o'quvchi havolalarini beradi.",
        main_kb()
    )

def do_newlesson_start(chat_id):
    set_state(chat_id, "waiting_title")
    send(chat_id,
        "🎓 *Yangi dars yaratish*\n\n"
        "📝 Dars mavzusini kiriting:\n"
        "_Masalan: Matematika — Kvadrat tenglamalar_",
        cancel_kb()
    )

def do_create_room(chat_id, title, teacher_name, scheduled_at=None):
    send(chat_id, "⏳ Dars xonasi yaratilmoqda...")
    clear_state(chat_id)
    
    result = create_room(title, teacher_name, scheduled_at)
    if not result.get("ok"):
        send(chat_id,
            f"❌ Xato yuz berdi:\n`{result.get('msg', 'Noma lum xato')}`\n\n"
            "Qayta urinib ko'ring.",
            back_kb()
        )
        return

    time_info = f"\n🕐 Vaqt: *{scheduled_at}*" if scheduled_at else ""

    send(chat_id,
        f"✅ *Dars xonasi muvaffaqiyatli yaratildi!*\n\n"
        f"📚 Mavzu: *{result['title']}*{time_info}\n"
        f"⏱ Muddati: *{result.get('expires_in','24 soat')}*\n\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"👨‍🏫 *USTOZ havolasi* (faqat siz uchun):\n"
        f"`{result['teacher_url']}`\n\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"🎓 *O'QUVCHILAR havolasi*:\n"
        f"`{result['student_url']}`\n\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"⚠️ Havolalar *24 soat* amal qiladi",
        back_kb()
    )

def do_stats(chat_id):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM rooms WHERE expires_at > now()")
                valid = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM rooms WHERE is_active=true")
                active = cur.fetchone()[0]
        send(chat_id,
            f"📊 *Statistika:*\n\n"
            f"📚 Faol darslar: *{valid}*\n"
            f"🔴 Hozir jonli: *{active}*",
            back_kb()
        )
    except Exception as e:
        send(chat_id, f"❌ {e}", back_kb())

def do_rooms(chat_id):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT title, teacher_name, is_active, created_at
                    FROM rooms WHERE expires_at > now()
                    ORDER BY created_at DESC LIMIT 8
                """)
                rows = cur.fetchall()
        if not rows:
            send(chat_id, "📭 Hali faol dars yo'q", back_kb()); return
        text = "📋 *Faol darslar:*\n\n"
        for r in rows:
            st = "🔴" if r[2] else "⏸"
            d  = str(r[3])[:16]
            text += f"{st} *{r[0]}*\n👤 {r[1]} | {d}\n\n"
        send(chat_id, text, back_kb())
    except Exception as e:
        send(chat_id, f"❌ {e}", back_kb())

# ── Update handler ─────────────────────────────────────────────
def handle(update):
    init_db()

    # ── Callback query ──
    if "callback_query" in update:
        cb   = update["callback_query"]
        cid  = cb["message"]["chat"]["id"]
        data = cb.get("data", "")
        name = cb.get("from", {}).get("first_name", "Ustoz")
        answer_cb(cb["id"])

        if   data == "home"      : do_start(cid, name)
        elif data == "newlesson" : do_newlesson_start(cid)
        elif data == "stats"     : do_stats(cid)
        elif data == "rooms"     : do_rooms(cid)
        elif data == "cancel"    : clear_state(cid); do_start(cid, name)
        elif data == "skip_time" :
            st = get_state(cid)
            if st.get("state") == "waiting_time":
                d = st.get("data", {})
                do_create_room(cid, d.get("title","Dars"), d.get("teacher_name", name))
            else:
                do_start(cid, name)
        return

    # ── Message ──
    msg  = update.get("message") or {}
    if not msg: return
    cid  = msg["chat"]["id"]
    text = msg.get("text", "").strip()
    name = msg.get("from", {}).get("first_name", "Ustoz")

    # Buyruqlar
    if text.startswith("/start") or text.startswith("/menu"):
        do_start(cid, name); return
    if text.startswith("/newlesson") or text.startswith("/lesson"):
        do_newlesson_start(cid); return
    if text.startswith("/stats"):
        do_stats(cid); return

    # State machine
    st = get_state(cid)
    state = st.get("state")

    if state == "waiting_title":
        if len(text) < 2:
            send(cid, "❌ Mavzu kamida 2 ta belgi bo'lsin"); return
        # Mavzuni saqlab, vaqt so'rash
        set_state(cid, "waiting_time", {"title": text, "teacher_name": name})
        send(cid,
            f"✅ Mavzu: *{text}*\n\n"
            "🕐 Dars vaqtini kiriting (ixtiyoriy):\n"
            "_Masalan: 15:30, Ertaga 10:00_\n\n"
            "Yoki vaqtsiz boshlash uchun tugmani bosing:",
            skip_cancel_kb()
        )
        return

    if state == "waiting_time":
        d = st.get("data", {})
        do_create_room(cid, d.get("title","Dars"), name, text)
        return

    # Default
    do_start(cid, name)

# ── Vercel Handler ─────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type","text/plain")
        self.end_headers()
        self.wfile.write(b"Study Bot active!")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)
        try:
            handle(json.loads(body))
        except Exception as e:
            print(f"Webhook error: {e}")
        self.send_response(200)
        self.send_header("Content-Type","text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a): pass
