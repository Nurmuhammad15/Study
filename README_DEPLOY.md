
---

## 🚀 Deploy qilish — bosqichma-bosqich

### 1. Kerakli narsalar
- [GitHub](https://github.com) akkount
- [Vercel](https://vercel.com) akkount (GitHub bilan kirish)
- [Neon](https://neon.tech) — bepul PostgreSQL
- Telegram Bot token — [@BotFather](https://t.me/BotFather) dan

---

### 2. GitHub ga yuklash

```bash
# 1. GitHub da yangi repo yarating (masalan: "study-app")

# 2. ZIP ni chiqarib, terminal oching:
cd Study-v3

# 3. Git sozlash:
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/SIZNING_USERNAME/study-app.git
git push -u origin main
```

---

### 3. Neon — PostgreSQL yaratish

1. [neon.tech](https://neon.tech) ga kiring
2. **New Project** → nom bering → **Create**
3. **Dashboard → Connection string** ni nusxa oling:
```
postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
```
Bu `DATABASE_URL` bo'ladi.

---

### 4. Vercel — Deploy

1. [vercel.com](https://vercel.com) → **Add New Project**
2. GitHub repo ni tanlang → **Import**
3. **Environment Variables** bo'limiga qo'shing:

| Name | Value |
|------|-------|
| `DATABASE_URL` | Neon connection string |
| `SESSION_SECRET` | Ixtiyoriy uzun kalit (masalan: `my-super-secret-key-2024`) |
| `BOT_TOKEN` | Telegram bot token |
| `SITE_URL` | `https://SIZNING-LOYIHA.vercel.app` |
| `ADMIN_SECRET` | Ixtiyoriy maxfiy kalit (masalan: `admin-secret-2024`) |

4. **Deploy** tugmasini bosing
5. Deploy tugagach URL ni oling: `https://study-xxx.vercel.app`
6. `SITE_URL` ni shu URL ga yangilang → **Redeploy**

---

### 5. Telegram Webhook sozlash

Deploy bo'lgach, brauzerda quyidagini oching:

```
https://api.telegram.org/botTOKEN/setWebhook?url=https://SIZNING-LOYIHA.vercel.app/api/webhook
```

`TOKEN` va `SIZNING-LOYIHA` ni o'zgartiring.

Javob:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

---

### 6. Test qilish

1. Telegram da botingizga yozing: `/start`
2. **Yangi dars yaratish** tugmasini bosing
3. Dars mavzusini yozing
4. Ustoz havolasini nusxa oling va brauzerda oching
5. O'quvchi havolasini boshqa brauzer/telefonda oching

---

### 7. Yangilanishlarni deploy qilish

Kodda o'zgarish bo'lganda:
```bash
git add .
git commit -m "fix: ..."
git push
```
Vercel avtomatik qayta deploy qiladi (1-2 daqiqa).

---

### Muammolar va yechimlar

| Muammo | Yechim |
|--------|--------|
| Bot javob bermaydi | Webhook to'g'ri o'rnatilganmi tekshiring |
| "Token noto'g'ri" xatosi | `SESSION_SECRET` Vercel va bot da bir xilmi? |
| Kamera ishlamaydi | Brauzerda kamera ruxsatini bering |
| Video ko'rinmaydi | TURN server bloklanganmi? VPN ishlating |
| DB ulanmaydi | `DATABASE_URL` to'g'rimi? Neon dashboard tekshiring |
