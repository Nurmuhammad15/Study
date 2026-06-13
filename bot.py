#!/usr/bin/env python3
"""
Teacher Dashboard - Telegram Bot (Neon PostgreSQL versiya)
pip install pytelegrambotapi psycopg2-binary python-dotenv
"""

import telebot, random, string, time, sys, socket, os
import psycopg2, psycopg2.extras
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BOT_TOKEN  = os.environ.get("BOT_TOKEN", "8553083980:AAGHrhOS8Z9OX4a4QKGk3BnV3psxtSZvtjo")
DB_URL     = os.environ.get("DATABASE_URL", "postgresql://neondb_owner:npg_tOJGy8Xg4ape@ep-divine-moon-aplydm8b.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require")



bot = telebot.TeleBot(BOT_TOKEN)

# ── Database ─────────────────────────────────
def get_conn():
    return psycopg2.connect(DB_URL)

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
    print("✅ Jadvallar tayyor")

def add_key(key):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO keys (key) VALUES (%s)", (key,))
        conn.commit()

def check_and_use_key(key):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM keys WHERE key=%s AND used=false", (key,))
            row = cur.fetchone()
            if row:
                cur.execute("UPDATE keys SET used=true WHERE key=%s", (key,))
                conn.commit()
                return True
    return False

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

def save_teacher(name, login, passw, phone):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO teachers (name, login, pass, phone) VALUES (%s,%s,%s,%s)",
                (name, login, passw, phone)
            )
        conn.commit()

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

# ── Bot handlerlari ──────────────────────────
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
            "⚠️ Faqat *bir marta* ishlatiladi\n"
            "📋 Ustozga yuboring",
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
            d  = str(k["created_at"])[:16]
            text += f"{st} `{k['key']}`\n{d}\n\n"
        bot.send_message(m.chat.id, text, parse_mode="Markdown")
    except Exception as e:
        bot.send_message(m.chat.id, f"❌ {e}")

@bot.message_handler(commands=['stats'])
def handle_stats(m):
    try:
        total, used, teachers = get_stats()
        bot.send_message(m.chat.id,
            f"📊 *Statistika:*\n\n"
            f"🔑 Kalitlar: *{total}* (ishlatilgan: *{used}*)\n"
            f"👨‍🏫 Ustozlar: *{teachers}* ta",
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
            d = str(t.get("created_at",""))[:10]
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

# ── MAIN ────────────────────────────────────
if __name__ == "__main__":
    _sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    _sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        _sock.bind(("127.0.0.1", 47399))
    except OSError:
        print("⚠️  Bot allaqachon ishlab turibdi!"); sys.exit(1)

    # Webhook tozalash
    try:
        import requests as _r
        _r.get(f"https://api.telegram.org/bot{BOT_TOKEN}/deleteWebhook?drop_pending_updates=true", timeout=8)
    except: pass

    # Jadvallarni yaratish
    init_db()

    print("=" * 50)
    print("  Teacher Dashboard Bot — Neon versiya")
    print("=" * 50)
    print("  /getkey   — kalit yaratish")
    print("  /keys     — barcha kalitlar")
    print("  /stats    — statistika")
    print("  /teachers — ustozlar")
    print("  Ctrl+C    — to'xtatish")
    print("=" * 50)

    bot.infinity_polling(timeout=30, long_polling_timeout=30, skip_pending=True)