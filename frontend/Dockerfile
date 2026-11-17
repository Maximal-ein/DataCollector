# DataCollector Frontend: сборка Vite SPA + раздача через nginx.
# Контекст сборки — корень репозитория (нужен workspace-пакет shared).
FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY core/package.json core/package.json
COPY db/package.json db/package.json
COPY db/prisma db/prisma
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

COPY shared shared
COPY frontend frontend

RUN npm run build -w shared && npm run build -w frontend

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
