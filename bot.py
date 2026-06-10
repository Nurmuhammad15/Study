#!/usr/bin/env python3
"""
Teacher Dashboard - Telegram Bot (Supabase versiya)
pip install pytelegrambotapi requests python-dotenv
"""

import telebot, random, string, time, json, requests, sys, socket, os
from datetime import datetime

# .env fayldan o'qish (ixtiyoriy)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BOT_TOKEN = os.environ.get("BOT_TOKEN", "8553083980:AAGHrhOS8Z9OX4a4QKGk3BnV3psxtSZvtjo")
SUPA_URL  = os.environ.get("SUPA_URL", "")   # .env yoki environment dan
SUPA_KEY  = os.environ.get("SUPA_KEY", "")   # .env yoki environment dan

if not SUPA_URL or not SUPA_KEY:
    print("⚠️  SUPA_URL va SUPA_KEY o'rnatilmagan!")
    print("   .env fayl yarating yoki environment variable qiling:")
    print("   SUPA_URL=https://xxxx.supabase.co")
    print("   SUPA_KEY=eyJhbGc...")
    sys.exit(1)

HEADERS = {
    "apikey": SUPA_KEY,
    "Authorization": f"Bearer {SUPA_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

bot = telebot.TeleBot(BOT_TOKEN)

def supa_get(path):
    r = requests.get(SUPA_URL + path, headers=HEADERS, timeout=10)
    r.raise_for_status()
    return r.json()

def supa_post(path, data):
    r = requests.post(SUPA_URL + path, headers=HEADERS, json=data, timeout=10)
    r.raise_for_status()

def generate_key():
    p1 = ''.join(random.choices(string.ascii_uppercase, k=6))
    p2 = ''.join(random.choices(string.digits + string.ascii_uppercase, k=4))
    return f"USTOZ-{p1}-{p2}"

def add_key(key):
    supa_post("/rest/v1/keys", {"key": key, "used": False})

def get_keys():
    return supa_get("/rest/v1/keys?select=key,used,created_at&order=created_at.desc&limit=15")

def get_teachers():
    return supa_get("/rest/v1/teachers?select=name,login,phone,created_at")

@bot.message_handler(commands=['start'])
def handle_start(message):
    cid  = message.chat.id
    name = message.from_user.first_name or "Foydalanuvchi"
    kb = telebot.types.InlineKeyboardMarkup()
    kb.add(
        telebot.types.InlineKeyboardButton("🔑 Kalit yaratish", callback_data="getkey"),
        telebot.types.InlineKeyboardButton("📊 Statistika", callback_data="stats")
    )
    kb.add(telebot.types.InlineKeyboardButton("👨‍🏫 Ustozlar", callback_data="teachers"))
    bot.send_message(cid,
        f"👋 Salom, *{name}*!\n\n"
        "/getkey — kalit yaratish\n"
        "/keys — kalitlar\n"
        "/stats — statistika\n"
        "/teachers — ustozlar",
        parse_mode="Markdown", reply_markup=kb)

def send_new_key(cid):
    key = generate_key()
    try:
        add_key(key)
        kb = telebot.types.InlineKeyboardMarkup()
        kb.add(telebot.types.InlineKeyboardButton("🔑 Yangi kalit", callback_data="getkey"))
        bot.send_message(cid,
            f"🔑 *Yangi ustoz kaliti:*\n\n`{key}`\n\n"
            "⚠️ Faqat *bir marta* ishlatiladi",
            parse_mode="Markdown", reply_markup=kb)
    except Exception as e:
        bot.send_message(cid, f"❌ Xato: {e}")

@bot.message_handler(commands=['getkey'])
def handle_getkey(m): send_new_key(m.chat.id)

@bot.message_handler(commands=['keys'])
def handle_keys(m):
    try:
        keys = get_keys()
        if not keys: bot.send_message(m.chat.id, "📭 Kalit yo'q."); return
        text = "🗝 *Kalitlar:*\n\n"
        for k in keys:
            st = "✅" if k["used"] else "⏳"
            d  = k["created_at"][:16].replace("T"," ")
            text += f"{st} `{k['key']}`\n{d}\n\n"
        bot.send_message(m.chat.id, text, parse_mode="Markdown")
    except Exception as e:
        bot.send_message(m.chat.id, f"❌ {e}")

@bot.message_handler(commands=['stats'])
def handle_stats(m):
    try:
        keys     = supa_get("/rest/v1/keys?select=used")
        teachers = get_teachers()
        used     = sum(1 for k in keys if k["used"])
        bot.send_message(m.chat.id,
            f"📊 *Statistika:*\n\n"
            f"🔑 Kalitlar: *{len(keys)}* (ishlatilgan: *{used}*)\n"
            f"👨‍🏫 Ustozlar: *{len(teachers)}* ta",
            parse_mode="Markdown")
    except Exception as e:
        bot.send_message(m.chat.id, f"❌ {e}")

@bot.message_handler(commands=['teachers'])
def handle_teachers(m):
    try:
        teachers = get_teachers()
        if not teachers: bot.send_message(m.chat.id, "📭 Ustoz yo'q."); return
        text = f"👨‍🏫 *Ustozlar ({len(teachers)} ta):*\n\n"
        for t in teachers:
            d = t.get("created_at","")[:10]
            text += f"👤 *{t['name']}* | 📱 {t['phone']} | 🔑 `{t['login']}` | {d}\n\n"
        bot.send_message(m.chat.id, text, parse_mode="Markdown")
    except Exception as e:
        bot.send_message(m.chat.id, f"❌ {e}")

@bot.callback_query_handler(func=lambda c: True)
def handle_cb(call):
    bot.answer_callback_query(call.id)
    if   call.data == "getkey"   : send_new_key(call.message.chat.id)
    elif call.data == "stats"    : handle_stats(call.message)
    elif call.data == "teachers" : handle_teachers(call.message)
    elif call.data == "keys"     : handle_keys(call.message)

if __name__ == "__main__":
    _sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    _sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        _sock.bind(("127.0.0.1", 47399))
    except OSError:
        print("⚠️  Bot allaqachon ishlab turibdi!"); sys.exit(1)

    try:
        requests.get(f"https://api.telegram.org/bot{BOT_TOKEN}/deleteWebhook?drop_pending_updates=true", timeout=8)
    except: pass

    print("=" * 50)
    print("  Teacher Dashboard Bot — ishga tushdi!")
    print(f"  Supabase: {SUPA_URL[:35]}...")
    print("=" * 50)

    bot.infinity_polling(timeout=30, long_polling_timeout=30, skip_pending=True)
