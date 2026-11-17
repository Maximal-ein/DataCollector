-- =====================================================================
-- Шаг 3 (миграция 0004): актуальные приоритеты источников + включённость.
--
-- Приоритеты согласованы на ревью схемы:
--   mge(100) > mgz(80) > suid(60) > dashboard(40) > gsheets(20) > yandex(10)
-- МГЭ — первоисточник экспертизы; Дашборд — производный агрегатор.
--
-- enabled на этом этапе раунда:
--   * mgz/suid/dashboard — false (воркеры шага 5 ещё не реализованы;
--     включаются после шага 5: UPDATE sources SET enabled=true WHERE code IN (...))
--   * gsheets/yandex     — false (заказчик включит после своей проверки)
--   * mge                — true
--
-- Миграция идемпотентна (ON CONFLICT DO UPDATE) и рассчитана на повторное
-- применение даже на БД, где аналогичная правка уже сделана вручную.
-- =====================================================================

INSERT INTO "sources" ("code", "name", "priority", "enabled") VALUES
    ('mge',       'МГЭ (expertiza.mos.ru)',             100, true),
    ('mgz',       'МГЗ (mgz.mos.ru)',                    80, false),
    ('suid',      'СУИД (suid.mos.ru)',                  60, false),
    ('dashboard', 'Дашборд (dashboard-stroi.mos.ru)',    40, false),
    ('gsheets',   'Google Sheets',                       20, false),
    ('yandex',    'Yandex (Таблицы 360)',                10, false),
    ('sudir',     'СУДИР (suid.mos.ru) — только авторизация', 0, true)
ON CONFLICT ("code") DO UPDATE
SET "priority" = EXCLUDED."priority",
    "enabled"   = EXCLUDED."enabled",
    "name"      = EXCLUDED."name",
    "updated_at" = now();
