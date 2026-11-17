# DataCollector

Сбор показателей строительных объектов (~1000 объектов, 50–100 показателей) из нескольких источников — МГЭ, МГЗ, СУИД, Дашборд (порталы mos.ru, вход по логину/паролю), Google Sheets, Yandex — агрегация в PostgreSQL и React SPA для просмотра и выгрузки справок (xlsx / docx / pdf).

## Архитектура

```
          +--------------------------- SPA (React + Vite) ---------------------------+
          |  таблица (TanStack Table + virtualizer), фильтры,                          |
          |  «Обновить данные», «Скачать справку»                                      |
          +---------------+---------------------------------------+-------------------+
                          | REST (чтение)                         | REST (триггер)
                          v                                       v
          +--------------------------- API (Fastify) ------------------------------+
          |  GET /api/objects, /api/objects/:id/metrics, /api/table,                |
          |  GET /api/collect/status, GET /api/reports/:template                    |
          |  POST /api/collect (ограничение по IP)                                   |
          +---------------+---------------------------------------+-----------------+
                          |                                       |
              чтение v_metrics_unified                  pg-boss (очередь в PostgreSQL)
                          |                                       | enqueue {object_id, source}
                          v                                       v
          +----------------- PostgreSQL ----------------+   +------ WORKER (Playwright) ----+
          | objects, sources (priority),                |   | storageState СУДИР/МГЭ        |
          | metrics_mge ... metrics_yandex (история),   |<--| (AES-256-GCM в sessions),     |
          | collection_jobs, sessions,                  |   | перехват JSON, нормализация,  |
          | v_metrics_unified (materialized view)       |   | идемпотентный upsert + REFRESH|
          +---------------------------------------------+   +-------------------------------+
```

Поток данных:

1. Триггер: кнопка в SPA (`POST /api/collect`) **или** cron раз в сутки (pg-boss schedule) — обязательный fallback, чтобы данные не «застыли».
2. API создаёт записи `collection_jobs` и ставит задачи в очередь: `{object_id, source}`.
3. Воркер берёт задачу, проверяет/обновляет storageState (СУДИР — один на МГЗ/СУИД/Дашборд; МГЭ — свой), заходит на сайт.
4. Перехватывает JSON-ответы SPA (`page.on('response')`, фильтр по URL + `content-type: application/json`), нормализует (Zod), делает идемпотентный upsert в таблицу источника. Парсинг HTML — fallback.
5. После успешного сбора — `REFRESH MATERIALIZED VIEW CONCURRENTLY v_metrics_unified` (с дебаунсом, см. `.env.example`).
6. SPA читает только готовые данные. Никакой логики сбора на клиенте.

## Технические решения

| Область | Выбор | Обоснование |
|---|---|---|
| Backend | **Fastify 5** | pino «из коробки» (структурированные логи — требование), встроенная валидация, TS, плагины; Express медленнее и без встроенного логгера |
| ORM | **Prisma 6** | зрелые миграции + типизированный клиент для CRUD-части REST; кастомный SQL (materialized view, upsert с ON CONFLICT) живёт в миграциях и `$queryRaw`/`$executeRaw` |
| Очередь | **pg-boss 10** | очередь в PostgreSQL — без Redis (требование); встроенные cron-расписание, retry с backoff, dead-letter; объём ~6 тыс. задач/сутки — производительность graphile-worker не нужна. Минусы graphile-worker для нас: сборка тасков в бандл, CLI-ориентированность, преимущества по throughput не востребованы |
| Автоматизация браузера | **Playwright** | `page.on('response')` для перехвата JSON SPA-порталов, `storageState` для переиспользования сессий, изоляция контекстов; надёжнее Puppeteer для сети и состояния |
| PDF справок | **HTML+CSS → Playwright `page.pdf()`** | точная вёрстка табличных бланков; pdfmake — альтернатива без браузера, но декларативное программирование вёрстки хуже для сложных форм (итоговое решение — шаг 7) |
| Сессии | **AES-256-GCM** | storageState шифруется в worker (`iv + authTag + ciphertext`), ключ в env; СУДИР — одна запись `sessions.source_id='sudir'` на МГЗ/СУИД/Дашборд |

## Структура проекта

```
.
├── docker-compose.yml          # postgres + api + worker + frontend (nginx)
├── .env.example                # все переменные окружения с комментариями
├── package.json                # npm workspaces: общие скрипты
├── tsconfig.base.json
├── core/                       # @dc/core — общий слой: шифрование сессий (AES-256-GCM),
│                               #   конфиг сайтов (sites.ts), нечёткий матчинг названий,
│                               #   Playwright-хелперы (storageState, ensureLoggedIn)
├── shared/                     # @dc/shared — Zod-схемы, DTO, коды источников
│                               #   (без серверных зависимостей; импортируется и SPA, и api, и worker)
├── db/                         # @dc/db — Prisma-схема, миграции, клиент
│   ├── prisma/schema.prisma    #   модели всех таблиц
│   ├── prisma/migrations/      #   0001 таблицы · 0002 v_metrics_unified + refresh · 0003 сид sources
│   ├── scripts/smoke-test.sql  #   смоук-тест схемы (приоритеты, upsert, CONCURRENTLY)
│   └── src/index.ts            #   getPrisma() — синглтон на процесс
├── backend/                    # @dc/backend — Fastify REST (шаг 3)
├── worker/                     # @dc/worker — pg-boss + Playwright (шаги 4–5)
├── frontend/                   # @dc/frontend — React SPA (шаг 6)
├── scripts/                    # скрипты уровня репозитория
└── templates/                  # шаблоны справок: xlsx / docx / html (шаг 7)
```

Отличие от исходного дерева ТЗ: добавлен пакет `db/`. Prisma-клиент нужен и `backend`, и `worker`; держать его в `shared` нельзя — `shared` импортируется браузерным кодом SPA и не должен тащить серверные зависимости.

## Схема данных

| Таблица | Назначение | Ключевое |
|---|---|---|
| `objects` | строительные объекты | `external_ids` JSONB — соответствие ID объекта в системах источников (`mge_id`, `mgz_id`, `suid_id`, `dashboard_id`, `gsheets_row`, `yandex_key`) |
| `sources` | справочник источников | `code` UNIQUE (`mge`, `mgz`, `suid`, `dashboard`, `gsheets`, `yandex`, `sudir`), `priority`, `enabled`; сидируется миграцией |
| `metrics_mge` … `metrics_yandex` | показатели по источникам (6 таблиц единой структуры) | уникальный индекс `(object_id, metric_key, period, collected_at)` — идемпотентный upsert; `raw_payload` JSONB — исходный JSON для аудита; вся история `collected_at` хранится |
| `collection_jobs` | журнал задач сбора | `run_id` (группа запуска), `status` (QUEUED/ACTIVE/COMPLETED/FAILED/DEAD — dead-letter), `attempts`, `error` |
| `sessions` | зашифрованные storageState | одна запись на источник авторизации: `mge` и `sudir`; AES-256-GCM |
| `v_metrics_unified` | materialized view | конфликт `(object_id, metric_key, period)` решается по `sources.priority` DESC, затем `collected_at` DESC |

Ключевые решения схемы:

- **Идемпотентный upsert.** `collected_at` задаётся один на пачку метрик (ключ идемпотентности). Ретрай задачи с той же меткой обновляет строки (`ON CONFLICT DO UPDATE`), а не плодит дубликаты.
- **`period TEXT NOT NULL DEFAULT ''`.** NULL в колонке разрушил бы уникальный индекс и оконные функции view; непериодические метрики хранят `''`. Канонический формат: `''` / `YYYY` / `YYYY-Qn` / `YYYY-MM` (валидация в `shared/src/metrics.ts`).
- **`metric_value_num`** — дублирующее числовое значение для сортировки/агрегации в SPA (колонки-числа в таблице 1000×100).
- **Обновление view.** `refresh_unified_view()` делает обычный REFRESH (внутри PL/pgSQL-функции `CONCURRENTLY` запрещён PostgreSQL). Воркер после сбора зовёт `REFRESH MATERIALIZED VIEW CONCURRENTLY` напрямую — чтение из view не блокируется. Частота — с дебаунсом (`REFRESH_MATVIEW_EVERY`).
- **Партиционирование** — не включено. Оценка: ~600 тыс. строк на полный срез, при ежедневном сборе ~220 млн/год — Postgres это держит, но при росте истории имеет смысл RANGE-партиционирование по `collected_at` (месячные партиции). Уникальный индекс уже включает `collected_at`, поэтому миграция на партиции не потребует изменения схемы upsert. Решение отложено до ~50 млн строк.
- **Строки `sources` не удаляются** (только `enabled=false`): на них ссылается `collection_jobs` (FK RESTRICT) и от них зависит приоритет в view.

## Быстрый старт (локальная разработка)

Требования: Node.js 20+, Docker (для PostgreSQL).

```bash
cp .env.example .env          # заполнить POSTGRES_PASSWORD и SESSION_ENCRYPTION_KEY
npm run setup                 # npm install + prisma generate (postinstall)
npm run build                 # shared → db → core → worker, затем frontend

docker compose up -d postgres # поднять только БД
npm run db:migrate            # применить миграции
npm run db:smoke              # (опционально) смоук-тест схемы — внутри docker
# или без docker:             npm run db:smoke:local

# 1) импорт объектов из выгрузки СУИД (export.xlsx):
npm run import:objects --file=export.xlsx
# 2) (опционально, только dev) демо-метрики для проверки UI без реальных сайтов:
npm run seed:demo             # очистка: npm run seed:demo:clear

# 3) сессии источников (headful, один раз):
npm run login:mge             # expertiza.mos.ru, логин вручную в окне браузера
npm run login:sudir           # общая сессия МГЗ/СУИД/Дашборда (шаг 5)

npm run dev:api               # http://localhost:3000/health
npm run dev:worker            # отдельный терминал: pg-boss + Playwright
npm run dev:web               # http://localhost:5173 (прокси /api и /health)
```

Полезное: `npm run db:studio` (Prisma Studio), `npm run typecheck` (все пакеты).

Workspace packages (`@dc/shared`, `@dc/db`, `@dc/core`) load JavaScript from `dist`. Run `npm run build:libs` after editing their sources. `npm run typecheck` builds these libraries automatically. Run `npm run build` before `npm run start -w worker`; provide the environment variables when starting locally. Docker builds the libraries and worker inside the image and runs `node worker/dist/index.js`.

## Запуск в Docker (полный стек)

```bash
cp .env.example .env          # обязательно: POSTGRES_PASSWORD, SESSION_ENCRYPTION_KEY,
                              # учётки MGE_*/SUDIR_*, CRON_SCHEDULE
mkdir -p secrets              # и положить google-service-account.json (шаг 5)
docker compose up -d --build
```

- SPA: `http://<server>/` (nginx, порт 80)
- API: `http://<server>:3000/health` (проброшен на 127.0.0.1 сервера) и через nginx `/health`
- Миграции применяются автоматически при старте `api` (`prisma migrate deploy` в CMD)
- Логи: `docker compose logs -f worker api`

## Перенос на сервер (локальная сеть)

1. Установить Docker Engine + compose plugin.
2. `git clone <repo> && cd datacollector`, `cp .env.example .env`, заполнить secrets.
3. `docker compose up -d --build`.
4. Бэкап БД: `docker compose exec postgres pg_dump -U datacollector datacollector > backup_$(date +%F).sql`.
5. Обновление: `git pull && docker compose up -d --build` (миграции применятся при старте api).

## Импорт объектов (выгрузка СУИД)

```bash
npm run import:objects --file=export.xlsx
```

Маппинг колонок: A «Идентификатор проекта» → `suid_id`, B «Наименование проекта» → `name`,
C «Код ДС» → `code_ds`, D «УИН» → `uin`. Остальные колонки не импортируются.

Правила: строка обязана иметь хотя бы один идентификатор (иначе ошибка `NO_IDENTIFIER`);
upsert по приоритету `suid_id → code_ds → uin`; если разные идентификаторы одной строки
указывают на разные объекты — `IDENTIFIER_CONFLICT`. Идемпотентность: `excel_row_hash`
(SHA-256 нормализованной строки) — повторный импорт без изменений не трогает строки
(`skipped`); на записанные строки ставится `import_batch_id` (UUID запуска).

## SPA (таблица показателей)

- Сводная таблица 1000+ строк × ~100 колонок: TanStack Table + @tanstack/react-virtual
  (виртуализируются и строки, и колонки; колонки «Объект» и «Код ДС» закреплены слева).
- Фильтры: поиск по названию/коду ДС/УИН; источник — «Единые данные (view)» либо сырая
  таблица `metrics_<source>` (последний срез по (объект, ключ, период); полная история —
  в карточке объекта); период (из данных).
- В ячейках единого режима — бейдж источника-победителя (МГЭ/МГЗ/…): видно, чьё значение
  выбрано по приоритетам.
- «Обновить данные»: выбор источника и охвата (все / под текущим поиском / выбранный
  объект) → `POST /api/collect` → поллинг `/api/collect/status` до завершения → уведомление.
  Ошибки `AMBIGUOUS_MATCH` показываются со ссылкой на `npm run resolve:mge`.
- «Скачать справку»: выбор объекта/шаблона/формата — файл стримит API.
- Карточка объекта (клик по строке): метрики-победители и сырая история по источникам.
- Никакой бизнес-логики сбора на клиенте.

## Справки (шаблоны и экспорт)

Шаблоны лежат в `templates/` (в docker монтируются томом — правятся без пересборки).
Реестр строится по файлам автоматически (`GET /api/reports`):
`.xlsx` → ExcelJS, `.docx` → docx-templates, `.html` → handlebars → Chromium PDF.

```bash
curl -OJ "http://localhost:3000/api/reports/spravka?object_id=1&format=xlsx"
curl -OJ "http://localhost:3000/api/reports/spravka?object_id=1&format=pdf&period=2026-Q4"
```

Язык плейсхолдеров и повторяющиеся блоки метрик — `templates/README.md`.
Тестовые шаблоны (`spravka.*`) генерируются `npm run make:templates` — замените их
на реальные формы, сохранив id (имя файла). Ошибки: 404 шаблон/объект, 422 метрики
пусты (сначала сбор), 500 ошибка рендера.

## Диагностика МГЭ (для настройки под реальный сайт)

```bash
curl -X POST http://localhost:3000/api/diagnostics/mge \
  -H 'content-type: application/json' \
  -d '{"duration_ms": 15000}' | jq .
```

Отчёт (JSON): статус сессии и «похоже ли, что залогинены»; все перехваченные ответы
(URL, content-type, resource type, первые 500 байт тела или ключи верхнего уровня JSON);
скриншоты (base64 JPEG) главной страницы и результатов поиска; пробный поиск первого
объекта из БД: какие URL запрашивались, в каких ответах встречается название.
Тот же IP-allowlist, что и `POST /api/collect`. Формат ответа на mock-сервере —
`datacollector-artifacts/diagnostics/отчёт-mock-МГЭ.json` (в поставке раунда).

По снимку правится общий слой: `MGE_SEARCH_SELECTORS` (env, без кода), селекторы
логина, `objectPath` карточки и карта метрик `MGE_METRIC_MAP` — `core/sites.ts`.

## resolve:mge (операторский инструмент)

Если поиск МГЭ даёт несколько близких кандидатов, задача завершается `AMBIGUOUS_MATCH`
(без ретрая), кандидаты сохраняются в `collection_jobs.error`:

```bash
npm run resolve:mge                       # интерактивно: список → выбор → перезапуск сбора
npm run resolve:mge -- --list             # только список ожидающих решения
npm run resolve:mge -- --object 12 --mge-id MGE-0007 --enqueue   # без диалога
```

Выбор записывается в `objects.external_ids.mge_id` (последующие сборы идут по id,
минуя поиск), задачи помечаются `RESOLVED:`.

## Google Sheets / Яндекс Таблицы 360

Один модуль: чтение таблицы → нормализация → сопоставление объектов → upsert в
`metrics_gsheets` / `metrics_yandex`. В сиде оба источника `enabled=false`
(включите после проверки: `UPDATE sources SET enabled=true WHERE code='gsheets';`).

**Google Sheets, два способа:**
1. Сервисный аккаунт (основной): в Google Cloud Console создать сервисный аккаунт,
   скачать JSON-ключ в `secrets/google-service-account.json`, включить Sheets API,
   таблицу расшарить на e-mail аккаунта (viewer). Заполнить `GOOGLE_SPREADSHEET_ID`
   (и при необходимости `GOOGLE_SHEET_NAME`).
2. Без ключа: таблица с доступом «все, у кого есть ссылка» читается публичным
   CSV-экспортом автоматически.

**Яндекс Таблицы 360:** публичной документированной версии API нет — эндпоинт и
структура ответа настраиваются (`YANDEX_TABLES_URL_TEMPLATE`, `YANDEX_OAUTH_TOKEN`,
`YANDEX_TABLES_BOOK_ID`, `YANDEX_TABLES_VIEW_ID`). Если реальный формат отличается —
меняется только функция `readYandexTables` в
`worker/src/sources/tabular/readers.ts`.

**Формат таблицы:** по умолчанию «широкий» (строка = объект, колонки = метрики;
`«Наименование объекта»`/`«Код ДС»` — идентификация). «Длинный» формат — через
`TABULAR_MAPPING_JSON` (см. `.env.example`). Неоднозначные строки не валят сбор —
попадают в `AMBIGUOUS_ROWS` в поле error задачи (статус COMPLETED).

## Структура: общий слой @dc/core

browser-core (шифрование сессий, конфиг сайтов, нечёткий матчинг, Playwright-хелперы)
выделен в workspace-пакет `core/` — им пользуются и воркер (сбор), и API
(PDF-справки, диагностика МГЭ). Это единственное структурное изменение раунда:
логика общая, дублирования нет.

## Миграции: имена

Миграции этого раунда: `20261106120000_sources_priorities` (0004),
`20261106120001_objects_identifiers` (0005) — обе идемпотентны
(`ON CONFLICT DO UPDATE` / `ADD COLUMN IF NOT EXISTS`). Если на вашей БД аналогичные
миграции применялись под другими именами, перед `prisma migrate deploy` синхронизируйте:

```sql
DELETE FROM _prisma_migrations
WHERE name IN ('20261106120000_sources_priorities','20261106120001_objects_identifiers');
```

(повторное применение этих миграций безопасно — они no-op на уже изменённой схеме).

## Статус реализации

- [x] Шаг 1 — дерево проекта, docker-compose, .env.example, Docker-образы, каркасы api/worker/frontend (health, очередь, прокси)
- [x] Шаг 2 — схема БД (Prisma), миграции, `v_metrics_unified` + `refresh_unified_view()`, сид `sources` с priority, смоук-тест
- [x] Шаг 3 — backend REST: objects / metrics / table (пивот) / collect+status (IP-allowlist) / reports / diagnostics; миграции 0004–0005 (приоритеты, идентификаторы объектов); `import:objects`
- [x] Шаг 4 — воркер МГЭ: @dc/core (Playwright, AES-256-GCM sessions, нечёткий матчинг >0.85 / 0.6–0.85 / <0.6), перехват JSON, AMBIGUOUS_MATCH → `resolve:mge`, retry/backoff, dead-letter, cron
- [x] Шаг 6 — React SPA: TanStack Table + virtualizer (строки и колонки, sticky), фильтры, view/raw, «Обновить данные» (поллинг), «Скачать справку»
- [x] Шаг 7 — экспорт справок: xlsx (ExcelJS) / docx (docx-templates) / pdf (HTML+CSS → page.pdf), шаблоны в `templates/`, тестовые примеры + генератор `npm run make:templates`
- [x] Раунд «таблицы» — модуль gsheets + Yandex Tables 360 (один пайплайн чтение→нормализация→upsert, enabled=false)
- [x] Диагностика — `POST /api/diagnostics/mge`: снимок реального МГЭ (XHR, тела/ключи JSON, скриншоты, пробный поиск объекта)
- [ ] Шаг 5 — воркеры МГЗ/СУИД/Дашборд (общая сессия СУДИР) — НЕ НАЧИНАЛСЯ (по договорённости ждём результатов проверки МГЭ)
- [ ] Шаг 8 — реальная структура МГЭ (по диагностическим снимкам), реальные шаблоны справок, полировка

## Открытые вопросы / TODO

- **Структура МГЭ** — селекторы поиска/карточки и карта метрик (`core/sites.ts`, `MGE_METRIC_MAP`) настроены по предположению; правим по диагностическим снимкам заказчика (общий слой — один раз).
- **Yandex Tables 360** — формат API под вопросом (см. раздел «Google Sheets / Яндекс Таблицы»), адаптер изолирован в одной функции.
- **Словарь метрик** (`metric_key` → название/порядок колонок SPA) — при 50–100 показателях на объект, вероятно, понадобится таблица-словарь; пока ключи канонизируются в нормализаторах. Обсудить после первых реальных сборов.
- **Шаблоны справок** — реальные формы предоставит заказчик (сейчас — тестовые `spravka.*`).
