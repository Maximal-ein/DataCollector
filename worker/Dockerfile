# Build TypeScript and keep workspace links for the runtime image.
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS build

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# npm 10.9.0 in this base image hangs while resolving this workspace lockfile.
RUN npm install --global npm@10.9.9 --no-audit --no-fund

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY db/package.json db/package.json
COPY db/prisma db/prisma
COPY core/package.json core/package.json
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --include=dev --no-audit --no-fund --foreground-scripts

COPY shared shared
COPY db db
COPY core core
COPY worker worker

RUN npm run generate -w db
RUN npm run build:libs && npm run build -w worker
RUN npm prune --omit=dev --no-audit --no-fund

# Match the installed Playwright version exactly.
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY --from=build /app/ ./

CMD ["node", "worker/dist/index.js"]
