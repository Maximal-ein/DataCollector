/**
 * Модуль справок (шаг 7 → раунд «экспорт»): форматы, типы данных шаблонов.
 *
 * Контекст, доступный во всех шаблонах (xlsx / docx / pdf):
 *   {{object.id}} {{object.name}} {{object.code_ds}} {{object.uin}}
 *   {{object.suid_id}} {{object.address}}
 *   {{generated_at}}   — дата генерации, ДД.ММ.ГГГГ ЧЧ:ММ
 *   {{period}}         — выбранный период ('' → 'все периоды')
 *   {{metrics_count}}  — количество метрик
 *
 * Повторяющийся блок метрик:
 *   xlsx: строки между {{#metrics}} и {{/metrics}} (включая случай
 *         «оба маркера в одной строке») дублируются на каждую метрику,
 *         внутри доступны {{metric.key}} {{metric.value}} {{metric.unit}}
 *         {{metric.period}} {{metric.source}} {{metric.collected_at}}
 *   docx: {{#for m in metrics}} … {{/for}} (docx-templates)
 *   pdf : {{#each metrics}} … {{/each}} (handlebars)
 */
import { z } from 'zod'
import { MetricSourceCodeSchema, PeriodSchema } from './index.js'
import type { MetricSourceCode } from './sources.js'

export const ReportFormatSchema = z.enum(['xlsx', 'docx', 'pdf'])
export type ReportFormat = z.infer<typeof ReportFormatSchema>

/** Выбор формата в URL уточняет/переопределяет формат файла шаблона. */
export const ReportQuerySchema = z.object({
  object_id: z.coerce.number().int().positive(),
  format: ReportFormatSchema.optional(),
  period: PeriodSchema.optional(),
})
export type ReportQuery = z.infer<typeof ReportQuerySchema>

/** Одна метрика в контексте шаблона. */
export interface ReportMetric {
  key: string
  value: string | null
  value_num: number | null
  unit: string | null
  period: string
  source: MetricSourceCode
  collected_at: string
}

/** Данные, передаваемые в рендерер шаблона. */
export interface ReportData {
  generated_at: string
  /** Выбранный период ('' = все) */
  period: string
  object: {
    id: number
    name: string
    code_ds: string | null
    uin: string | null
    suid_id: string | null
    address: string | null
  }
  metrics: ReportMetric[]
}

/** Ошибки модуля отчётов (код → HTTP). */
export const REPORT_ERROR_CODES = {
  TEMPLATE_NOT_FOUND: 404,
  OBJECT_NOT_FOUND: 404,
  METRICS_EMPTY: 422,
  RENDER_FAILED: 500,
} as const
export type ReportErrorCode = keyof typeof REPORT_ERROR_CODES
