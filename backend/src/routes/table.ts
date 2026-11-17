/** GET /api/table — сводная таблица для SPA (unified / сырой источник). */
import type Fastify from 'fastify'
import { ZodError } from 'zod'
import { TableQuerySchema } from '@dc/shared'
import { pivotTable } from '@dc/db'

export function registerTableRoutes(app: Fastify.FastifyInstance): void {
  app.get('/api/table', async (req, reply) => {
    let q: ReturnType<typeof TableQuerySchema.parse>
    try {
      q = TableQuerySchema.parse(req.query ?? {})
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: err.issues[0]?.message ?? 'Некорректные параметры' })
      }
      throw err
    }
    const t0 = Date.now()
    const result = await pivotTable(q)
    app.log.info({ ms: Date.now() - t0, source: q.source, rows: result.rows.length, cols: result.columns.length }, '/api/table')
    return {
      source: q.source,
      period: q.period ?? null,
      columns: result.columns,
      rows: result.rows,
      total: result.total,
      periods: result.periods,
      sources: result.sources,
      data_collected_at: result.data_collected_at ? new Date(result.data_collected_at).toISOString() : null,
    }
  })
}
