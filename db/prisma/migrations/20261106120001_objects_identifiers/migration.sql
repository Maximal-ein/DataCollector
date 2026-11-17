-- =====================================================================
-- Шаг 3 (миграция 0005): идентификация объектов из выгрузки СУИД.
--
-- Добавляет выделенные колонки (UNIQUE, NULL разрешён — PostgreSQL
-- допускает множество NULL в UNIQUE-индексе) и служебные поля импорта:
--   suid_id         — «Идентификатор проекта» (hex), колонка A выгрузки
--   code_ds         — «Код ДС», колонка C
--   uin             — «УИН», колонка D
--   import_batch_id — UUID партии импорта (один на запуск import:objects)
--   excel_row_hash  — SHA-256 нормализованной строки: повторный импорт
--                     без изменений не трогает строку
--
-- external_ids (JSONB) после этой миграции хранит ТОЛЬКО внутренние ID
-- сайтов: mge_id, mgz_id, dashboard_id, suid_internal_id (если отличается).
--
-- IF NOT EXISTS: миграция безопасно применяется повторно (например, если
-- на целевой БД уже применена миграция с аналогичной правкой под другим именем).
-- =====================================================================

ALTER TABLE "objects"
    ADD COLUMN IF NOT EXISTS "code_ds" TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS "uin" TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS "suid_id" TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS "import_batch_id" UUID,
    ADD COLUMN IF NOT EXISTS "excel_row_hash" TEXT;
