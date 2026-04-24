@echo off
echo ============================================
echo  Mandi Hariyanna Academy - Quiz Platform
echo  Local Development Startup
echo ============================================

echo.
echo Starting Backend (port 5000)...
cd backend
if not exist node_modules (
    echo Installing backend dependencies...
    call npm install
)
start "MHA Backend" cmd /k "npm run dev"

echo.
echo Starting Frontend (port 5173)...
cd ..\frontend
if not exist node_modules (
    echo Installing frontend dependencies...
    call npm install
)
start "MHA Frontend" cmd /k "npm run dev"

echo.
echo ============================================
echo   App is running!
echo   Register : http://localhost:5173
echo   Admin    : http://localhost:5173/admin
echo   API      : http://localhost:5000/api/health
echo ============================================
pause
