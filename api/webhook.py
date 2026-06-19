"""
Study Bot — Vercel Python Serverless (yangi format)
"""
import os, json, urllib.request, psycopg2, psycopg2.extras
from http.server import BaseHTTPRequestHandler

BOT_TOKEN    = os.environ.get("BOT_TOKEN", "")
DB_URL       = os.environ.get("DATABASE_URL", "")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "admin-secret-change-me")
SITE_URL     = os.environ.get("SITE_URL", "https://study-zeta-neon.vercel.app")
API_BASE     = SITE_URL + "/api"

# ── DB ────────────────────────────────────────────────────────
def get_conn():
    return psycopg2.connect(DB_URL, sslmode="require")

def init_db(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS bot_states (
                chat_id    bigint PRIMARY KEY,
                state      text   NOT NULL DEFAULT '',
                data       jsonb  NOT NULL DEFAULT '{}',
                updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS rooms (
                id            text PRIMARY KEY,
                title         text,
                teacher_name  text,
                teacher_token text,
                is_active     boolean DEFAULT false,
                peer_room_id  text,
                enc           boolean DEFAULT true,
                created_at    timestamptz DEFAULT now(),
                expires_at    timestamptz DEFAULT now() + interval '24 hours'
            );
        """)
    conn.commit()

def get_state(conn, chat_id):
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute("SELECT state, data FROM bot_states WHERE chat_id=%s", (chat_id,))
        row = cur.fetchone()
        return {"state": row["state"], "data": row["data"] or {}} if row else {}

def set_state(conn, chat_id, state, data=None):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO bot_states (chat_id, state, data, updated_at)
            VALUES (%s,%s,%s,now())
            ON CONFLICT (chat_id) DO UPDATE
            SET state=EXCLUDED.state, data=EXCLUDED.data, updated_at=now()
        """, (chat_id, state, json.dumps(data or {})))
    conn.commit()

def clear_state(conn, chat_id):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM bot_states WHERE chat_id=%s", (chat_id,))
    conn.commit()

# ── Telegram ──────────────────────────────────────────────────
def tg(method, data):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    req = urllib.request.Request(
        url, data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"}
    )
    try:
        return json.loads(urllib.request.urlopen(req, timeout=10).read())
    except Exception as e:
        print(f"TG [{method}]: {e}")
        return {}

def send(chat_id, text, kb=None):
    d = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if kb: d["reply_markup"] = kb
    tg("sendMessage", d)

def answer_cb(cb_id):
    tg("answerCallbackQuery", {"callback_query_id": cb_id})

# ── Room API ──────────────────────────────────────────────────
def create_room(title, teacher_name, scheduled_at=None):
    url = f"{API_BASE}/room?action=create"
    data = {"title": title, "teacher_name": teacher_name}
    if scheduled_at:
        data["scheduled_at"] = scheduled_at
    req = urllib.request.Request(
        url, data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json", "X-Admin-Secret": ADMIN_SECRET}
    )
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read())
    except Exception as e:
        return {"ok": False, "msg": str(e)}

# ── Klaviaturalar ─────────────────────────────────────────────
def main_kb():
    return {"inline_keyboard": [
        [{"text": "🎓 Yangi dars yaratish", "callback_data": "newlesson"}],
        [{"text": "📊 Statistika", "callback_data": "stats"},
         {"text": "📋 Darslar",   "callback_data": "rooms"}]
    ]}

def cancel_kb():
    return {"inline_keyboard": [[{"text": "❌ Bekor qilish", "callback_data": "cancel"}]]}

def back_kb():
    return {"inline_keyboard": [[{"text": "🏠 Bosh sahifa", "callback_data": "home"}]]}

def skip_kb():
    return {"inline_keyboard": [
        [{"text": "⏩ O'tkazib yuborish", "callback_data": "skip_time"}],
        [{"text": "❌ Bekor qilish",      "callback_data": "cancel"}]
    ]}

# ── Buyruqlar ─────────────────────────────────────────────────
def do_start(conn, chat_id, name):
    clear_state(conn, chat_id)
    send(chat_id,
        f"👋 Salom, *{name or 'Ustoz'}*!\n\n"
        "📚 *Study Bot* — onlayn dars boshqaruv tizimi\n\n"
        "Yangi dars yaratish uchun quyidagi tugmani bosing:",
        main_kb()
    )

def do_newlesson_start(conn, chat_id):
    set_state(conn, chat_id, "waiting_title")
    send(chat_id,
        "🎓 *Yangi dars yaratish*\n\n"
        "Dars mavzusini kiriting:\n"
        "_Masalan: Matematika — Kvadrat tenglamalar_",
        cancel_kb()
    )

def do_newlesson_title(conn, chat_id, title, teacher_name):
    set_state(conn, chat_id, "waiting_time", {"title": title, "teacher_name": teacher_name})
    send(chat_id,
        f"✅ Mavzu: *{title}*\n\n"
        "Dars vaqtini kiriting yoki o'tkazib yuboring:\n"
        "_Masalan: 15:30_",
        skip_kb()
    )

def do_create_room(conn, chat_id, title, teacher_name, scheduled_at=None):
    send(chat_id, "⏳ Dars xonasi yaratilmoqda...")
    result = create_room(title, teacher_name, scheduled_at)
    if not result.get("ok"):
        send(chat_id, f"❌ Xato: {result.get('msg', 'Noma\\'lum xato')}", back_kb())
        return
    time_info = f"\n🕐 Vaqt: *{scheduled_at}*" if scheduled_at else ""
    send(chat_id,
        f"✅ *Dars xonasi yaratildi!*\n\n"
        f"📚 Mavzu: *{result.get('title',title)}*{time_info}\n"
        f"⏱ Muddati: *24 soat*\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👨‍🏫 *USTOZ havolasi:*\n"
        f"_(Faqat siz uchun!)_\n"
        f"`{result['teacher_url']}`\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🎓 *O'QUVCHILAR havolasi:*\n"
        f"_(O'quvchilarga yuboring)_\n"
        f"`{result['student_url']}`\n\n"
        f"⚠️ Havola *24 soat* amal qiladi",
        back_kb()
    )
    clear_state(conn, chat_id)

def do_stats(chat_id):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM rooms")
                total = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM rooms WHERE is_active=true")
                active = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM rooms WHERE expires_at > now()")
                valid = cur.fetchone()[0]
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
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("""
                    SELECT is_active, created_at FROM rooms
                    WHERE expires_at > now()
                    ORDER BY created_at DESC LIMIT 10
                """)
                rows = cur.fetchall()
        if not rows:
            send(chat_id, "📭 Hali dars yaratilmagan", back_kb()); return
        text = "📋 *So'nggi darslar:*\n\n"
        for i, r in enumerate(rows, 1):
            st = "🔴 Faol" if r["is_active"] else "⏸ Kutmoqda"
            d  = str(r["created_at"])[:16]
            text += f"{i}. {st} | {d}\n"
        send(chat_id, text, back_kb())
    except Exception as e:
        send(chat_id, f"❌ {e}", back_kb())

# ── Router ────────────────────────────────────────────────────
def handle(update, conn):
    if "callback_query" in update:
        cb   = update["callback_query"]
        cid  = cb["message"]["chat"]["id"]
        data = cb.get("data", "")
        name = cb.get("from", {}).get("first_name", "Ustoz")
        answer_cb(cb["id"])

        if   data == "home"      : do_start(conn, cid, name)
        elif data == "newlesson" : do_newlesson_start(conn, cid)
        elif data == "cancel"    : clear_state(conn, cid); do_start(conn, cid, name)
        elif data == "stats"     : do_stats(cid)
        elif data == "rooms"     : do_rooms(cid)
        elif data == "skip_time" :
            st = get_state(conn, cid)
            if st.get("state") == "waiting_time":
                d = st.get("data", {})
                do_create_room(conn, cid, d.get("title","Dars"), d.get("teacher_name", name))
        return

    msg  = update.get("message") or {}
    if not msg: return
    cid  = msg["chat"]["id"]
    text = msg.get("text", "").strip()
    name = msg.get("from", {}).get("first_name", "Ustoz")
    st   = get_state(conn, cid)

    if text.startswith("/start") or text.startswith("/menu"):
        do_start(conn, cid, name); return
    if text.startswith("/newlesson") or text.startswith("/lesson"):
        do_newlesson_start(conn, cid); return
    if text.startswith("/stats"):
        do_stats(cid); return

    if st.get("state") == "waiting_title":
        if len(text) < 3:
            send(cid, "❌ Mavzu kamida 3 ta belgi bo'lsin"); return
        do_newlesson_title(conn, cid, text, name); return

    if st.get("state") == "waiting_time":
        d = st.get("data", {})
        do_create_room(conn, cid, d.get("title","Dars"), name, text); return

    do_start(conn, cid, name)

# ── Vercel Handler (yangi format) ─────────────────────────────
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._respond(200, b"Study Bot is active!")

    def do_POST(self):
        try:
            n    = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(n)
            update = json.loads(body)
            conn = get_conn()
            try:
                init_db(conn)
                handle(update, conn)
            finally:
                conn.close()
        except Exception as e:
            print(f"Webhook error: {e}")
        self._respond(200, b"ok")

    def _respond(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a): pass
