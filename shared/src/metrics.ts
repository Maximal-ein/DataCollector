import { z } from 'zod'
import { MetricSourceCodeSchema } from './sources.js'

/**
 * Период метрики — канонический формат (единый для всех источников,
 * нормализаторы обязаны приводить к нему):
 *   ''        — непериодическая метрика (текущее значение)
 *   'YYYY'    — годовая
 *   'YYYY-Qn' — квартальная
 *   'YYYY-MM' — месячная
 */
export const PeriodSchema = z
  .string()
  .regex(/^(?:|\d{4}(?:-Q[1-4]|-(?:0[1-9]|1[0-2]))?)$/, 'Формат: "", YYYY, YYYY-Qn, YYYY-MM')

/**
 * Нормализованная метрика — результат работы нормализатора источника.
 * metricValueNum — дублирующее числовое значение (если метрика числовая):
 * нужно для сортировки/агрегации в SPA; в БД колонка metric_value_num.
 */
export const NormalizedMetricSchema = z.object({
  metricKey: z.string().min(1).max(200),
  metricValue: z.string().nullish(),
  metricValueNum: z.number().nullish(),
  unit: z.string().nullish(),
  period: PeriodSchema.default(''),
  /** Исходный JSON-фрагмент, из которого получена метрика (для аудита). */
  rawPayload: z.unknown().optional(),
})
export type NormalizedMetric = z.infer<typeof NormalizedMetricSchema>

/**
 * Пачка метрик одного объекта из одного источника — результат одного захода воркера.
 * collectedAt один на всю пачку: это ключ идемпотентности upsert
 * (повтор задачи с той же меткой времени обновляет строки, а не плодит новые).
 */
export const NormalizedBatchSchema = z.object({
  objectId: z.number().int().positive(),
  source: MetricSourceCodeSchema,
  collectedAt: z.date(),
  metrics: z.array(NormalizedMetricSchema),
})
export type NormalizedBatch = z.infer<typeof NormalizedBatchSchema>
