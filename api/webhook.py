"""
Study Bot — dars xonasi yaratish
State: PostgreSQL da saqlanadi (Vercel serverless uchun)
Room: to'g'ridan-to'g'ri DB da yaratiladi (self-API yo'q)
"""
import os, json, hmac, hashlib, secrets, base64, urllib.request
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler

BOT_TOKEN    = os.environ.get("BOT_TOKEN", "")
DB_URL       = os.environ.get("DATABASE_URL", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "study-secret-must-change-2024")
SITE_URL     = os.environ.get("SITE_URL", "https://study-zeta-neon.vercel.app")

# ── Token yaratish (auth.js bilan bir xil algoritm) ───────────
def sign_token(payload_dict):
    payload = base64.urlsafe_b64encode(
        json.dumps(payload_dict, separators=(',',':')).encode()
    ).rstrip(b'=').decode()
    sig = hmac.HMAC(
        SESSION_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{payload}.{sig_b64}"

def generate_room_id():
    return secrets.token_hex(12)  # 24 char hex

# ── DB ─────────────────────────────────────────────────────────
def get_conn():
    import psycopg2
    return psycopg2.connect(DB_URL, sslmode="require")

def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bot_states (
                    chat_id bigint PRIMARY KEY,
                    state text,
                    data jsonb,
                    updated_at timestamptz DEFAULT now()
                );
                CREATE TABLE IF NOT EXISTS rooms (
                    id text PRIMARY KEY,
                    title text NOT NULL,
                    teacher_name text NOT NULL,
                    teacher_token text NOT NULL,
                    student_token text NOT NULL,
                    scheduled_at text,
                    is_active boolean DEFAULT false,
                    peer_room_id text,
                    created_at timestamptz DEFAULT now(),
                    expires_at timestamptz DEFAULT now() + interval '24 hours'
                );
                CREATE TABLE IF NOT EXISTS room_participants (
                    id serial PRIMARY KEY,
                    room_id text REFERENCES rooms(id) ON DELETE CASCADE,
                    peer_id text NOT NULL,
                    name text,
                    role text,
                    last_seen timestamptz DEFAULT now(),
                    UNIQUE(room_id, peer_id)
                );
            """)
        conn.commit()

def get_state(chat_id):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT state, data FROM bot_states WHERE chat_id=%s", (chat_id,)
                )
                row = cur.fetchone()
                if row:
                    return {"state": row[0], "data": row[1] or {}}
    except Exception as e:
        print(f"get_state error: {e}")
    return {}

def set_state(chat_id, state, data=None):
    try:
        d = json.dumps(data or {})
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO bot_states (chat_id, state, data)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (chat_id) DO UPDATE
                    SET state=%s, data=%s, updated_at=now()
                """, (chat_id, state, d, state, d))
            conn.commit()
    except Exception as e:
        print(f"set_state error: {e}")

def clear_state(chat_id):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM bot_states WHERE chat_id=%s", (chat_id,))
            conn.commit()
    except Exception as e:
        print(f"clear_state error: {e}")

def create_room_in_db(title, teacher_name, scheduled_at=None):
    """Room yaratish — to'g'ridan-to'g'ri DB ga (API chaqiruvsiz)"""
    room_id     = generate_room_id()
    peer_room   = "peer-" + room_id
    now_ts      = int(datetime.now(timezone.utc).timestamp() * 1000)

    teacher_token = sign_token({
        "room_id": room_id,
        "role": "teacher",
        "name": teacher_name,
        "iat": now_ts
    })
    student_token = sign_token({
        "room_id": room_id,
        "role": "student",
        "name": "Oquvchi",
        "iat": now_ts
    })

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO rooms (id, title, teacher_name, teacher_token,
                                   student_token, scheduled_at, peer_room_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (room_id, title, teacher_name, teacher_token,
                  student_token, scheduled_at, peer_room))
        conn.commit()

    return {
        "ok": True,
        "room_id":     room_id,
        "title":       title,
        "teacher_url": f"{SITE_URL}/?t={teacher_token}",
        "student_url": f"{SITE_URL}/?s={student_token}",
        "expires_in":  "24 soat"
    }

# ── Telegram ───────────────────────────────────────────────────
def tg(method, data):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"}
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read())
    except Exception as e:
        print(f"TG [{method}] error: {e}")
        return {}

def send(chat_id, text, kb=None):
    d = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if kb:
        d["reply_markup"] = kb
    return tg("sendMessage", d)

def edit_msg(chat_id, msg_id, text, kb=None):
    d = {"chat_id": chat_id, "message_id": msg_id,
         "text": text, "parse_mode": "Markdown"}
    if kb:
        d["reply_markup"] = kb
    return tg("editMessageText", d)

def answer_cb(cb_id, text=""):
    tg("answerCallbackQuery", {"callback_query_id": cb_id, "text": text})

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
    return {"inline_keyboard": [
        [{"text": "❌ Bekor qilish", "callback_data": "cancel"}]
    ]}

def time_kb():
    return {"inline_keyboard": [
        [{"text": "⏩ Vaqtsiz boshlash", "callback_data": "skip_time"}],
        [{"text": "❌ Bekor qilish",     "callback_data": "cancel"}]
    ]}

def back_kb():
    return {"inline_keyboard": [
        [{"text": "🏠 Bosh sahifa", "callback_data": "home"}]
    ]}

# ── Bot commands ───────────────────────────────────────────────
def do_start(chat_id, name):
    clear_state(chat_id)
    send(chat_id,
        f"👋 Salom, *{name or 'Ustoz'}*!\n\n"
        "📚 *Study Bot* — onlayn dars tizimi\n\n"
        "Yangi dars yaratish uchun tugmani bosing:",
        main_kb()
    )

def do_newlesson_start(chat_id):
    set_state(chat_id, "waiting_title")
    send(chat_id,
        "🎓 *Yangi dars yaratish*\n\n"
        "📝 Dars mavzusini yozing:\n"
        "_Masalan: Matematika — Kasrlar_",
        cancel_kb()
    )

def do_create_room(chat_id, title, teacher_name, scheduled_at=None):
    clear_state(chat_id)
    try:
        result = create_room_in_db(title, teacher_name, scheduled_at)
        time_info = f"\n🕐 Vaqt: *{scheduled_at}*" if scheduled_at else ""
        send(chat_id,
            f"✅ *Dars xonasi yaratildi!*\n\n"
            f"📚 *{result['title']}*{time_info}\n"
            f"⏱ Muddat: *{result['expires_in']}*\n\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"👨‍🏫 *USTOZ havolasi* (faqat siz uchun):\n"
            f"`{result['teacher_url']}`\n\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"🎓 *O'QUVCHILAR havolasi:*\n"
            f"`{result['student_url']}`\n\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"⚠️ Havolalar *24 soat* amal qiladi",
            back_kb()
        )
    except Exception as e:
        print(f"create_room error: {e}")
        send(chat_id, f"❌ Xato: `{e}`", back_kb())

def do_stats(chat_id):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM rooms WHERE expires_at > now()")
                valid = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM rooms WHERE is_active=true AND expires_at > now()")
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

# ── Router ─────────────────────────────────────────────────────
def handle(update):
    init_db()

    # Callback query (inline tugma)
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
        elif data == "cancel"    :
            clear_state(cid)
            do_start(cid, name)
        elif data == "skip_time" :
            st = get_state(cid)
            if st.get("state") == "waiting_time":
                d = st.get("data", {})
                do_create_room(cid, d.get("title", "Dars"), name)
            else:
                do_start(cid, name)
        return

    # Oddiy xabar
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
    if text.startswith("/rooms"):
        do_rooms(cid); return

    # State machine
    st    = get_state(cid)
    state = st.get("state")

    if state == "waiting_title":
        if len(text) < 2:
            send(cid, "❌ Mavzu kamida 2 ta belgi bo'lsin"); return
        set_state(cid, "waiting_time", {"title": text, "teacher_name": name})
        send(cid,
            f"✅ Mavzu: *{text}*\n\n"
            "🕐 Dars vaqtini kiriting (ixtiyoriy):\n"
            "_Masalan: 15:30_",
            time_kb()
        )
        return

    if state == "waiting_time":
        d = st.get("data", {})
        do_create_room(cid, d.get("title", "Dars"), name, text)
        return

    # Default
    do_start(cid, name)

# ── Vercel Handler ─────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
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
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a): pass
