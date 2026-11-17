/**
 * Репозиторий метрик: идемпотентный upsert + чтение (unified/raw).
 */
import { Prisma } from '@prisma/client'
import { getPrisma } from '../index.js'
import type { MetricSourceCode } from '@dc/shared'

const prisma = getPrisma()

/** Имена таблиц метрик; source валидируется Zod-схемой ДО вызова. */
export function metricsTable(source: MetricSourceCode): string {
  return `metrics_${source}`
}

export interface UpsertMetricRow {
  metricKey: string
  metricValue: string | null
  metricValueNum: number | null
  unit: string | null
  period: string
  rawPayload?: unknown
}

/**
 * Идемпотентный upsert пачки метрик одного объекта (один collected_at на пачку).
 * Повтор задачи с той же меткой времени обновляет строки, а не плодит новые.
 */
export async function upsertMetricBatch(
  source: MetricSourceCode,
  objectId: number,
  collectedAt: Date,
  rows: UpsertMetricRow[],
): Promise<number> {
  if (rows.length === 0) return 0
  const table = metricsTable(source)
  const CHUNK = 400
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const values = chunk.map(
      (r) =>
        Prisma.sql`(${objectId}, ${r.metricKey}, ${r.metricValue}, ${r.metricValueNum}, ${r.unit}, ${r.period}, ${collectedAt}, ${
          r.rawPayload === undefined ? null : JSON.stringify(r.rawPayload)
        }::jsonb)`,
    )
    await prisma.$executeRaw`
      INSERT INTO ${Prisma.raw(`"${table}"`)}
        ("object_id", "metric_key", "metric_value", "metric_value_num", "unit", "period", "collected_at", "raw_payload")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("object_id", "metric_key", "period", "collected_at") DO UPDATE SET
        "metric_value" = EXCLUDED."metric_value",
        "metric_value_num" = EXCLUDED."metric_value_num",
        "unit" = EXCLUDED."unit",
        "raw_payload" = EXCLUDED."raw_payload"`
    written += chunk.length
  }
  return written
}

export interface RawMetricRecord {
  source_code: string
  metric_key: string
  metric_value: string | null
  metric_value_num: number | null
  unit: string | null
  period: string
  collected_at: Date
  raw_payload: unknown
}

/** Метрики объекта из v_metrics_unified (победители по приоритетам). */
export async function getUnifiedMetrics(objectId: number, period?: string): Promise<RawMetricRecord[]> {
  const rows = await prisma.$queryRaw<RawMetricRecord[]>`
    SELECT 'unified' AS source_code, "metric_key", "metric_value", "metric_value_num", "unit", "period", "collected_at", "raw_payload"
    FROM "v_metrics_unified"
    WHERE "object_id" = ${objectId}
      AND (${period ?? null}::text IS NULL OR "period" = ${period ?? null})
    ORDER BY "period" DESC, "metric_key"`
  // source_code('unified') заменим на код реального источника-победителя
  const winners = await prisma.$queryRaw<{ metric_key: string; period: string; source_code: string }[]>`
    SELECT "metric_key", "period", "source_code" FROM "v_metrics_unified" WHERE "object_id" = ${objectId}`
  const map = new Map(winners.map((w) => [`${w.metric_key}|${w.period}`, w.source_code]))
  for (const r of rows) r.source_code = map.get(`${r.metric_key}|${r.period}`) ?? 'unified'
  return rows
}

/** Сырая история метрик объекта: из metrics_<source> (всё, либо один источник). */
export async function getRawMetrics(
  objectId: number,
  source: MetricSourceCode,
  period?: string,
): Promise<RawMetricRecord[]> {
  const table = metricsTable(source)
  return prisma.$queryRaw<RawMetricRecord[]>`
    SELECT ${source}::text AS source_code, "metric_key", "metric_value", "metric_value_num", "unit", "period", "collected_at", "raw_payload"
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "object_id" = ${objectId}
      AND (${period ?? null}::text IS NULL OR "period" = ${period ?? null})
    ORDER BY "collected_at" DESC, "metric_key"`
}
