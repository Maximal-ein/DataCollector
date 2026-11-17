-- =====================================================================
-- Шаг 2 (3/3): сид справочника источников.
--
-- Приоритеты — стартовые значения (TODO: уточнить у заказчика):
--   dashboard(100) > mgz(80) > suid(60) > mge(40) > gsheets(20) > yandex(10).
-- 'sudir' — авторизационная запись (общая сессия для МГЗ/СУИД/Дашборда),
-- таблицы метрик не имеет и в v_metrics_unified не участвует.
--
-- ON CONFLICT DO NOTHING: миграция идемпотентна и не затирает возможные
-- ручные правки priority/enabled, сделанные после первого деплоя.
-- =====================================================================

INSERT INTO "sources" ("code", "name", "priority", "enabled") VALUES
    ('dashboard', 'Дашборд (dashboard-stroi.mos.ru)', 100, true),
    ('mgz',       'МГЗ (mgz.mos.ru)',                   80, true),
    ('suid',      'СУИД (suid.mos.ru)',                 60, true),
    ('mge',       'МГЭ (expertiza.mos.ru)',             40, true),
    ('gsheets',   'Google Sheets',                      20, true),
    ('yandex',    'Yandex (TODO: уточнить сервис)',     10, false),
    ('sudir',     'СУДИР (sudir.mos.ru) — только авторизация', 0, true)
ON CONFLICT ("code") DO NOTHING;
