-- =====================================================================
-- Смоук-тест схемы DataCollector.
-- Запуск:
--   npm run db:smoke        (psql внутри docker compose)
--   npm run db:smoke:local  (node-postgres, без psql/docker)
--
-- Проверяет:
--   1) правило приоритетов в v_metrics_unified (sources.priority);
--   2) идемпотентный upsert (ON CONFLICT по collected_at);
--   3) refresh_unified_view() и REFRESH ... CONCURRENTLY;
--   4) каскадное удаление тестовых данных.
-- Тестовые данные удаляются в конце; на чужих данных не влияет
-- (объекты помечены external_ids->>'mge_id' LIKE 'SMOKE-%').
-- =====================================================================

-- 0) Уборка от предыдущего запуска (идемпотентность теста)
DELETE FROM "objects" WHERE "external_ids"->>'mge_id' LIKE 'SMOKE-%';

INSERT INTO "objects" ("name", "address", "external_ids") VALUES
  ('SMOKE Тестовый объект А', 'г. Москва, ул. Тестовая, 1', '{"mge_id": "SMOKE-A"}'),
  ('SMOKE Тестовый объект Б', 'г. Москва, ул. Тестовая, 2', '{"mge_id": "SMOKE-B"}');

-- 1) «Готовность»: СВЕЖЕЕ значение из МГЭ (priority 40) против БОЛЕЕ СТАРОГО
--    из Дашборда (priority 100). Должен победить Дашборд.
INSERT INTO "metrics_mge" ("object_id", "metric_key", "metric_value", "metric_value_num", "unit", "period", "collected_at")
VALUES ((SELECT "id" FROM "objects" WHERE "external_ids"->>'mge_id' = 'SMOKE-A'),
        'Готовность', '50%', 50, '%', '', '2026-11-06 12:00:00+03'::timestamptz);

INSERT INTO "metrics_dashboard" ("object_id", "metric_key", "metric_value", "metric_value_num", "unit", "period", "collected_at")
VALUES ((SELECT "id" FROM "objects" WHERE "external_ids"->>'mge_id' = 'SMOKE-A'),
        'Готовность', '35%', 35, '%', '', '2026-11-04 12:00:00+03'::timestamptz);

-- 2) Периодическая метрика из МГЗ (другой metric_key и period — отдельная строка view)
INSERT INTO "metrics_mgz" ("object_id", "metric_key", "metric_value", "metric_value_num", "unit", "period", "collected_at")
VALUES ((SELECT "id" FROM "objects" WHERE "external_ids"->>'mge_id' = 'SMOKE-A'),
        'План финансирования', '1200000.00', 1200000, 'RUB', '2026-10', '2026-11-06 12:00:00+03'::timestamptz);

SELECT refresh_unified_view();

DO $$
DECLARE
  obj_id int;
  v text;
  n double precision;
  c int;
BEGIN
  SELECT "id" INTO obj_id FROM "objects" WHERE "external_ids"->>'mge_id' = 'SMOKE-A';

  SELECT "metric_value", "metric_value_num" INTO v, n
  FROM "v_metrics_unified"
  WHERE "object_id" = obj_id AND "metric_key" = 'Готовность';
  IF v IS DISTINCT FROM '35%' OR n IS DISTINCT FROM 35 THEN
    RAISE EXCEPTION 'FAIL: приоритет источников не отработал (получено % / %)', v, n;
  END IF;

  SELECT count(*) INTO c FROM "v_metrics_unified" WHERE "object_id" = obj_id;
  IF c <> 2 THEN
    RAISE EXCEPTION 'FAIL: ожидалось 2 метрики в view, получено %', c;
  END IF;
END $$;

-- 3) Идемпотентный upsert: повторная вставка той же пачки (тот же collected_at)
--    обновляет строку, а не создаёт новую
INSERT INTO "metrics_mge" ("object_id", "metric_key", "metric_value", "metric_value_num", "unit", "period", "collected_at")
VALUES ((SELECT "id" FROM "objects" WHERE "external_ids"->>'mge_id' = 'SMOKE-A'),
        'Готовность', '51%', 51, '%', '', '2026-11-06 12:00:00+03'::timestamptz)
ON CONFLICT ("object_id", "metric_key", "period", "collected_at") DO UPDATE
SET "metric_value" = EXCLUDED."metric_value",
    "metric_value_num" = EXCLUDED."metric_value_num";

DO $$
DECLARE
  obj_id int;
  c int;
BEGIN
  SELECT "id" INTO obj_id FROM "objects" WHERE "external_ids"->>'mge_id' = 'SMOKE-A';
  SELECT count(*) INTO c FROM "metrics_mge" WHERE "object_id" = obj_id AND "metric_key" = 'Готовность';
  IF c <> 1 THEN
    RAISE EXCEPTION 'FAIL: идемпотентный upsert не сработал (строк: %)', c;
  END IF;
END $$;

-- 4) CONCURRENTLY-обновление (то, что зовёт воркер) + повторная проверка приоритета
REFRESH MATERIALIZED VIEW CONCURRENTLY "v_metrics_unified";

DO $$
DECLARE
  obj_id int;
  v text;
BEGIN
  SELECT "id" INTO obj_id FROM "objects" WHERE "external_ids"->>'mge_id' = 'SMOKE-A';
  SELECT "metric_value" INTO v
  FROM "v_metrics_unified"
  WHERE "object_id" = obj_id AND "metric_key" = 'Готовность';
  -- Дашборд (35%%) по-прежнему побеждает более свежий МГЭ (51%%) за счёт priority
  IF v IS DISTINCT FROM '35%' THEN
    RAISE EXCEPTION 'FAIL: после CONCURRENTLY refresh ожидалось 35%% (dashboard), получено %', v;
  END IF;
END $$;

-- 5) Уборка: каскадное удаление метрик и задач вместе с объектами
DELETE FROM "objects" WHERE "external_ids"->>'mge_id' IN ('SMOKE-A', 'SMOKE-B');
SELECT refresh_unified_view();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "v_metrics_unified") THEN
    RAISE EXCEPTION 'FAIL: view не пуста после уборки тестовых данных';
  END IF;
  IF EXISTS (SELECT 1 FROM "metrics_mge" LIMIT 1) THEN
    RAISE EXCEPTION 'FAIL: каскадное удаление metrics_* не сработало';
  END IF;
END $$;

SELECT 'SMOKE TEST OK' AS result;
