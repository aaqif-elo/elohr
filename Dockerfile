# syntax=docker/dockerfile:1.7-labs
FROM node:22-slim AS base
ENV PNPM_HOME="/usr/local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable \
  && corepack prepare pnpm@10.10.0 --activate

WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm generate

FROM deps AS build
ARG VITE_TEAM_TZ=UTC
ENV VITE_TEAM_TZ=${VITE_TEAM_TZ}
COPY public ./public
COPY src ./src
COPY app.config.ts tailwind.config.cjs tsconfig.json ./
RUN set -eux; \
  prisma_client_file=""; \
  direct_path="node_modules/.pnpm/@prisma+client@6.7.0_prisma_eae679d1c26f2888f88f5407457fe5c5/node_modules/@prisma/client/default.js"; \
  if [ -f "$direct_path" ]; then \
    prisma_client_file="$direct_path"; \
  else \
    for candidate in node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/default.js; do \
      if [ -f "$candidate" ]; then \
        prisma_client_file="$candidate"; \
        break; \
      fi; \
    done; \
  fi; \
  if [ -z "$prisma_client_file" ]; then \
    echo "ERROR: Could not find Prisma client file" >&2; \
    exit 1; \
  fi; \
  cp "$prisma_client_file" "$prisma_client_file.bak"; \
  sed -i "s|require('\\.prisma/client/default')|require('../../prisma/client/default')|g" "$prisma_client_file"
RUN pnpm exec vinxi build
# echo === Copying required files ===
RUN cp pnpm-workspace.yaml ./.output/server/pnpm-workspace.yaml
RUN cp -r node_modules/.prisma ./.output/server/node_modules/prisma

FROM build AS prod-deps
RUN pnpm prune --prod

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=2500

# Install Chromium for Puppeteer
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=prod-deps /app/.output .
EXPOSE 2500
CMD ["node", "./server/index.mjs"]
