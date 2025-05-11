#!/bin/bash

echo "Starting Deployment..."

echo "Stopping elohr..."
pm2 stop elohr

echo "Removing old files..."
rm -r nitro.json public/ server/

echo "Unzipping elohr.zip..."
unzip elohr.zip -d .

echo "Installing dependencies..."
cd ./server || exit
pnpm i
cd ..

echo "Starting elohr..."
pm2 restart elohr --time

echo "Removing elohr.zip..."
rm elohr.zip
