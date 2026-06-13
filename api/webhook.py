import os, json, random, string, urllib.request
import psycopg2, psycopg2.extras
from http.server import BaseHTTPRequestHandler

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
DB_URL    = os.environ.get("DATABASE_URL", "")

# ── DB ────────────────────────────────────────────────────────
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
                    name text, login text unique,
                    pass text, phone text,
                    email text default '',
                    created_at timestamptz default now()
                );
                CREATE TABLE IF NOT EXISTS students (
                    id serial primary key,
                    name text, phone text,
                    email text default '',
                    login text unique, pass text,
                    created_at timestamptz default now()
                );
            """)
        conn.commit()

def generate_key():
    p1 = ''.join(random.choices(string.ascii_uppercase, k=6))
    p2 = ''.join(random.choices(string.digits + string.ascii_uppercase, k=4))
    return f"USTOZ-{p1}-{p2}"

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
            cur.execute("SELECT name, login, phone, email, created_at FROM teachers ORDER BY created_at DESC")
            return cur.fetchall()

def get_students():
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute("SELECT name, login, phone, email, created_at FROM students ORDER BY created_at DESC")
            return cur.fetchall()

def get_stats():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COALESCE(SUM(CASE WHEN used THEN 1 ELSE 0 END),0) FROM keys")
            k = cur.fetchone()
            cur.execute("SELECT COUNT(*) FROM teachers")
            t = cur.fetchone()
            cur.execute("SELECT COUNT(*) FROM students")
            s = cur.fetchone()
    return k[0], k[1], t[0], s[0]

# ── Telegram ──────────────────────────────────────────────────
def tg(method, data):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    req = urllib.request.Request(
        url, data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"}
    )
    try: urllib.request.urlopen(req, timeout=10)
    except Exception as e: print(f"TG error: {e}")

def send(chat_id, text, kb=None):
    d = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if kb: d["reply_markup"] = kb
    tg("sendMessage", d)

def answer_cb(cb_id):
    tg("answerCallbackQuery", {"callback_query_id": cb_id})

# ── Keyboards ─────────────────────────────────────────────────
def main_kb():
    return {"inline_keyboard": [
        [{"text": "🔑 Kalit yaratish", "callback_data": "getkey"},
         {"text": "📊 Statistika",     "callback_data": "stats"}],
        [{"text": "👨‍🏫 Ustozlar",   "callback_data": "teachers"},
         {"text": "🎓 O'quvchilar",   "callback_data": "students"}],
        [{"text": "🗝 Kalitlar",       "callback_data": "keys"}]
    ]}

def back_kb():
    return {"inline_keyboard": [[{"text": "🏠 Bosh sahifa", "callback_data": "home"}]]}

def getkey_kb():
    return {"inline_keyboard": [
        [{"text": "🔑 Yana kalit", "callback_data": "getkey"}],
        [{"text": "🏠 Bosh sahifa", "callback_data": "home"}]
    ]}

# ── Commands ──────────────────────────────────────────────────
def do_start(chat_id, name):
    send(chat_id,
        f"👋 Salom, *{name or 'Admin'}*!\n\n"
        "📚 *Study Bot* — ustoz boshqaruv paneli\n\n"
        "Quyidagi tugmalardan foydalaning:",
        main_kb()
    )

def do_getkey(chat_id):
    try:
        key = generate_key()
        add_key(key)
        send(chat_id,
            f"✅ *Yangi ustoz kaliti yaratildi!*\n\n"
            f"🔑 `{key}`\n\n"
            "⚠️ Bu kalit *faqat bir marta* ishlatiladi\n"
            "📤 Ustozga yuboring",
            getkey_kb()
        )
    except Exception as e:
        send(chat_id, f"❌ Xato: {e}", back_kb())

def do_keys(chat_id):
    try:
        keys = get_keys()
        if not keys:
            send(chat_id, "📭 Hali kalit yaratilmagan.", back_kb()); return
        text = "🗝 *So'nggi 15 ta kalit:*\n\n"
        for k in keys:
            st = "✅" if k["used"] else "⏳"
            d  = str(k["created_at"])[:16]
            text += f"{st} `{k['key']}`\n_{d}_\n\n"
        send(chat_id, text, back_kb())
    except Exception as e:
        send(chat_id, f"❌ {e}", back_kb())

def do_stats(chat_id):
    try:
        total, used, teachers, students = get_stats()
        send(chat_id,
            f"📊 *Statistika:*\n\n"
            f"🔑 Kalitlar: *{total}* ta\n"
            f"  ✅ Ishlatilgan: *{used}*\n"
            f"  ⏳ Bo'sh: *{total - used}*\n\n"
            f"👨‍🏫 Ustozlar: *{teachers}* ta\n"
            f"🎓 O'quvchilar: *{students}* ta",
            back_kb()
        )
    except Exception as e:
        send(chat_id, f"❌ {e}", back_kb())

def do_teachers(chat_id):
    try:
        rows = get_teachers()
        if not rows:
            send(chat_id, "📭 Hali ustoz yo'q.", back_kb()); return
        text = f"👨‍🏫 *Ustozlar ({len(rows)} ta):*\n\n"
        for t in rows:
            d = str(t.get("created_at",""))[:10]
            email = t.get("email","") or "—"
            text += f"👤 *{t['name']}*\n📱 {t['phone'] or '—'} | 📧 {email}\n🔑 `{t['login']}` | 📅 {d}\n\n"
        send(chat_id, text, back_kb())
    except Exception as e:
        send(chat_id, f"❌ {e}", back_kb())

def do_students(chat_id):
    try:
        rows = get_students()
        if not rows:
            send(chat_id, "📭 Hali o'quvchi yo'q.", back_kb()); return
        text = f"🎓 *O'quvchilar ({len(rows)} ta):*\n\n"
        for s in rows:
            d = str(s.get("created_at",""))[:10]
            email = s.get("email","") or "—"
            text += f"👤 *{s['name']}*\n📱 {s['phone'] or '—'} | 📧 {email}\n🔑 `{s['login']}` | 📅 {d}\n\n"
        send(chat_id, text, back_kb())
    except Exception as e:
        send(chat_id, f"❌ {e}", back_kb())

# ── Router ────────────────────────────────────────────────────
def handle(update):
    if "callback_query" in update:
        cb   = update["callback_query"]
        cid  = cb["message"]["chat"]["id"]
        data = cb.get("data","")
        answer_cb(cb["id"])
        if   data == "getkey"   : do_getkey(cid)
        elif data == "stats"    : do_stats(cid)
        elif data == "teachers" : do_teachers(cid)
        elif data == "students" : do_students(cid)
        elif data == "keys"     : do_keys(cid)
        elif data == "home"     : do_start(cid, "Admin")
        return

    msg  = update.get("message") or {}
    if not msg: return
    cid  = msg["chat"]["id"]
    text = msg.get("text","")
    name = msg.get("from",{}).get("first_name","")

    if   text.startswith("/start")    : do_start(cid, name)
    elif text.startswith("/getkey")   : do_getkey(cid)
    elif text.startswith("/keys")     : do_keys(cid)
    elif text.startswith("/stats")    : do_stats(cid)
    elif text.startswith("/teachers") : do_teachers(cid)
    elif text.startswith("/students") : do_students(cid)
    else: do_start(cid, name)

# ── Vercel Handler ────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type","text/plain")
        self.end_headers()
        self.wfile.write(b"Study Bot webhook is active!")

    def do_POST(self):
        n    = int(self.headers.get("Content-Length",0))
        body = self.rfile.read(n)
        try:
            init_db()
            handle(json.loads(body))
        except Exception as e:
            print(f"Error: {e}")
        self.send_response(200)
        self.send_header("Content-Type","text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a): pass
