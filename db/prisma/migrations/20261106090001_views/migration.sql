-- =====================================================================
-- Шаг 2 (2/3): v_metrics_unified (materialized view) + refresh_unified_view().
--
-- Правило разрешения конфликтов (object_id, metric_key, period):
--   1) побеждает источник с наибольшим sources.priority;
--   2) при равенстве — самое свежее collected_at.
-- Вся история (все collected_at) остаётся в таблицах metrics_*,
-- в view попадает только «победившее» значение.
--
-- Обновление view:
--   * SELECT refresh_unified_view();  — обычный REFRESH (используется
--     вручную/скриптами; на время refresh блокирует чтение view);
--   * REFRESH MATERIALIZED VIEW CONCURRENTLY v_metrics_unified;
--     — неблокирующий вариант; его вызывает воркер после успешного сбора.
--     ВАЖНО: CONCURRENTLY нельзя вызывать внутри PL/pgSQL-функции
--     (PostgreSQL запрещает CONCURRENTLY в транзакционном контексте),
--     поэтому функция делает обычный REFRESH, а воркер зовёт CONCURRENTLY
--     напрямую.
-- =====================================================================

CREATE MATERIALIZED VIEW "v_metrics_unified" AS
WITH "all_metrics" AS (
    SELECT
        m."object_id",
        'mge'::text AS "source_code",
        m."metric_key",
        m."metric_value",
        m."metric_value_num",
        m."unit",
        m."period",
        m."collected_at",
        m."raw_payload"
    FROM "metrics_mge" m
    UNION ALL
    SELECT
        m."object_id",
        'mgz'::text AS "source_code",
        m."metric_key",
        m."metric_value",
        m."metric_value_num",
        m."unit",
        m."period",
        m."collected_at",
        m."raw_payload"
    FROM "metrics_mgz" m
    UNION ALL
    SELECT
        m."object_id",
        'suid'::text AS "source_code",
        m."metric_key",
        m."metric_value",
        m."metric_value_num",
        m."unit",
        m."period",
        m."collected_at",
        m."raw_payload"
    FROM "metrics_suid" m
    UNION ALL
    SELECT
        m."object_id",
        'dashboard'::text AS "source_code",
        m."metric_key",
        m."metric_value",
        m."metric_value_num",
        m."unit",
        m."period",
        m."collected_at",
        m."raw_payload"
    FROM "metrics_dashboard" m
    UNION ALL
    SELECT
        m."object_id",
        'gsheets'::text AS "source_code",
        m."metric_key",
        m."metric_value",
        m."metric_value_num",
        m."unit",
        m."period",
        m."collected_at",
        m."raw_payload"
    FROM "metrics_gsheets" m
    UNION ALL
    SELECT
        m."object_id",
        'yandex'::text AS "source_code",
        m."metric_key",
        m."metric_value",
        m."metric_value_num",
        m."unit",
        m."period",
        m."collected_at",
        m."raw_payload"
    FROM "metrics_yandex" m
),
"ranked" AS (
    SELECT
        a."object_id",
        a."source_code",
        a."metric_key",
        a."metric_value",
        a."metric_value_num",
        a."unit",
        a."period",
        a."collected_at",
        a."raw_payload",
        row_number() OVER (
            PARTITION BY a."object_id", a."metric_key", a."period"
            ORDER BY coalesce(s."priority", 0) DESC, a."collected_at" DESC
        ) AS "rn"
    FROM "all_metrics" a
    LEFT JOIN "sources" s ON s."code" = a."source_code"
)
SELECT
    r."object_id",
    r."source_code",
    r."metric_key",
    r."metric_value",
    r."metric_value_num",
    r."unit",
    r."period",
    r."collected_at",
    r."raw_payload"
FROM "ranked" r
WHERE r."rn" = 1
WITH DATA;

-- Уникальный индекс: (1) семантика «одно значение на (object_id, metric_key, period)»,
-- (2) обязательное условие для REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX "v_metrics_unified_key"
    ON "v_metrics_unified" ("object_id", "metric_key", "period");

COMMENT ON MATERIALIZED VIEW "v_metrics_unified" IS
'Единые метрики по всем источникам; конфликт (object_id, metric_key, period) решается по sources.priority DESC, затем collected_at DESC. Обновление: refresh_unified_view() или REFRESH ... CONCURRENTLY из воркера';

-- Обновление представления (блокирующий вариант — см. комментарий выше).
CREATE OR REPLACE FUNCTION refresh_unified_view()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW "v_metrics_unified";
END;
$$;

COMMENT ON FUNCTION refresh_unified_view() IS
'Обновляет v_metrics_unified (обычный REFRESH). Для неблокирующего обновления воркер вызывает REFRESH MATERIALIZED VIEW CONCURRENTLY напрямую — внутри функции CONCURRENTLY запрещён PostgreSQL';
