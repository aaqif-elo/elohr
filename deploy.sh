#!/bin/bash

pm2 stop elohr
rm -r nitro.json public/ server/
unzip elohr.zip -d .
rm elohr.zip
cd ./server || exit
pnpm i
cd ..
pm2 restart elohr --time