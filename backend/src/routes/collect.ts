/** POST /api/collect (IP-allowlist) + GET /api/collect/status */
import type Fastify from 'fastify'
import { ZodError } from 'zod'
import { CollectRequestSchema, type CollectStatusResponse } from '@dc/shared'
import { enqueueCollect, getRunStatus, getRecentRuns } from '@dc/db'
import { assertIpAllowed } from '../ip-guard.js'
import { env } from '../env.js'

export function registerCollectRoutes(app: Fastify.FastifyInstance): void {
  app.post('/api/collect', async (req, reply) => {
    assertIpAllowed(req, env.collectAllowedIps)

    let body: ReturnType<typeof CollectRequestSchema.parse>
    try {
      body = CollectRequestSchema.parse(req.body ?? {})
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: err.issues[0]?.message ?? 'Некорректное тело запроса' })
      }
      throw err
    }

    try {
      const result = await enqueueCollect(body)
      app.log.info({ runId: result.runId, enqueued: result.enqueued, sources: result.sources }, 'collect запущен')
      return {
        run_id: result.runId,
        enqueued: result.enqueued,
        sources: result.sources,
        skipped_disabled: result.skippedDisabled,
        objects: result.objects,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = /отключён|Неизвестный источник|ни одного объекта/.test(message) ? 409 : 500
      return reply.code(code).send({ error: message })
    }
  })

  app.get('/api/collect/status', async (req) => {
    const runId = (req.query as { run_id?: string }).run_id
    const response: CollectStatusResponse = { run: null, jobs: [], recent: [] }

    response.recent = (await getRecentRuns(20)).map((r) => ({
      run_id: r.run_id,
      started_at: new Date(r.started_at).toISOString(),
      finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      total: r.total,
      by_status: r.by_status,
    }))

    if (runId) {
      const { run, jobs } = await getRunStatus(runId, 500)
      if (run) {
        response.run = {
          run_id: run.run_id,
          started_at: new Date(run.started_at).toISOString(),
          finished_at: run.finished_at ? new Date(run.finished_at).toISOString() : null,
          total: run.total,
          by_status: run.by_status,
        }
        response.jobs = jobs.map((j) => ({
          id: Number(j.id),
          object_id: j.object_id,
          object_name: j.object_name,
          source: j.source,
          status: j.status,
          attempts: j.attempts,
          error: j.error,
          started_at: j.started_at ? new Date(j.started_at).toISOString() : null,
          finished_at: j.finished_at ? new Date(j.finished_at).toISOString() : null,
        }))
      }
    }
    return response
  })
}
