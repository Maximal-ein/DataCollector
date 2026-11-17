# AGENTS.md — DataCollector

## 1. О проекте и текущем состоянии
Приложение для сбора данных о строительных объектах (МГЭ, МГЗ, СУИД, Дашборд, Google Sheets, Yandex Tables 360) в PostgreSQL с React SPA.
Предыдущий агент (Z.ai) реализовал архитектуру, схему БД, backend REST API, воркер МГЭ и импорт из Excel.

## 2. Стек и окружение
- **Backend/Worker:** Node.js, TypeScript, Fastify, Playwright, pg-boss.
- **Frontend:** React SPA (Vite).
- **БД:** PostgreSQL.
- **Окружение:** Windows (локальная разработка), WebStorm, Docker Desktop, PowerShell.

## 3. Критическая проблема и главная цель
**Цель:** Настроить Docker-развертывание так, чтобы `docker compose up -d` поднимал все сервисы (postgres, api, worker, frontend) без ошибок, чтобы проект можно было легко перенести на сервер.
**Временное решение (костыль):** Сейчас воркер запускается локально через `npm run start -w worker`, потому что в Docker он падает с ошибкой `Cannot find package '@dc/core' imported from /app/worker/src/sources/mge/handler.ts` при использовании `tsx`.
**Задача для тебя:** Исправить `worker/Dockerfile` и/или `tsconfig`, чтобы воркер работал в Docker. Скорее всего, нужно отказаться от `tsx` в production-сборке и использовать стандартную компиляцию через `tsc` (создать `dist` и запускать `node dist/index.js`), либо правильно настроить ESM-разрешение путей для workspaces.

## 4. Текущие задачи и приоритеты
1. **Высокий приоритет:** Починить Docker-сборку воркера (см. п.3).
2. **Высокий приоритет:** Проверить работу воркера МГЭ. Нужно запустить `npm run login:mge` (для сохранения сессии в БД), затем сделать тестовый сбор через `POST /api/collect` и убедиться, что данные сохраняются.
3. **Низкий приоритет (следующий этап):** Воркеры для МГЗ, СУИД, Дашборда (на общей сессии СУДИР).

## 5. Важные команды
- `docker compose up -d --build` — пересобрать и запустить всё в Docker.
- `docker compose logs -f worker` — смотреть логи воркера в Docker.
- `npm run login:mge` — вход в МГЭ (откроется браузер).
- `POST /api/collect` — запуск сбора (через `Invoke-RestMethod` в PowerShell).

## 6. Правила и ограничения
- **Не менять схему БД** без явного запроса.
- **Не трогать** `browser.ts`, `sites.ts`, `handler.ts` без необходимости — это общий слой, который сейчас проверяется на реальном сайте.
- Перед изменением кода **всегда** проверяй типы (`npm run typecheck`).