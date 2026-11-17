/**
 * DataCollector API (Fastify).
 *
 * Маршруты:
 *   GET  /health
 *   GET  /api/objects                        — поиск объектов (name/code_ds/uin)
 *   GET  /api/objects/:id/metrics            — метрики объекта (unified | raw)
 *   GET  /api/table                          — сводная таблица SPA (пивот)
 *   POST /api/collect                        — запуск сбора (IP-allowlist)
 *   GET  /api/collect/status                 — статусы запусков/задач
 *   GET  /api/reports                        — реестр шаблонов справок
 *   GET  /api/reports/:template              — файл справки (xlsx|docx|pdf)
 *   POST /api/diagnostics/mge                — диагностический снимок МГЭ (IP-allowlist)
 *
 * SPA и API живут в одном origin за nginx (docker-compose); в dev-режиме
 * Vite проксирует /api и /health.
 */
import Fastify from 'fastify'
import { getPrisma } from '@dc/db'
import { startBoss } from '@dc/db'
import { env } from './env.js'
import { closeSharedBrowser } from './reports/browser-pool.js'
import { registerObjectsRoutes } from './routes/objects.js'
import { registerTableRoutes } from './routes/table.js'
import { registerCollectRoutes } from './routes/collect.js'
import { registerReportsRoutes } from './routes/reports.js'
import { registerDiagnosticsRoutes } from './routes/diagnostics.js'

const app = Fastify({
  trustProxy: env.trustProxy, // за nginx: req.ip из X-Forwarded-For (нужно IP-allowlist)
  logger: {
    level: env.logLevel,
    ...(env.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
      : {}),
  },
  bodyLimit: 1024 * 1024,
})

app.get('/health', async (_req, reply) => {
  try {
    await getPrisma().$queryRaw`SELECT 1`
    return { status: 'ok', service: 'api' }
  } catch (err) {
    app.log.error({ err }, 'health: БД недоступна')
    return reply.code(503).send({ status: 'degraded', service: 'api' })
  }
})

registerObjectsRoutes(app)
registerTableRoutes(app)
registerCollectRoutes(app)
registerReportsRoutes(app)
registerDiagnosticsRoutes(app)

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void (async () => {
      await closeSharedBrowser()
      await app.close()
      process.exit(0)
    })()
  })
}

const start = async (): Promise<void> => {
  try {
    // pg-boss нужен для POST /api/collect (enqueue); старт лёгкий: без воркеров
    await startBoss().catch((err) => app.log.warn({ err }, 'pg-boss не стартовал — POST /api/collect будет недоступен'))
    await app.listen({ port: env.apiPort, host: env.apiHost })
    app.log.info(`API готов: http://${env.apiHost}:${env.apiPort} (шаблоны: ${process.env.REPORTS_TEMPLATES_DIR ?? './templates'})`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
void start()
