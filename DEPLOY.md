# 🚀 Deployment Guide — Render (Backend) + Hostinger (Frontend)

---

## Overview

```
Student Browser
      │
      ├─► Hostinger (frontend)  ← static React build
      │         │  /api/* calls
      └─► Render (backend)      ← Node.js + Express
                │
                ├─► MongoDB Atlas (free cluster)
                └─► Redis Cloud (free tier — optional)
```

---

## PART 1 — MongoDB Atlas (Database)

### Step 1 — Create Free Cluster
1. Go to **https://cloud.mongodb.com** → Sign up / Log in
2. Click **"Build a Database"** → Choose **Free (M0)**
3. Select **AWS → Mumbai (ap-south-1)** for India
4. Cluster name: `mha-quiz-cluster` → Click **"Create"**

### Step 2 — Create Database User
1. Left sidebar → **Database Access** → **Add New Database User**
2. Authentication: **Password**
3. Username: `mha_admin`
4. Password: Click **"Autogenerate Secure Password"** → **copy it now**
5. Role: **"Atlas admin"** → Click **"Add User"**

### Step 3 — Allow All IP Addresses
1. Left sidebar → **Network Access** → **Add IP Address**
2. Click **"Allow Access From Anywhere"** (adds `0.0.0.0/0`)
   > This is needed because Render's IPs change. For production security, whitelist Render static IPs if on a paid plan.
3. Click **"Confirm"**

### Step 4 — Get Connection String
1. Left sidebar → **Database** → Click **"Connect"** on your cluster
2. Choose **"Drivers"** → Driver: **Node.js** → Version: **5.5 or later**
3. Copy the connection string — it looks like:
   ```
   mongodb+srv://mha_admin:<password>@mha-quiz-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<password>` with the password you copied in Step 2
5. Add the database name before `?`:
   ```
   mongodb+srv://mha_admin:YourPassword@mha-quiz-cluster.xxxxx.mongodb.net/mha_quiz?retryWrites=true&w=majority
   ```
6. **Save this URI — you'll need it for Render**

---

## PART 2 — Render (Backend)

### Step 1 — Push Backend to GitHub
You need your code on GitHub first.

```bash
# Inside the quiz-app folder
cd quiz-app

# Initialize git (if not done)
git init
git add .
git commit -m "Initial commit — MHA Quiz"

# Create a new repo on github.com first, then:
git remote add origin https://github.com/YOUR_USERNAME/mha-quiz.git
git branch -M main
git push -u origin main
```

> **Tip:** If you don't want to use git, Render also supports uploading a zip — see Step 3 alternative.

### Step 2 — Create Render Account
1. Go to **https://render.com** → Sign up (free)
2. Connect your GitHub account when prompted

### Step 3 — Create a Web Service
1. Dashboard → **"New +"** → **"Web Service"**
2. Connect your GitHub repo → Select `mha-quiz`
3. Configure:

| Field | Value |
|---|---|
| **Name** | `mha-quiz-api` |
| **Region** | Singapore (closest to India) |
| **Branch** | `main` |
| **Root Directory** | `quiz-app/backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Plan** | `Free` |

4. Click **"Advanced"** → Add the following environment variables:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `MONGO_URI` | *(paste your Atlas URI from Part 1)* |
| `JWT_SECRET` | *(click "Generate" or paste 64 random chars)* |
| `ADMIN_JWT_SECRET` | *(click "Generate" or paste different 64 random chars)* |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | *(your strong password)* |
| `FRONTEND_URL` | `https://yourdomain.com` *(add after Hostinger setup — use * temporarily)* |
| `REDIS_URL` | *(leave empty for now — add later if needed)* |

5. Click **"Create Web Service"**
6. Wait 3–5 minutes for the first deploy to complete

### Step 4 — Seed the Database
Once deployed, open Render's **Shell** tab:
```bash
node seed.js
```
This inserts 60 questions and default quiz config.

### Step 5 — Get Your Backend URL
After deploy, Render gives you a URL like:
```
https://mha-quiz-api.onrender.com
```
**Copy this — you need it for the frontend build.**

### Step 6 — Test Backend
Open in browser:
```
https://mha-quiz-api.onrender.com/api/health
```
Should return: `{"status":"ok","ts":...,"env":"production"}`

> ⚠️ **Render Free Plan Note:** Free services sleep after 15 minutes of inactivity and take ~30 seconds to wake up on the first request. To prevent this, use a free uptime monitor like **UptimeRobot** to ping `/api/health` every 14 minutes.

---

## PART 3 — Frontend Build (for Hostinger)

### Step 1 — Create Production Environment File
In your `quiz-app/frontend/` folder, create a file named `.env.production`:
```env
VITE_API_URL=https://mha-quiz-api.onrender.com
```
Replace the URL with your actual Render URL from Part 2 Step 5.

### Step 2 — Build the Frontend
```bash
cd quiz-app/frontend
npm install
npm run build
```
This creates a `dist/` folder with all static files.

### Step 3 — Prepare the ZIP for Upload
```bash
cd dist
zip -r ../frontend-dist.zip .
```
Or on Windows: right-click the `dist` folder → "Send to" → "Compressed folder"

---

## PART 4 — Hostinger (Frontend Hosting)

### Option A — Hostinger Static Website (Recommended — cheapest)

#### Step 1 — Buy Hosting
1. Go to **https://hostinger.com** → Plans → **Premium** or **Business** (starting ~₹149/month)
2. Or use **Hostinger's free static hosting** if available on your plan

#### Step 2 — Point Domain (if you have one)
1. Hostinger Dashboard → **Domains** → Add/manage your domain
2. Or use the free Hostinger subdomain: `yourname.hostinger-free.com`

#### Step 3 — Upload Files via File Manager
1. Hostinger hPanel → **File Manager**
2. Navigate to `public_html/` (this is your website root)
3. Delete any existing files (default page)
4. Click **Upload** → Upload your `frontend-dist.zip`
5. Right-click the zip → **Extract** → Extract to `public_html/`
6. Verify these files exist in `public_html/`:
   - `index.html`
   - `assets/` folder

#### Step 4 — Fix React Router (SPA routing)
React Router needs all URLs to serve `index.html`. Create a `.htaccess` file:

1. In File Manager, inside `public_html/`, click **New File** → name it `.htaccess`
2. Add this content:
```apache
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [QSA,L]
```
3. Save the file

#### Step 5 — Enable HTTPS
1. Hostinger hPanel → **SSL** → Enable **Free SSL (Let's Encrypt)**
2. Wait 5–10 minutes for SSL to activate

### Option B — Hostinger with FTP (Alternative)
1. hPanel → **FTP Accounts** → note the FTP host, username, password
2. Use **FileZilla** (free) to connect
3. Upload all files from `dist/` to `public_html/`

---

## PART 5 — Final Configuration

### Update CORS on Render
Now that you have your Hostinger URL, update the environment variable on Render:

1. Render Dashboard → Your service → **Environment**
2. Update `FRONTEND_URL` to your actual Hostinger URL:
   ```
   https://yourdomain.com
   ```
3. Click **"Save Changes"** → Service redeploys automatically

### Verify Full Flow
1. Open `https://yourdomain.com` — Registration page loads
2. Register with your details → Quiz Ready page opens
3. Agree to T&C → Click Start → Fullscreen activates
4. Complete a few questions → Submit
5. Result page shows "Thank You" message
6. Admin: `https://yourdomain.com/admin` → Login works

---

## PART 6 — Optional: Redis Cloud (Free Cache)

If you want caching enabled on Render:

1. Go to **https://redis.io/try-free** → Create free account
2. Create a free database → Region: **AWS ap-south-1**
3. After creation → Click your database → **"Connect"**
4. Copy the **Public endpoint** URL — looks like:
   ```
   redis://default:password@redis-xxxxx.c1.ap-south-1-1.ec2.redns.redis-cloud.com:12345
   ```
5. In Render → Environment → Add:
   ```
   REDIS_URL = redis://default:password@redis-xxxxx...
   ```
6. Service redeploys → Redis connected

---

## PART 7 — UptimeRobot (Prevent Render Sleep)

Render free tier sleeps after 15 minutes inactivity.

1. Go to **https://uptimerobot.com** → Free account
2. **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `MHA Quiz API`
   - URL: `https://mha-quiz-api.onrender.com/api/health`
   - Monitoring Interval: **5 minutes**
3. Click **"Create Monitor"**

This pings your backend every 5 minutes, keeping it awake 24/7.

---

## Quick Reference — Environment Variables for Render

```
NODE_ENV          = production
PORT              = 10000
MONGO_URI         = mongodb+srv://mha_admin:PASSWORD@cluster.mongodb.net/mha_quiz?retryWrites=true&w=majority
JWT_SECRET        = [64 random characters]
ADMIN_JWT_SECRET  = [different 64 random characters]
ADMIN_USERNAME    = admin
ADMIN_PASSWORD    = [your strong password]
FRONTEND_URL      = https://yourdomain.com
REDIS_URL         = [Redis Cloud URL — optional]
```

## Quick Reference — Frontend .env.production

```
VITE_API_URL = https://mha-quiz-api.onrender.com
```

---

## Troubleshooting

### "Failed to fetch" or network errors on Hostinger
- Check `VITE_API_URL` in `.env.production` is correct and no trailing slash
- Rebuild frontend and re-upload `dist/` after any `.env.production` change
- Check Render service is running (not sleeping)

### CORS error in browser console
- Add your Hostinger domain to `FRONTEND_URL` in Render environment variables
- Make sure URL has no trailing slash: `https://yourdomain.com` not `https://yourdomain.com/`
- Redeploy Render after changing env vars

### 404 on page refresh (e.g. /quiz or /admin)
- Ensure `.htaccess` file is in `public_html/` with the RewriteRule content above
- Check Hostinger hPanel → Apache/PHP → `.htaccess` is allowed

### Render deploy fails
- Check Build Logs in Render dashboard
- Common fix: make sure `Root Directory` is set to `quiz-app/backend` (not `quiz-app`)

### Admin can't login
- Check `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Render env vars
- Passwords are case-sensitive

### Quiz already seeded / want to re-seed
- Render Shell → `node seed.js` (this deletes all questions and re-inserts)

### Render service URL changes
- Free plan keeps the same URL after redeployment
- Update `VITE_API_URL` in `.env.production`, rebuild frontend, re-upload to Hostinger
