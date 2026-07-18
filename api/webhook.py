"""
Study Bot — dars xonasi yaratish
"""
import os, json, hmac, hashlib, secrets, base64, urllib.request, traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

BOT_TOKEN      = os.environ.get("BOT_TOKEN", "")
DB_URL         = os.environ.get("DATABASE_URL", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "study-secret-2024")
SITE_URL       = os.environ.get("SITE_URL", "https://study-zeta-neon.vercel.app")

# ── Token ─────────────────────────────────────────────────────
def sign_token(payload_dict):
    payload = base64.urlsafe_b64encode(
        json.dumps(payload_dict, separators=(',',':')).encode()
    ).rstrip(b'=').decode()
    sig = hmac.new(
        SESSION_SECRET.encode(), payload.encode(), hashlib.sha256
    ).digest()
    return payload + "." + base64.urlsafe_b64encode(sig).rstrip(b'=').decode()

def gen_id():
    return secrets.token_hex(12)

# ── DB ────────────────────────────────────────────────────────
def db():
    import psycopg2
    return psycopg2.connect(DB_URL, sslmode="require")

def init_db():
    with db() as conn:
        with conn.cursor() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS bot_states (
                    chat_id bigint PRIMARY KEY,
                    state   text,
                    data    jsonb,
                    updated_at timestamptz DEFAULT now()
                );
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
                CREATE TABLE IF NOT EXISTS room_participants (
                    id       serial PRIMARY KEY,
                    room_id  text REFERENCES rooms(id) ON DELETE CASCADE,
                    peer_id  text NOT NULL,
                    name     text,
                    role     text,
                    last_seen timestamptz DEFAULT now(),
                    UNIQUE(room_id, peer_id)
                );
            """)
        conn.commit()

def get_state(cid):
    try:
        with db() as conn:
            with conn.cursor() as c:
                c.execute("SELECT state, data FROM bot_states WHERE chat_id=%s", (cid,))
                r = c.fetchone()
                return {"state": r[0], "data": r[1] or {}} if r else {}
    except Exception as e:
        print("get_state:", e); return {}

def set_state(cid, state, data=None):
    try:
        d = json.dumps(data or {})
        with db() as conn:
            with conn.cursor() as c:
                c.execute("""
                    INSERT INTO bot_states(chat_id,state,data)
                    VALUES(%s,%s,%s)
                    ON CONFLICT(chat_id) DO UPDATE
                    SET state=%s,data=%s,updated_at=now()
                """, (cid, state, d, state, d))
            conn.commit()
    except Exception as e:
        print("set_state:", e)

def clear_state(cid):
    try:
        with db() as conn:
            with conn.cursor() as c:
                c.execute("DELETE FROM bot_states WHERE chat_id=%s", (cid,))
            conn.commit()
    except Exception as e:
        print("clear_state:", e)

def create_room(title, teacher_name, scheduled_at=None):
    rid   = gen_id()
    peer  = "peer-" + rid
    ts    = int(datetime.now(timezone.utc).timestamp() * 1000)
    tt    = sign_token({"room_id": rid, "role": "teacher", "name": teacher_name, "iat": ts})
    st    = sign_token({"room_id": rid, "role": "student", "name": "Oquvchi",    "iat": ts})
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

# ── Telegram API ──────────────────────────────────────────────
def tg(method, data):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    body = json.dumps(data).encode()
    req  = urllib.request.Request(url, data=body,
                                  headers={"Content-Type":"application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read())
    except Exception as e:
        print(f"TG {method} error: {e}"); return {}

def send(cid, text, kb=None):
    d = {"chat_id": cid, "text": text, "parse_mode": "HTML"}
    if kb: d["reply_markup"] = kb
    return tg("sendMessage", d)

def answer_cb(cb_id, text=""):
    tg("answerCallbackQuery", {"callback_query_id": cb_id, "text": text})

def delete_msg(cid, mid):
    tg("deleteMessage", {"chat_id": cid, "message_id": mid})

# ── Keyboards ─────────────────────────────────────────────────
def main_kb():
    return {"inline_keyboard": [
        [{"text": "🎓 Yangi dars yaratish", "callback_data": "newlesson"}],
        [{"text": "📊 Statistika", "callback_data": "stats"},
         {"text": "📋 Darslar",    "callback_data": "rooms"}]
    ]}

def cancel_kb():
    return {"inline_keyboard": [
        [{"text": "❌ Bekor qilish", "callback_data": "cancel"}]
    ]}

def time_kb():
    return {"inline_keyboard": [
        [{"text": "⏩ Hoziroq boshlash", "callback_data": "skip_time"}],
        [{"text": "❌ Bekor qilish",      "callback_data": "cancel"}]
    ]}

def back_kb():
    return {"inline_keyboard": [
        [{"text": "🏠 Bosh sahifa", "callback_data": "home"}]
    ]}

# ── Handlers ──────────────────────────────────────────────────
def do_start(cid, name):
    clear_state(cid)
    send(cid,
        f"👋 Salom, <b>{name}</b>!\n\n"
        "📚 <b>Study Bot</b> — onlayn dars platformasi\n\n"
        "Yangi dars yaratish uchun tugmani bosing:",
        main_kb()
    )

def do_newlesson_start(cid):
    set_state(cid, "waiting_title")
    send(cid,
        "🎓 <b>Yangi dars yaratish</b>\n\n"
        "📝 Dars mavzusini yozing:\n"
        "<i>Masalan: Matematika — Kasrlar</i>",
        cancel_kb()
    )

def do_ask_teacher_name(cid, title):
    set_state(cid, "waiting_teacher_name", {"title": title})
    send(cid,
        f"✅ Mavzu: <b>{title}</b>\n\n"
        "👨‍🏫 Ismingizni kiriting (o'quvchilarga shu ism ko'rinadi):\n"
        "<i>Masalan: Alisherov Nurmuhammad</i>",
        cancel_kb()
    )

def do_create_room(cid, title, teacher_name, scheduled_at=None):
    clear_state(cid)
    try:
        r = create_room(title, teacher_name, scheduled_at)
        vaqt = f"\n🕐 Vaqt: <b>{scheduled_at}</b>" if scheduled_at else ""
        send(cid,
            f"✅ <b>Dars xonasi yaratildi!</b>\n\n"
            f"📚 <b>{r['title']}</b>{vaqt}\n"
            f"⏱ Muddat: <b>24 soat</b>\n\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"👨‍🏫 <b>USTOZ havolasi</b> (faqat siz uchun):\n"
            f"<code>{r['teacher_url']}</code>\n\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"🎓 <b>O'QUVCHILAR havolasi:</b>\n"
            f"<code>{r['student_url']}</code>\n\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"⚠️ Havolalar <b>24 soat</b> amal qiladi",
            back_kb()
        )
    except Exception as e:
        print("create_room error:", traceback.format_exc())
        send(cid, f"❌ Xato yuz berdi:\n<code>{e}</code>", back_kb())

def do_stats(cid):
    try:
        with db() as conn:
            with conn.cursor() as c:
                c.execute("SELECT COUNT(*) FROM rooms WHERE expires_at > now()")
                total = c.fetchone()[0]
                c.execute("SELECT COUNT(*) FROM rooms WHERE is_active=true AND expires_at > now()")
                active = c.fetchone()[0]
        send(cid,
            f"📊 <b>Statistika:</b>\n\n"
            f"📚 Jami darslar: <b>{total}</b>\n"
            f"🔴 Hozir jonli: <b>{active}</b>",
            back_kb()
        )
    except Exception as e:
        send(cid, f"❌ {e}", back_kb())

def do_rooms(cid):
    try:
        with db() as conn:
            with conn.cursor() as c:
                c.execute("""
                    SELECT title, teacher_name, is_active, created_at
                    FROM rooms WHERE expires_at > now()
                    ORDER BY created_at DESC LIMIT 8
                """)
                rows = c.fetchall()
        if not rows:
            send(cid, "📭 Hali faol dars yo'q", back_kb()); return
        text = "📋 <b>Faol darslar:</b>\n\n"
        for r in rows:
            icon = "🔴" if r[2] else "⏸"
            d    = str(r[3])[:16]
            text += f"{icon} <b>{r[0]}</b>\n👤 {r[1]} | {d}\n\n"
        send(cid, text, back_kb())
    except Exception as e:
        send(cid, f"❌ {e}", back_kb())

# ── Main router ───────────────────────────────────────────────
def handle(update):
    try:
        init_db()
    except Exception as e:
        print("init_db error:", e)

    # ── Callback query (inline tugmalar) ──
    if "callback_query" in update:
        cb   = update["callback_query"]
        cid  = cb["message"]["chat"]["id"]
        data = cb.get("data", "")
        name = (cb.get("from") or {}).get("first_name") or "Ustoz"

        # MUHIM: avval answerCallbackQuery — aks holda Telegram qayta yuboradi
        answer_cb(cb["id"])

        try:
            if   data == "home":       do_start(cid, name)
            elif data == "newlesson":  do_newlesson_start(cid)
            elif data == "stats":      do_stats(cid)
            elif data == "rooms":      do_rooms(cid)
            elif data == "cancel":
                clear_state(cid)
                do_start(cid, name)
            elif data == "skip_time":
                st = get_state(cid)
                if st.get("state") == "waiting_time":
                    d2 = st.get("data", {})
                    do_create_room(cid, d2.get("title", "Dars"), d2.get("teacher_name", name))
                else:
                    do_start(cid, name)
            else:
                do_start(cid, name)
        except Exception as e:
            print("callback error:", traceback.format_exc())
            try: send(cid, f"❌ Xato: {e}", back_kb())
            except: pass
        return

    # ── Oddiy xabar ──
    msg  = update.get("message") or {}
    if not msg: return
    cid  = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    name = (msg.get("from") or {}).get("first_name") or "Ustoz"

    # Buyruqlar
    if text.startswith("/start") or text.startswith("/menu"):
        do_start(cid, name); return
    if text.startswith("/newlesson"):
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
            send(cid, "❌ Mavzu kamida 2 ta belgi bo'lsin", cancel_kb()); return
        do_ask_teacher_name(cid, text)
        return

    if state == "waiting_teacher_name":
        if len(text) < 2:
            send(cid, "❌ Ism kamida 2 ta belgi bo'lsin", cancel_kb()); return
        d = st.get("data", {})
        set_state(cid, "waiting_time", {"title": d.get("title", "Dars"), "teacher_name": text})
        send(cid,
            f"✅ Ism: <b>{text}</b>\n\n"
            "🕐 Dars vaqtini kiriting (ixtiyoriy):\n"
            "<i>Masalan: 15:30</i>",
            time_kb()
        )
        return

    if state == "waiting_time":
        d = st.get("data", {})
        do_create_room(cid, d.get("title", "Dars"), d.get("teacher_name", name), text)
        return

    # Default
    do_start(cid, name)

# ── Vercel serverless handler ─────────────────────────────────
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Study Bot OK")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = self.rfile.read(length)
            update = json.loads(body)
            handle(update)
        except Exception as e:
            print("POST error:", traceback.format_exc())
        finally:
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")

    def log_message(self, *a): pass
