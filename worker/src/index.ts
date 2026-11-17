/**
 * DataCollector Worker (pg-boss + Playwright).
 *
 * Очередь 'collect' (COLLECT_QUEUE): одна задача = (объект, источник).
 *   mge              → browser-пайплайн (sources/mge)
 *   gsheets / yandex → табличный пайплайн (sources/tabular)
 *   mgz / suid / dashboard → шаг 5 (не реализован, задачи не создаются:
 *                          источники disabled до реализации)
 *
 * Доменные статусы collection_jobs обновляются здесь:
 *   ACTIVE → COMPLETED | FAILED(доменная, без ретрая) | FAILED(попытка) → DEAD.
 * После успешного сбора — REFRESH MATERIALIZED VIEW CONCURRENTLY v_metrics_unified
 * с троттлингом: не чаще, чем после каждого REFRESH_MATVIEW_EVERY-го завершения,
 * и обязательно — когда в запуске не осталось незавершённых задач.
 *
 * Cron (CRON_SCHEDULE): очередь 'collect-daily' разворачивается в пачку задач
 * тех же включённых источников (тот же enqueueCollect, что и POST /api/collect).
 */
import { startBoss, ensureQueue, prisma } from '@dc/db'
import { updateJobStatus, runHasPending, enqueueCollect } from '@dc/db'
import { COLLECT_QUEUE, COLLECT_CRON_NAME, CollectJobDataSchema, type CollectJobData } from '@dc/shared'
import { collectMge, PermanentCollectError } from './sources/mge/handler.js'
import { collectTabular } from './sources/tabular/handler.js'

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 2)
const REFRESH_EVERY = Number(process.env.REFRESH_MATVIEW_EVERY ?? 25)

if (!process.env.DATABASE_URL) {
  console.error('[worker] не задан DATABASE_URL')
  process.exit(1)
}

/** Троттлинг REFRESH CONCURRENTLY. */
let completedSinceRefresh = 0
let refreshChain: Promise<void> = Promise.resolve()

/**
 * Табличные источники читаются целиком: задачи одного запуска (run+source)
 * схлопываются — в каждый момент читает только одна (остальные ждут и
 * помечаются дубликатами). Map<runId:source, Promise>.
 */
const tabularInflight = new Map<string, Promise<unknown>>()

function refreshView(reason: string): void {
  refreshChain = refreshChain.then(async () => {
    try {
      await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY "v_metrics_unified"')
      console.log(`[worker] v_metrics_unified обновлён (${reason})`)
    } catch {
      // CONCURRENTLY требует уникальный индекс и начальную инициализацию;
      // при первом REFRESH или сбое — обычный вариант
      try {
        await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW "v_metrics_unified"')
        console.log(`[worker] v_metrics_unified обновлён обычным REFRESH (${reason})`)
      } catch (err) {
        console.error('[worker] REFRESH view не удался:', err instanceof Error ? err.message : err)
      }
    }
  })
}

async function processJob(data: CollectJobData): Promise<void> {
  const parsed = CollectJobDataSchema.safeParse(data)
  if (!parsed.success) {
    console.error('[worker] некорректный payload задачи:', parsed.error.issues)
    return
  }
  const job = parsed.data

  await updateJobStatus(job.collectionJobId, { status: 'ACTIVE', attemptStarted: true, incAttempts: true, error: null })
  console.log(`[collect] #${job.collectionJobId} ${job.source} → объект ${job.objectId}`)

  try {
    if (job.source === 'mge') {
      const res = await collectMge(job)
      await updateJobStatus(job.collectionJobId, { status: 'COMPLETED', attemptFinished: true, error: null })
      console.log(`[collect] #${job.collectionJobId} OK: ${res.written} метрик (mge_id=${res.mgeId}, ${res.via})`)
    } else if (job.source === 'gsheets' || job.source === 'yandex') {
      // табличные источники читаются ЦЕЛИКОМ: если таблица этого запуска уже
      // обработана (рано или поздно любая задача завершится первой) — дубликат
      const dup = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT 1 AS ok FROM "collection_jobs" j
        JOIN "sources" s ON s."id" = j."source_id"
        WHERE j."run_id" = ${job.runId}::uuid AND s."code" = ${job.source}
          AND j."status" = 'COMPLETED' AND j."id" != ${job.collectionJobId}
        LIMIT 1`
      if (dup.length > 0) {
        await updateJobStatus(job.collectionJobId, {
          status: 'COMPLETED',
          attemptFinished: true,
          error: 'SKIPPED_DUPLICATE: таблица обработана первой задачей запуска',
        })
        console.log(`[collect] #${job.collectionJobId} дубликат табличного сбора — пропущен`)
      } else {
        // in-flight замок: параллельная задача того же запуска уже читает таблицу
        const inflightKey = `${job.runId}:${job.source}`
        const inflight = tabularInflight.get(inflightKey)
        if (inflight) {
          await inflight.catch(() => undefined)
          await updateJobStatus(job.collectionJobId, {
            status: 'COMPLETED',
            attemptFinished: true,
            error: 'SKIPPED_DUPLICATE: таблица обработана параллельной задачей запуска',
          })
          console.log(`[collect] #${job.collectionJobId} дубликат табличного сбора (in-flight) — пропущен`)
        } else {
          const work = collectTabular(job)
          tabularInflight.set(inflightKey, work)
          try {
            const res = await work
            const note = res.ambiguous.length > 0
              ? `AMBIGUOUS_ROWS: ${res.ambiguous.length} строк требуют оператора (${res.ambiguous.map((a) => a.name.slice(0, 30)).join('; ').slice(0, 300)})`
              : null
            await updateJobStatus(job.collectionJobId, { status: 'COMPLETED', attemptFinished: true, error: note })
            console.log(
              `[collect] #${job.collectionJobId} OK: ${res.written} метрик, объектов ${res.resolved}` +
                (res.ambiguous.length ? `, неоднозначных строк ${res.ambiguous.length}` : '') +
                (res.unresolved ? `, без соответствия ${res.unresolved}` : ''),
            )
          } finally {
            tabularInflight.delete(inflightKey)
          }
        }
      }
    } else {
      await updateJobStatus(job.collectionJobId, {
        status: 'FAILED',
        attemptFinished: true,
        error: `NOT_IMPLEMENTED_YET: воркер '${job.source}' появится на шаге 5`,
      })
    }

    completedSinceRefresh += 1
    const pending = await runHasPending(job.runId)
    if (!pending || completedSinceRefresh >= REFRESH_EVERY) {
      refreshView(!pending ? `завершён run ${job.runId}` : `троттлинг: ${completedSinceRefresh} задач`)
      completedSinceRefresh = 0
    }
  } catch (err) {
    if (err instanceof PermanentCollectError) {
      // доменная ошибка: без ретрая; кандидаты (для AMBIGUOUS_MATCH) — в error
      const detail = err.candidates ? `${err.message} CANDIDATES:${JSON.stringify(err.candidates)}` : err.message
      await updateJobStatus(job.collectionJobId, { status: 'FAILED', attemptFinished: true, error: `${err.code}: ${detail}` })
      console.warn(`[collect] #${job.collectionJobId} ${err.code}: ${err.message}`)
      return // не бросаем: pg-boss не должен ретраить
    }
    // транзиентная ошибка: ретрай pg-boss (retryLimit задан при отправке)
    const jobRow = await prisma.collectionJob.findUnique({
      where: { id: job.collectionJobId },
      select: { attempts: true, maxAttempts: true },
    })
    const isLast = jobRow !== null && jobRow.attempts >= jobRow.maxAttempts
    await updateJobStatus(job.collectionJobId, {
      status: isLast ? 'DEAD' : 'FAILED',
      attemptFinished: true,
      error: `ATTEMPT_FAILED: ${err instanceof Error ? err.message : String(err)}`,
    })
    console.error(`[collect] #${job.collectionJobId} ошибка${isLast ? ' (DEAD)' : ', будет ретрай'}:`, err instanceof Error ? err.message : err)
    if (isLast) return // попытки исчерпаны — не ретраим
    throw err // pg-boss сделает ретрай с backoff
  }
}

async function main(): Promise<void> {
  const boss = await startBoss()
  await ensureQueue(COLLECT_QUEUE)
  await ensureQueue(COLLECT_CRON_NAME)

  // 'collect' — батч-хендлер pg-boss v10 (массив задач)
  await boss.work(COLLECT_QUEUE, { batchSize: CONCURRENCY }, async (jobs) => {
    await Promise.all(
      jobs.map((j) =>
        processJob(j.data as unknown as CollectJobData).catch((err) => {
          console.error('[worker] необработанная ошибка задачи:', err)
        }),
      ),
    )
  })

  // 'collect-daily' — cron-триггер суточного сбора (fallback ручного запуска)
  await boss.work(COLLECT_CRON_NAME, { batchSize: 1 }, async (jobs) => {
    for (const _job of jobs) {
      try {
        const res = await enqueueCollect({})
        console.log(`[cron] запущен суточный сбор: run_id=${res.runId}, задач ${res.enqueued}`)
      } catch (err) {
        console.error('[cron] не удалось поставить сбор:', err instanceof Error ? err.message : err)
      }
    }
  })

  const cron = process.env.CRON_SCHEDULE ?? '0 2 * * *'
  const tz = process.env.CRON_TZ ?? 'Europe/Moscow'
  try {
    await boss.schedule(COLLECT_CRON_NAME, cron, {}, { tz })
    console.log(`[worker] cron суточного сбора: '${cron}' (${tz})`)
  } catch (err) {
    console.warn('[worker] cron не обновлён (возможно, уже существует):', err instanceof Error ? err.message : err)
  }

  console.log(`[worker] запущен: очередь '${COLLECT_QUEUE}', параллелизм ${CONCURRENCY}`)

  const shutdown = async (): Promise<void> => {
    console.log('[worker] останавливаюсь…')
    await boss.stop({ graceful: true, timeout: 30000 }).catch(() => undefined)
    await refreshChain.catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((err) => {
  console.error('[worker] фатальная ошибка запуска:', err)
  process.exit(1)
})
