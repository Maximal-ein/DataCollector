/** GET /api/objects, GET /api/objects/:id/metrics */
import type Fastify from 'fastify'
import { ZodError } from 'zod'
import {
  ObjectsListQuerySchema,
  ObjectMetricsQuerySchema,
  METRIC_SOURCE_CODES,
  type MetricSourceCode,
} from '@dc/shared'
import { searchObjects, getObjectById, getUnifiedMetrics, getRawMetrics } from '@dc/db'

export function registerObjectsRoutes(app: Fastify.FastifyInstance): void {
  app.get('/api/objects', async (req) => {
    const q = ObjectsListQuerySchema.parse(req.query ?? {})
    const { total, items } = await searchObjects(q)
    return {
      total,
      items: items.map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address,
        code_ds: o.code_ds,
        uin: o.uin,
        suid_id: o.suid_id,
        is_active: o.is_active,
      })),
    }
  })

  app.get('/api/objects/:id/metrics', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id объекта' })
    let q: ReturnType<typeof ObjectMetricsQuerySchema.parse>
    try {
      q = ObjectMetricsQuerySchema.parse(req.query ?? {})
    } catch (err) {
      if (err instanceof ZodError) return reply.code(400).send({ error: err.issues[0]?.message ?? 'Некорректные параметры' })
      throw err
    }

    const object = await getObjectById(id)
    if (!object) return reply.code(404).send({ error: `Объект ${id} не найден` })

    let metrics
    if (q.raw) {
      const sources: MetricSourceCode[] = q.source ? [q.source] : [...METRIC_SOURCE_CODES]
      const perSource = await Promise.all(sources.map((s) => getRawMetrics(id, s, q.period)))
      metrics = perSource.flat()
    } else {
      metrics = await getUnifiedMetrics(id, q.period)
    }

    return {
      object: {
        id: object.id,
        name: object.name,
        address: object.address,
        code_ds: object.code_ds,
        uin: object.uin,
        suid_id: object.suid_id,
        is_active: object.is_active,
      },
      raw: q.raw,
      metrics: metrics.map((m) => ({
        source_code: m.source_code,
        metric_key: m.metric_key,
        metric_value: m.metric_value,
        metric_value_num: m.metric_value_num,
        unit: m.unit,
        period: m.period,
        collected_at: new Date(m.collected_at).toISOString(),
        ...(q.include_raw ? { raw_payload: m.raw_payload } : {}),
      })),
    }
  })
}
