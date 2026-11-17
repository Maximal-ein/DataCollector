# DataCollector API.
# Контекст сборки — корень репозитория (см. docker-compose.yml), т.к. нужны
# рабочие пакеты shared, db и core.
#
# Базовый образ Playwright: Chromium для (1) PDF-справок (page.pdf) и
# (2) диагностического снимка МГЭ (POST /api/diagnostics/mge).
# ВАЖНО: версия базового образа должна СТРОГО совпадать с версией npm-пакета
# playwright в package.json (иначе Playwright не найдёт браузеры).
FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /app
ENV NODE_ENV=production
# браузеры уже в базовом образе — не качаем при npm ci
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# npm 10.9.0 in this base image hangs while resolving this workspace lockfile.
RUN npm install --global npm@10.9.9 --no-audit --no-fund

# Prisma engine требует openssl
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Сначала манифесты и prisma-схема — слой зависимостей кэшируется
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY db/package.json db/package.json
COPY db/prisma db/prisma
COPY core/package.json core/package.json
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --include=dev --no-audit --no-fund --foreground-scripts

# Исходники
COPY shared shared
COPY db db
COPY core core
COPY backend backend

# Тестовые шаблоны справок (в docker-compose каталог ./templates монтируется
# поверх — реальные шаблоны кладутся на хосте, без пересборки образа)
COPY templates ./templates

# prisma generate (postinstall уже генерировал при наличии схемы; повтор идемпотентен)
RUN npm run generate -w db
RUN npm run build:libs && npm prune --omit=dev --no-audit --no-fund

EXPOSE 3000

# Миграции применяются один раз при старте api (единственный владелец схемы,
# применяющий изменения; pg-boss создаёт свою схему pgboss при старте воркера)
CMD ["sh", "-c", "npm run migrate:deploy -w db && npm run start -w backend"]
