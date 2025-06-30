#!/bin/bash

echo "Starting Deployment..."

echo "Stopping elohr..."
pm2 stop elohr

echo "Removing old files..."
sudo rm -r nitro.json public/ server/

echo "Unzipping elohr.zip..."
unzip elohr.zip -d .

# echo "Ensuring Node.js LTS 22 is installed..."
# if ! command -v node &>/dev/null || [[ $(node -v) != *"v22"* ]]; then
#   echo "Installing Node.js LTS 22..."
#   # Use NVM if available, otherwise install directly
#   if command -v nvm &>/dev/null; then
#     nvm install 22 && nvm use 22
#   else
#     # Add NodeSource repository and install Node.js 22
#     curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
#     sudo apt-get install -y nodejs
#   fi
# fi

# echo "Ensuring pnpm v10.10 is installed..."
# if ! command -v pnpm &>/dev/null || [[ $(pnpm --version) != "10.10."* ]]; then
#   echo "Installing pnpm v10.10..."
#   npm install -g pnpm@10.10
# fi

# echo "Installing dependencies..."
# cd ./server || exit
# # Use the correct version of Node and pnpm
# NODE_VERSION=$(node -v)
# PNPM_VERSION=$(pnpm --version)
# echo "Using Node.js $NODE_VERSION and pnpm $PNPM_VERSION"
# pnpm i || {
#   echo "pnpm install failed"
#   exit 1
# }
# cd ..

echo "Install libs for puppeteer..."
# Install dependencies
sudo apt update && sudo apt install -y gconf-service libgbm-dev libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget

echo "Installing Chrome..."
# Install Chromium browser
sudo apt install -y chromium-browser

# Clean up
sudo apt autoremove -y
sudo apt clean

echo "Starting elohr..."
pm2 restart elohr --time

echo "Removing elohr.zip..."
rm elohr.zip
