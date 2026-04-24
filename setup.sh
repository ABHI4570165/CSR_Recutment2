#!/bin/bash
echo "=== MHA Quiz — First-Time Setup ==="

# Backend
echo "1. Installing backend dependencies..."
cd "$(dirname "$0")/backend"
npm install

echo "2. Seeding database (60 questions + config)..."
node seed.js

echo "3. Installing frontend dependencies..."
cd ../frontend
npm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start: cd .. && bash start-local.sh"
echo "  OR for Windows: start-local.bat"
