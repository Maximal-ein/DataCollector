import { z } from 'zod'

/**
 * Источники, которые пишут метрики (каждому соответствует таблица metrics_<code>).
 * Порядок значения не имеет — приоритет разрешения конфликтов задаётся в БД (sources.priority).
 */
export const MetricSourceCodeSchema = z.enum([
  'mge', // МГЭ — expertiza.mos.ru (своя авторизация)
  'mgz', // МГЗ — mgz.mos.ru (вход через СУДИР)
  'suid', // СУИД — suid.mos.ru (вход через СУДИР)
  'dashboard', // Дашборд — dashboard-stroi.mos.ru (вход через СУДИР)
  'gsheets', // Google Sheets (googleapis, service account)
  'yandex', // TODO: уточнить сервис (Tracker / Диск / Таблицы 360)
])
export type MetricSourceCode = z.infer<typeof MetricSourceCodeSchema>
export const METRIC_SOURCE_CODES = MetricSourceCodeSchema.options

/**
 * Коды, по которым хранятся авторизационные storageState (таблица sessions).
 * 'mge' — своя сессия МГЭ; 'sudir' — ОДНА сессия СУДИР, общая для МГЗ/СУИД/Дашборда.
 */
export const AuthSourceCodeSchema = z.enum(['mge', 'sudir'])
export type AuthSourceCode = z.infer<typeof AuthSourceCodeSchema>

/** Все коды справочника sources (БД). */
export const SOURCE_CODES = [
  'mge',
  'mgz',
  'suid',
  'dashboard',
  'gsheets',
  'yandex',
  'sudir',
] as const
export type SourceCode = (typeof SOURCE_CODES)[number]

/** Человекочитаемые названия (синхронизированы с сид-миграцией sources). */
export const SOURCE_LABELS: Record<SourceCode, string> = {
  mge: 'МГЭ',
  mgz: 'МГЗ',
  suid: 'СУИД',
  dashboard: 'Дашборд',
  gsheets: 'Google Sheets',
  yandex: 'Yandex',
  sudir: 'СУДИР (только авторизация)',
}
