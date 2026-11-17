-- =====================================================================
-- Шаг 2 (1/3): enum, таблицы, индексы, внешние ключи.
--
-- Тело миграции сгенерировано из db/prisma/schema.prisma командой
--   prisma migrate diff --from-empty --to-schema-datamodel --script
-- (не редактировать вручную — изменения вносить через schema.prisma).
--
-- Ключевые решения:
--  * metrics_*: уникальный индекс (object_id, metric_key, period,
--    collected_at) — основа идемпотентного upsert (ON CONFLICT DO UPDATE);
--    вся история collected_at сохраняется, дедупликация — в v_metrics_unified
--    (миграция 0002). Индекс без DESC по collected_at: запросы «последнее
--    значение» обслуживаются обратным сканом B-tree, а отсутствие DESC
--    упрощает выведение индекса для ON CONFLICT.
--  * period TEXT NOT NULL DEFAULT '' — непериодические метрики хранят ''
--    (NULL ломал бы уникальный индекс и оконные функции view).
--  * metric_value_num — числовое представление metric_value для
--    сортировки/агрегации в SPA.
--  * collection_jobs.status: QUEUED → ACTIVE → COMPLETED | FAILED(ретрай) | DEAD(dead-letter).
--  * sessions: одна запись на источник АВТОРИЗАЦИИ ('mge', 'sudir');
--    storage_state_encrypted — AES-256-GCM (см. COMMENT ниже).
-- =====================================================================
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "objects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "external_ids" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics_mge" (
    "id" BIGSERIAL NOT NULL,
    "object_id" INTEGER NOT NULL,
    "metric_key" TEXT NOT NULL,
    "metric_value" TEXT,
    "metric_value_num" DOUBLE PRECISION,
    "unit" TEXT,
    "period" TEXT NOT NULL DEFAULT '',
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_mge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics_mgz" (
    "id" BIGSERIAL NOT NULL,
    "object_id" INTEGER NOT NULL,
    "metric_key" TEXT NOT NULL,
    "metric_value" TEXT,
    "metric_value_num" DOUBLE PRECISION,
    "unit" TEXT,
    "period" TEXT NOT NULL DEFAULT '',
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_mgz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics_suid" (
    "id" BIGSERIAL NOT NULL,
    "object_id" INTEGER NOT NULL,
    "metric_key" TEXT NOT NULL,
    "metric_value" TEXT,
    "metric_value_num" DOUBLE PRECISION,
    "unit" TEXT,
    "period" TEXT NOT NULL DEFAULT '',
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_suid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics_dashboard" (
    "id" BIGSERIAL NOT NULL,
    "object_id" INTEGER NOT NULL,
    "metric_key" TEXT NOT NULL,
    "metric_value" TEXT,
    "metric_value_num" DOUBLE PRECISION,
    "unit" TEXT,
    "period" TEXT NOT NULL DEFAULT '',
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics_gsheets" (
    "id" BIGSERIAL NOT NULL,
    "object_id" INTEGER NOT NULL,
    "metric_key" TEXT NOT NULL,
    "metric_value" TEXT,
    "metric_value_num" DOUBLE PRECISION,
    "unit" TEXT,
    "period" TEXT NOT NULL DEFAULT '',
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_gsheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics_yandex" (
    "id" BIGSERIAL NOT NULL,
    "object_id" INTEGER NOT NULL,
    "metric_key" TEXT NOT NULL,
    "metric_value" TEXT,
    "metric_value_num" DOUBLE PRECISION,
    "unit" TEXT,
    "period" TEXT NOT NULL DEFAULT '',
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_yandex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_jobs" (
    "id" BIGSERIAL NOT NULL,
    "run_id" UUID NOT NULL,
    "boss_job_id" TEXT,
    "object_id" INTEGER NOT NULL,
    "source_id" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "storage_state_encrypted" BYTEA,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sources_code_key" ON "sources"("code");

-- CreateIndex
CREATE INDEX "metrics_mge_collected_at_idx" ON "metrics_mge"("collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_mge_upsert_key" ON "metrics_mge"("object_id", "metric_key", "period", "collected_at");

-- CreateIndex
CREATE INDEX "metrics_mgz_collected_at_idx" ON "metrics_mgz"("collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_mgz_upsert_key" ON "metrics_mgz"("object_id", "metric_key", "period", "collected_at");

-- CreateIndex
CREATE INDEX "metrics_suid_collected_at_idx" ON "metrics_suid"("collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_suid_upsert_key" ON "metrics_suid"("object_id", "metric_key", "period", "collected_at");

-- CreateIndex
CREATE INDEX "metrics_dashboard_collected_at_idx" ON "metrics_dashboard"("collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_dashboard_upsert_key" ON "metrics_dashboard"("object_id", "metric_key", "period", "collected_at");

-- CreateIndex
CREATE INDEX "metrics_gsheets_collected_at_idx" ON "metrics_gsheets"("collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_gsheets_upsert_key" ON "metrics_gsheets"("object_id", "metric_key", "period", "collected_at");

-- CreateIndex
CREATE INDEX "metrics_yandex_collected_at_idx" ON "metrics_yandex"("collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_yandex_upsert_key" ON "metrics_yandex"("object_id", "metric_key", "period", "collected_at");

-- CreateIndex
CREATE INDEX "collection_jobs_run_id_status_idx" ON "collection_jobs"("run_id", "status");

-- CreateIndex
CREATE INDEX "collection_jobs_object_id_created_at_idx" ON "collection_jobs"("object_id", "created_at");

-- CreateIndex
CREATE INDEX "collection_jobs_status_updated_at_idx" ON "collection_jobs"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_source_id_key" ON "sessions"("source_id");

-- AddForeignKey
ALTER TABLE "metrics_mge" ADD CONSTRAINT "metrics_mge_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics_mgz" ADD CONSTRAINT "metrics_mgz_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics_suid" ADD CONSTRAINT "metrics_suid_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics_dashboard" ADD CONSTRAINT "metrics_dashboard_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics_gsheets" ADD CONSTRAINT "metrics_gsheets_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics_yandex" ADD CONSTRAINT "metrics_yandex_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_jobs" ADD CONSTRAINT "collection_jobs_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_jobs" ADD CONSTRAINT "collection_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Постоянные комментарии (видны в \d+ и pgAdmin) ──────────────────────

COMMENT ON COLUMN "objects"."external_ids" IS 'ID объекта в системах источников: mge_id, mgz_id, suid_id, dashboard_id, gsheets_row, yandex_key';

COMMENT ON COLUMN "sources"."priority" IS 'Приоритет разрешения конфликтов в v_metrics_unified: больше — авторитетнее. Строки sources не удалять (только enabled=false)';

COMMENT ON TABLE "metrics_mge" IS 'Показатели МГЭ (expertiza.mos.ru). Уникальный (object_id, metric_key, period, collected_at) — идемпотентный upsert; raw_payload — исходный JSON для аудита';
COMMENT ON TABLE "metrics_mgz" IS 'Показатели МГЗ (mgz.mos.ru, вход через СУДИР). Структура как у metrics_mge';
COMMENT ON TABLE "metrics_suid" IS 'Показатели СУИД (suid.mos.ru, вход через СУДИР). Структура как у metrics_mge';
COMMENT ON TABLE "metrics_dashboard" IS 'Показатели Дашборда (dashboard-stroi.mos.ru, вход через СУДИР). Структура как у metrics_mge';
COMMENT ON TABLE "metrics_gsheets" IS 'Показатели из Google Sheets. Структура как у metrics_mge';
COMMENT ON TABLE "metrics_yandex" IS 'Показатели из Yandex (TODO: уточнить сервис). Структура как у metrics_mge';

COMMENT ON COLUMN "collection_jobs"."run_id" IS 'Группировка задач одного запуска (кнопка в SPA или cron)';

COMMENT ON COLUMN "sessions"."storage_state_encrypted" IS 'storageState Playwright, AES-256-GCM: iv(12B) || authTag(16B) || ciphertext; ключ — env SESSION_ENCRYPTION_KEY';
