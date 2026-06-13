#!/usr/bin/env python3
"""
Webhook o'rnatish skripti.
Deploy qilgandan keyin BIR MARTA ishga tushiring:

  python set_webhook.py https://your-project.vercel.app
"""
import sys, urllib.request, json, os

BOT_TOKEN  = os.environ.get("BOT_TOKEN") or input("BOT_TOKEN kiriting: ").strip()
VERCEL_URL = (sys.argv[1] if len(sys.argv) > 1 else
              input("Vercel URL (masalan https://study-abc.vercel.app): ").strip())

webhook_url = f"{VERCEL_URL.rstrip('/')}/api/webhook"
print(f"\n🔗 Webhook URL: {webhook_url}")

url  = f"https://api.telegram.org/bot{BOT_TOKEN}/setWebhook"
data = json.dumps({"url": webhook_url, "drop_pending_updates": True}).encode()
req  = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

resp   = urllib.request.urlopen(req)
result = json.loads(resp.read())

if result.get("ok"):
    print("✅ Webhook muvaffaqiyatli o'rnatildi!")
else:
    print(f"❌ Xato: {result}")
