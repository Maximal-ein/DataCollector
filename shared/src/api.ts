/**
 * DTO REST API (шаг 3+): Zod-схемы для запросов + TS-типы для ответов.
 *
 * Запросы валидируются Zod на стороне API; ответы типизированы только
 * TS-типами (без runtime-парсинга) — /api/table отдаёт до ~1000x100 ячеек,
 * лишний проход валидации там не нужен.
 *
 * Соглашение об именовании полей на проводе: snake_case (совпадает с колонками БД).
 */
import { z } from 'zod'
import { MetricSourceCodeSchema, PeriodSchema } from './index.js'

// ─── GET /api/objects ────────────────────────────────────────────────────

export const ObjectsListQuerySchema = z.object({
  /** Поиск по name (ILIKE) или точное совпадение code_ds / uin / suid_id */
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ObjectsListQuery = z.infer<typeof ObjectsListQuerySchema>

export interface ObjectListItem {
  id: number
  name: string
  address: string | null
  code_ds: string | null
  uin: string | null
  suid_id: string | null
  is_active: boolean
}

export interface ObjectsListResponse {
  total: number
  items: ObjectListItem[]
}

// ─── GET /api/objects/:id/metrics ────────────────────────────────────────

export const ObjectMetricsQuerySchema = z.object({
  /** true — из таблиц metrics_<source> (вся история), false/нет — из v_metrics_unified */
  raw: z.coerce.boolean().default(false),
  /** Конкретный источник (только при raw=true); без — все источники */
  source: MetricSourceCodeSchema.optional(),
  period: PeriodSchema.optional(),
  /** Добавить raw_payload (для отладки нормализации) */
  include_raw: z.coerce.boolean().default(false),
})
export type ObjectMetricsQuery = z.infer<typeof ObjectMetricsQuerySchema>

export interface MetricRow {
  source_code: string
  metric_key: string
  metric_value: string | null
  metric_value_num: number | null
  unit: string | null
  period: string
  collected_at: string
  raw_payload?: unknown
}

export interface ObjectMetricsResponse {
  object: ObjectListItem
  /** true, если метрики из metrics_* (история), false — из v_metrics_unified (победители) */
  raw: boolean
  metrics: MetricRow[]
}

// ─── GET /api/table (сводная таблица SPA) ────────────────────────────────

/** 'unified' — из v_metrics_unified; иначе код источника → сырая таблица metrics_<code> */
export const TableSourceSchema = z.union([z.literal('unified'), MetricSourceCodeSchema])
export type TableSource = z.infer<typeof TableSourceSchema>

export const TableQuerySchema = z.object({
  source: TableSourceSchema.default('unified'),
  period: PeriodSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
})
export type TableQuery = z.infer<typeof TableQuerySchema>

export interface TableCell {
  /** значение */
  v: string | null
  /** числовое значение (для сортировки) */
  n: number | null
  /** код источника-победителя (unified) либо код источника (raw) */
  s: string
  /** единица измерения */
  u: string | null
  /** ISO-время сбора */
  c: string
}

export interface TableColumn {
  key: string
  /** Человекочитаемый заголовок (пока = key; нормализация заголовков — шаблонами отчётов) */
  label: string
  /** Доля заполненных ячеек 0..1 (для UI) */
  fill: number
}

export interface TableRow {
  object_id: number
  name: string
  code_ds: string | null
  uin: string | null
  cells: Record<string, TableCell>
}

export interface SourceInfo {
  code: string
  label: string
  priority: number
  enabled: boolean
  /** есть ли данные в metrics_<code> (для серых пунктов в UI) */
  has_data: boolean
}

export interface TableResponse {
  source: TableSource
  period: string | null
  columns: TableColumn[]
  rows: TableRow[]
  total: number
  /** все периоды, встречающиеся в выборке (для фильтра) */
  periods: string[]
  sources: SourceInfo[]
  /** Самый свежий collected_at в представлении (null — представление пусто) */
  data_collected_at: string | null
}

// ─── POST /api/collect + GET /api/collect/status ─────────────────────────
// (CollectRequestSchema — в jobs.ts; здесь только ответы)

export interface CollectRunInfo {
  run_id: string
  started_at: string
  finished_at: string | null
  total: number
  by_status: Record<string, number>
}

export interface CollectJobInfo {
  id: number
  object_id: number
  object_name: string
  source: string
  status: string
  attempts: number
  error: string | null
  started_at: string | null
  finished_at: string | null
}

export interface CollectStatusResponse {
  run: CollectRunInfo | null
  jobs: CollectJobInfo[]
  /** последние запуски (когда run_id не задан) */
  recent: CollectRunInfo[]
}

// ─── GET /api/reports ────────────────────────────────────────────────────
// (типы данных отчёта — reports.ts; здесь — реестр шаблонов)

export interface ReportTemplateInfo {
  id: string
  format: 'xlsx' | 'docx' | 'pdf'
  file: string
  title: string
}
