#!/bin/bash
# Run this script to build frontend for Hostinger upload
# Usage: bash build-frontend.sh https://your-render-url.onrender.com

RENDER_URL=${1:-"https://mha-quiz-api.onrender.com"}

echo "============================================"
echo " MHA Quiz — Frontend Build for Hostinger"
echo " Backend URL: $RENDER_URL"
echo "============================================"

cd "$(dirname "$0")/frontend"

# Write production env file
echo "VITE_API_URL=$RENDER_URL" > .env.production
echo "✅  Created .env.production"

# Install and build
npm install
npm run build

if [ $? -eq 0 ]; then
  echo ""
  echo "============================================"
  echo "  Build successful!"
  echo "  Upload the 'frontend/dist/' folder"
  echo "  contents to Hostinger public_html/"
  echo "  Don't forget to add .htaccess file!"
  echo "============================================"
else
  echo "Build failed. Check errors above."
  exit 1
fi
