# Mandi Hariyanna Academy — Online Quiz Platform
**Mandi Harish Foundation**

High-performance online quiz system — 200-300 concurrent users — anti-malpractice — dynamic sections.

---

## Tech Stack & Exact Versions

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 18.2.0 | UI library |
| React DOM | 18.2.0 | DOM rendering |
| React Router DOM | 6.21.1 | Client-side routing |
| Vite | 5.0.8 | Build tool and dev server |
| @vitejs/plugin-react | 4.2.1 | React Fast Refresh |
| Axios | 1.6.2 | HTTP client |
| SheetJS (xlsx) | 0.18.5 | Excel export |
| Tailwind-inspired CSS | custom | Light purple/indigo theme |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Node.js | 18.x or 20.x LTS | JavaScript runtime |
| Express.js | 4.18.2 | Web framework |
| Mongoose | 8.0.3 | MongoDB ODM |
| ioredis | 5.3.2 | Redis client (optional) |
| jsonwebtoken | 9.0.2 | JWT authentication |
| bcryptjs | 2.4.3 | Password hashing |
| compression | 1.7.4 | Gzip response compression |
| cors | 2.8.5 | Cross-origin resource sharing |
| helmet | 7.1.0 | HTTP security headers |
| express-rate-limit | 7.1.5 | API rate limiting |
| morgan | 1.10.0 | HTTP request logging |
| dotenv | 16.3.1 | Environment variable loading |
| xlsx | 0.18.5 | Excel file generation |
| nodemon | 3.0.2 | Dev auto-restart |

### Database and Cache
| Technology | Version | Purpose |
|---|---|---|
| MongoDB | 6.x / 7.x | Primary database |
| MongoDB Atlas | cloud | Production database |
| Redis | 6.x / 7.x | Question cache + session cache |

### Infrastructure (Production)
| Technology | Purpose |
|---|---|
| NGINX latest stable | Reverse proxy, gzip, SSL termination |
| PM2 latest | Node.js cluster mode process manager |
| Ubuntu 22.04 LTS | VPS operating system |
| Let's Encrypt + Certbot | Free SSL/HTTPS certificates |

---

## Quick Start — Local Development

### Prerequisites
- Node.js 18 or newer (nodejs.org)
- MongoDB running locally OR a MongoDB Atlas URI
- Redis (optional — app works without it, shows one warning)
  - Linux: sudo apt install redis-server
  - Mac: brew install redis

### 1 — Extract and Setup
```bash
unzip mha-quiz.zip
cd quiz-app
bash setup.sh
```
setup.sh installs all dependencies and seeds 60 questions.

### 2 — Configure Backend
```bash
cd backend
cp .env.example .env
# Edit .env with a text editor
# Minimum required changes:
#   JWT_SECRET       -> change to any 32+ character random string
#   ADMIN_JWT_SECRET -> change to a DIFFERENT 32+ character random string
# Optional:
#   MONGO_URI        -> change if MongoDB is not on localhost
#   ADMIN_USERNAME / ADMIN_PASSWORD -> change default credentials
```

### 3 — Start (Linux or Mac)
```bash
bash start-local.sh
```

### 3 — Start (Windows)
Double-click start-local.bat
OR open two separate terminals:
- Terminal 1: cd backend && npm run dev
- Terminal 2: cd frontend && npm run dev

### 4 — Open Browser
| Page | URL |
|---|---|
| Student Registration | http://localhost:5173 |
| Admin Dashboard | http://localhost:5173/admin |
| API Health | http://localhost:5000/api/health |

Default admin login:
  Username: admin
  Password: Admin@123!

---

## Environment Variables (backend/.env)

```
PORT=5000
NODE_ENV=development

MONGO_URI=mongodb://localhost:27017/mha_quiz

JWT_SECRET=replace_with_64_random_chars
JWT_EXPIRES_IN=7d
ADMIN_JWT_SECRET=replace_with_different_64_random_chars

ADMIN_USERNAME=admin
ADMIN_PASSWORD=Admin@123!

REDIS_URL=redis://localhost:6379

FRONTEND_URL=http://localhost:5173

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

---

## VPS Deployment (Ubuntu 22.04, 4GB RAM)

### Step 1 — Install dependencies
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs nginx redis-server unzip
sudo systemctl enable redis-server && sudo systemctl start redis-server
sudo npm install -g pm2
```

### Step 2 — Upload and extract
```bash
# From your local machine:
scp mha-quiz.zip user@YOUR_VPS_IP:/var/www/
# On the VPS:
cd /var/www && unzip mha-quiz.zip && cd quiz-app
```

### Step 3 — Configure backend
```bash
cd backend
cp .env.example .env
nano .env   # Set MONGO_URI to Atlas URL, set strong JWT secrets, NODE_ENV=production
npm install --production
node seed.js
```

### Step 4 — Build frontend
```bash
cd ../frontend
npm install
npm run build
```

### Step 5 — Configure NGINX
```bash
sudo cp /var/www/quiz-app/nginx.conf /etc/nginx/sites-available/mha-quiz
sudo nano /etc/nginx/sites-available/mha-quiz  # Replace your-domain.com
sudo ln -sf /etc/nginx/sites-available/mha-quiz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Step 6 — SSL (HTTPS)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Step 7 — Start with PM2
```bash
cd /var/www/quiz-app
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # Run the exact command it prints
```

### Step 8 — Verify
```bash
pm2 list
pm2 logs
curl http://localhost:5000/api/health
```

---

## Project Structure

```
quiz-app/
├── backend/
│   ├── controllers/
│   │   ├── authController.js       Registration, admin login, token verify
│   │   ├── quizController.js       Start quiz, auto-save, submit, score
│   │   ├── adminController.js      Stats, users, attempts, sections, cutoff
│   │   └── questionController.js   Question CRUD
│   ├── middleware/
│   │   ├── auth.js                 JWT middleware (student + admin)
│   │   └── rateLimit.js            Rate limiters
│   ├── models/
│   │   ├── User.js                 Student with indexes
│   │   ├── Question.js             Supports dynamic sections
│   │   ├── QuizAttempt.js          Attempt tracking
│   │   └── QuizConfig.js           Settings + section definitions
│   ├── routes/                     auth, quiz, admin, questions
│   ├── utils/
│   │   ├── redis.js                Redis client (graceful no-crash fallback)
│   │   └── email.js                Email utility (unused - direct quiz flow)
│   ├── server.js
│   ├── seed.js
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── RegisterPage.jsx/css        Registration form
│   │   │   ├── QuizReadyPage.jsx/css       Instructions + T&C + Start
│   │   │   ├── QuizPage.jsx/css            Full quiz engine
│   │   │   └── AdminDashboard.jsx/css      Admin panel (6 tabs)
│   │   ├── utils/api.js                    All API calls
│   │   ├── styles/global.css               CSS variables + reset
│   │   └── main.jsx                        Router + app entry
│   ├── public/logo.png
│   ├── vite.config.js
│   └── package.json
├── nginx.conf
├── ecosystem.config.js
├── start-local.sh / .bat
├── setup.sh
└── README.md
```

---

## Features

### Student
- Registration -> instant quiz access (no email)
- Terms and Conditions with checkbox (must agree before start)
- Start button triggers fullscreen (user gesture = works on all browsers)
- 60 questions across dynamic sections (Aptitude, Logical, English + custom)
- Questions and options shuffled per attempt
- 5-state Question Palette: Not Visited / Not Answered / Answered / Review / Answered+Review
- Mark for Review + Clear Answer buttons
- Section tab navigation
- Auto-save every 10 seconds
- Server-enforced timer
- Anti-malpractice: fullscreen monitoring, tab switch, window blur
- Blocking violation modal (count + dots progress)
- 4 violations = auto-submit
- Result page shows only submission confirmation (no score — official announcement)

### Admin (at /admin — not public)
- Dashboard: total, started, completed, passed, average score
- Students: search, filter, paginate, delete, export Excel
- Attempts: filter by status/result/malpractice, export Excel
- Questions: add/edit/delete by section, live counts per section
- Cutoff Filter: preview students above score X, export to Excel
- Settings:
  - Time limit and passing score (internal)
  - Add new custom sections (name, display name, question count, color)
  - Edit existing sections
  - Delete sections

### Performance
- Redis caching (questions + config, 1h TTL)
- MongoDB lean() queries + indexes
- PM2 cluster mode
- NGINX gzip + proxy
- Rate limiting (general + auth + submit)
- Redis graceful fallback (no crash if Redis unavailable)

---

## Common Issues

### Redis warning on startup
```
Warning: Redis unavailable: connect ECONNREFUSED 127.0.0.1:6379
Running without cache
```
Normal in development. App works fully. Start Redis to enable caching:
  sudo service redis-server start

### Fullscreen blocked on mobile
This is fixed. The "Start Quiz Now" button click IS the user gesture.
Safari on iOS does not support fullscreen API — quiz still works normally.

### Already registered error
Each email and roll number can only register once. Use a different email to test.

### MongoDB connection refused
Start MongoDB: sudo service mongod start
For Atlas: check your IP is whitelisted in Atlas Network Access.
