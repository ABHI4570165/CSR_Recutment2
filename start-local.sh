#!/bin/bash
set -e
echo "============================================"
echo " Mandi Hariyanna Academy — Quiz Platform"
echo " Local Development Startup"
echo "============================================"

# Check Redis
if ! redis-cli ping > /dev/null 2>&1; then
  echo "⚠  Redis not running. Attempting to start..."
  sudo service redis-server start 2>/dev/null || \
  sudo systemctl start redis 2>/dev/null || \
  echo "   Please start Redis manually: sudo service redis-server start"
fi

# Backend
echo ""
echo "▶  Starting Backend (port 5000)..."
cd "$(dirname "$0")/backend"
if [ ! -d node_modules ]; then
  echo "   Installing backend dependencies..."
  npm install
fi
npm run dev &
BACKEND_PID=$!

# Frontend
echo ""
echo "▶  Starting Frontend (port 5173)..."
cd "../frontend"
if [ ! -d node_modules ]; then
  echo "   Installing frontend dependencies..."
  npm install
fi
npm run dev &
FRONTEND_PID=$!

echo ""
echo "============================================"
echo "  ✅  App is running!"
echo "  📝  Register : http://localhost:5173"
echo "  🔐  Admin    : http://localhost:5173/admin"
echo "  🔌  API      : http://localhost:5000/api/health"
echo "============================================"
echo "  Press Ctrl+C to stop all servers"
echo ""

# Wait for both
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'; exit" INT TERM
wait
