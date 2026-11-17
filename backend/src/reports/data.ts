/** Сборка данных для шаблона справки: объект + метрики из v_metrics_unified. */
import type { ReportData, ReportMetric, MetricSourceCode } from '@dc/shared'
import { getObjectById, getUnifiedMetrics } from '@dc/db'

export class ReportDataError extends Error {
  statusCode: number
  code: string
  constructor(code: 'OBJECT_NOT_FOUND' | 'METRICS_EMPTY', message: string) {
    super(message)
    this.code = code
    this.statusCode = code === 'OBJECT_NOT_FOUND' ? 404 : 422
  }
}

export async function buildReportData(objectId: number, period?: string): Promise<ReportData> {
  const object = await getObjectById(objectId)
  if (!object) {
    throw new ReportDataError('OBJECT_NOT_FOUND', `Объект ${objectId} не найден`)
  }

  const rows = await getUnifiedMetrics(objectId, period)
  if (rows.length === 0) {
    throw new ReportDataError(
      'METRICS_EMPTY',
      `У объекта «${object.name}» нет метрик${period ? ` за период ${period}` : ''} — сначала выполните сбор`,
    )
  }

  const metrics: ReportMetric[] = rows.map((m) => ({
    key: m.metric_key,
    value: m.metric_value,
    value_num: m.metric_value_num,
    unit: m.unit,
    period: m.period,
    source: m.source_code as MetricSourceCode,
    collected_at: new Date(m.collected_at).toISOString(),
  }))

  return {
    generated_at: new Date().toLocaleString('ru-RU', { timeZone: process.env.TZ ?? 'Europe/Moscow' }),
    period: period ?? '',
    object: {
      id: object.id,
      name: object.name,
      code_ds: object.code_ds,
      uin: object.uin,
      suid_id: object.suid_id,
      address: object.address,
    },
    metrics,
  }
}
