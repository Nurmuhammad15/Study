#!/usr/bin/env python3
"""
Webhook o'rnatish — bir marta ishga tushiring:
  python set_webhook.py https://study-zeta-neon.vercel.app
"""
import sys, urllib.request, json, os

BOT_TOKEN  = os.environ.get("BOT_TOKEN") or "8553083980:AAGHrhOS8Z9OX4a4QKGk3BnV3psxtSZvtjo"
VERCEL_URL = sys.argv[1] if len(sys.argv) > 1 else input("Vercel URL: ").strip()

webhook_url = f"{VERCEL_URL.rstrip('/')}/api/webhook"
url  = f"https://api.telegram.org/bot{BOT_TOKEN}/setWebhook"
data = json.dumps({"url": webhook_url, "drop_pending_updates": True}).encode()
req  = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
result = json.loads(urllib.request.urlopen(req).read())
print("✅ OK!" if result.get("ok") else f"❌ {result}")
