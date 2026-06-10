#!/usr/bin/env python3
"""
Teacher Dashboard - Telegram Bot + HTTP Server
Bot kalitlarni saqlaydi, sayt HTTP orqali tekshiradi.

O'rnatish:  pip install pytelegrambotapi requests
Ishga tushirish: python bot.py
"""

import telebot, random, string, time, json, os, threading
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BOT_TOKEN  = "8553083980:AAGHrhOS8Z9OX4a4QKGk3BnV3psxtSZvtjo"
ADMIN_FILE    = "admin.json"
KEYS_FILE     = "keys.json"
TEACHERS_FILE = "teachers.json"
HTTP_PORT  = 8765   # sayt shu portga so'rov yuboradi

bot = telebot.TeleBot(BOT_TOKEN)

# ── JSON saqlash ─────────────────────────────
def load_json(path, default):
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return default

def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

admin_data    = load_json(ADMIN_FILE, {"chat_id": None})
keys_data     = load_json(KEYS_FILE, [])
teachers_data = load_json(TEACHERS_FILE, [])

def get_admin_id(): return admin_data.get("chat_id")
def set_admin_id(cid):
    admin_data["chat_id"] = cid
    save_json(ADMIN_FILE, admin_data)
def save_keys():     save_json(KEYS_FILE,     keys_data)
def save_teachers(): save_json(TEACHERS_FILE, teachers_data)

def is_admin(cid): return get_admin_id() == cid

def generate_key():
    p1 = ''.join(random.choices(string.ascii_uppercase, k=6))
    p2 = ''.join(random.choices(string.digits + string.ascii_uppercase, k=4))
    return f"USTOZ-{p1}-{p2}"

# ── HTTP Server — sayt shu yerga so'rov yuboradi ──
class KeyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass  # logni yashirish

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        # ── GET /checkkey?key=USTOZ-... ──
        if parsed.path == '/checkkey':
            key   = params.get('key', [''])[0].strip()
            found = next((k for k in keys_data if k['key'] == key and not k['used']), None)
            if found:
                found['used'] = True
                found['used_at'] = datetime.now().strftime("%d.%m.%Y %H:%M")
                save_keys()
                result = b'{"ok":true}'
            else:
                result = b'{"ok":false}'
            self._respond(200, result)

        # ── GET /teachers — barcha ustozlar ro'yxati ──
        elif parsed.path == '/teachers':
            data = json.dumps(teachers_data, ensure_ascii=False).encode('utf-8')
            self._respond(200, data)

        else:
            self._respond(404, b'{"ok":false}')

    def do_POST(self):
        parsed = urlparse(self.path)

        # ── POST /save_teacher — yangi ustoz saqlash ──
        if parsed.path == '/save_teacher':
            length = int(self.headers.get('Content-Length', 0))
            body   = self.rfile.read(length)
            try:
                teacher = json.loads(body)
                name  = teacher.get('name', '').strip()
                login = teacher.get('login', '').strip()
                phone = teacher.get('phone', '').strip()
                passw = teacher.get('pass', '').strip()
                if not login or not passw:
                    self._respond(400, b'{"ok":false,"msg":"login va parol majburiy"}')
                    return
                # Takroriy login tekshiruvi
                if any(t['login'] == login for t in teachers_data):
                    self._respond(409, b'{"ok":false,"msg":"login band"}')
                    return
                teachers_data.append({
                    "name": name, "login": login,
                    "pass": passw, "phone": phone,
                    "created": datetime.now().strftime("%d.%m.%Y %H:%M")
                })
                save_teachers()
                # Admin ga xabar
                admin = get_admin_id()
                if admin:
                    try:
                        bot.send_message(admin,
                            f"✅ Yangi ustoz ro'yxatdan o'tdi!\n\n"
                            f"👤 Ism: {name}\n📱 Tel: {phone}\n🔑 Login: {login}",
                            parse_mode="Markdown")
                    except: pass
                self._respond(200, b'{"ok":true}')
            except Exception as e:
                self._respond(400, f'{{"ok":false,"msg":"{e}"}}'.encode())
        else:
            self._respond(404, b'{"ok":false}')

    def _respond(self, code, body):
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

def run_http():
    server = HTTPServer(('0.0.0.0', HTTP_PORT), KeyHandler)
    server.serve_forever()

# ── Bot handlerlari ──────────────────────────
@bot.message_handler(commands=['start'])
def handle_start(message):
    cid  = message.chat.id
    name = message.from_user.first_name or "Foydalanuvchi"
    if get_admin_id() is None:
        set_admin_id(cid)
        bot.send_message(cid,
            f"✅ Salom {name}! Siz *admin* bo'ldingiz.\n"
            f"Chat ID: `{cid}`\n\n"
            f"/getkey — kalit yaratish\n/keys — kalitlar\n/stats — statistika",
            parse_mode="Markdown")
        return
    if is_admin(cid):
        kb = telebot.types.InlineKeyboardMarkup()
        kb.add(
            telebot.types.InlineKeyboardButton("🔑 Kalit yaratish", callback_data="getkey"),
            telebot.types.InlineKeyboardButton("📊 Statistika",     callback_data="stats")
        )
        kb.add(telebot.types.InlineKeyboardButton("🗝 Barcha kalitlar", callback_data="keys"))
        bot.send_message(cid,
            f"👋 Salom, *{name}*!\n\n"
            f"🔑 /getkey — kalit yaratish\n"
            f"🗝 /keys — kalitlar\n"
            f"📊 /stats — statistika\n"
            f"❌ /deletekeys — kalitlarni o'chirish",
            parse_mode="Markdown", reply_markup=kb)
    else:
        bot.send_message(cid, "Bu bot faqat admin uchun.")

def send_new_key(cid):
    key = generate_key()
    keys_data.append({"key": key, "used": False,
                       "created": datetime.now().strftime("%d.%m.%Y %H:%M"),
                       "timestamp": time.time()})
    save_keys()
    kb = telebot.types.InlineKeyboardMarkup()
    kb.add(telebot.types.InlineKeyboardButton("🔑 Yangi kalit", callback_data="getkey"))
    bot.send_message(cid,
        f"🔑 *Yangi ustoz kaliti:*\n\n`{key}`\n\n"
        f"⚠️ Faqat *bir marta* ishlatiladi\n"
        f"📋 Ustozga yuboring",
        parse_mode="Markdown", reply_markup=kb)

@bot.message_handler(commands=['getkey'])
def handle_getkey(message):
    if not is_admin(message.chat.id):
        bot.send_message(message.chat.id, "⛔ Ruxsat yo'q!"); return
    send_new_key(message.chat.id)

def send_keys_list(cid):
    if not keys_data:
        bot.send_message(cid, "📭 Kalit yo'q."); return
    text = "🗝 *Kalitlar (oxirgi 15):*\n\n"
    for k in keys_data[-15:]:
        st = "✅ Ishlatilgan" if k["used"] else "⏳ Kutilmoqda"
        text += f"`{k['key']}`\n{st} — {k['created']}\n\n"
    unused = sum(1 for k in keys_data if not k["used"])
    text += f"Jami: {len(keys_data)} | Ishlatilmagan: {unused}"
    bot.send_message(cid, text, parse_mode="Markdown")

def send_stats(cid):
    total  = len(keys_data)
    used   = sum(1 for k in keys_data if k["used"])
    bot.send_message(cid,
        f"📊 *Statistika:*\n\nJami: *{total}*\n✅ Ishlatilgan: *{used}*\n⏳ Kutilmoqda: *{total-used}*",
        parse_mode="Markdown")

@bot.message_handler(commands=['keys'])
def handle_keys(message):
    if not is_admin(message.chat.id): bot.send_message(message.chat.id, "⛔ Ruxsat yo'q!"); return
    send_keys_list(message.chat.id)

@bot.message_handler(commands=['stats'])
def handle_stats(message):
    if not is_admin(message.chat.id): bot.send_message(message.chat.id, "⛔ Ruxsat yo'q!"); return
    send_stats(message.chat.id)

@bot.message_handler(commands=['deletekeys'])
def handle_deletekeys(message):
    if not is_admin(message.chat.id): bot.send_message(message.chat.id, "⛔ Ruxsat yo'q!"); return
    kb = telebot.types.InlineKeyboardMarkup()
    kb.add(
        telebot.types.InlineKeyboardButton("✅ Ha, o'chirish", callback_data="confirm_delete"),
        telebot.types.InlineKeyboardButton("❌ Yo'q", callback_data="cancel_delete")
    )
    bot.send_message(message.chat.id, "⚠️ Barcha kalitlarni o'chirasizmi?", reply_markup=kb)

@bot.callback_query_handler(func=lambda c: True)
def handle_callback(call):
    cid = call.message.chat.id
    bot.answer_callback_query(call.id)
    if   call.data == "getkey"         : is_admin(cid) and send_new_key(cid)
    elif call.data == "stats"          : is_admin(cid) and send_stats(cid)
    elif call.data == "keys"           : is_admin(cid) and send_keys_list(cid)
    elif call.data == "confirm_delete" :
        if is_admin(cid):
            keys_data.clear(); save_keys()
            bot.send_message(cid, "✅ Barcha kalitlar o'chirildi.")
    elif call.data == "cancel_delete"  : bot.send_message(cid, "❌ Bekor qilindi.")

# ── MAIN ────────────────────────────────────
if __name__ == "__main__":
    import sys, socket

    # Bitta nusxa tekshiruvi
    _sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    _sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        _sock.bind(("127.0.0.1", 47399))
    except OSError:
        print("⚠️  Bot allaqachon ishlab turibdi! Avval uni to'xtating (Ctrl+C).")
        sys.exit(1)

    # Webhook tozalash
    try:
        import requests as _r
        _r.get(f"https://api.telegram.org/bot{BOT_TOKEN}/deleteWebhook?drop_pending_updates=true", timeout=8)
    except: pass

    # HTTP serverni alohida threadda ishga tushirish
    t = threading.Thread(target=run_http, daemon=True)
    t.start()

    print("=" * 50)
    print("  Teacher Dashboard Bot — ishga tushdi!")
    print("=" * 50)
    print(f"  Admin    : {get_admin_id() or 'Hali aniqlanmagan'}")
    print(f"  Kalitlar : {len(keys_data)} ta")
    print(f"  HTTP port: {HTTP_PORT}  (sayt shu portga ulangan)")
    print("-" * 50)
    print("  /getkey  — kalit yaratish")
    print("  /keys    — barcha kalitlar")
    print("  /stats   — statistika")
    print("  Ctrl+C   — to'xtatish")
    print("=" * 50)

    bot.infinity_polling(timeout=30, long_polling_timeout=30, skip_pending=True)
