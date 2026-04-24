@echo off
set RENDER_URL=%1
if "%RENDER_URL%"=="" set RENDER_URL=https://mha-quiz-api.onrender.com

echo ============================================
echo  MHA Quiz - Frontend Build for Hostinger
echo  Backend URL: %RENDER_URL%
echo ============================================

cd frontend
echo VITE_API_URL=%RENDER_URL%> .env.production
echo Created .env.production

call npm install
call npm run build

if %ERRORLEVEL%==0 (
  echo.
  echo Build successful!
  echo Upload the 'frontend/dist/' folder to Hostinger public_html/
) else (
  echo Build failed!
)
