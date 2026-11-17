/**
 * Репозиторий задач сбора (collection_jobs) + постановка в очередь pg-boss.
 *
 * Доменные статусы vs pg-boss:
 *   QUEUED   — поставлена в очередь
 *   ACTIVE   — воркер взял в работу
 *   COMPLETED — успешный сбор (метрики записаны или осмысленно пусто)
 *   FAILED   — доменная ошибка БЕЗ ретрая (AMBIGUOUS_MATCH — ждёт оператора,
 *              OBJECT_NOT_RESOLVED_ON_MGE — объекта нет в МГЭ) ЛИБО неудачная
 *              попытка с ожидающимся ретраем (error_message без PERMANENT-префикса)
 *   DEAD     — попытки исчерпаны (dead-letter)
 */
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { getPrisma } from '../index.js'
import { sendJobs } from '../boss.js'
import { COLLECT_QUEUE, METRIC_SOURCE_CODES, type CollectJobData, type MetricSourceCode } from '@dc/shared'

const prisma = getPrisma()

export interface EnqueueResult {
  runId: string
  /** создано задач */
  enqueued: number
  sources: MetricSourceCode[]
  /** источники пропущены: disabled (со списком) */
  skippedDisabled: string[]
  /** объектов, подходящих под выборку */
  objects: number
}

/** Постановка сбора (используется POST /api/collect и cron-расписанием). */
export async function enqueueCollect(params: { source?: MetricSourceCode; objectIds?: number[] }): Promise<EnqueueResult> {
  const allSources = await prisma.source.findMany({ where: { code: { in: [...METRIC_SOURCE_CODES] } } })
  const byCode = new Map(allSources.map((s) => [s.code, s]))

  let sources: MetricSourceCode[]
  const skippedDisabled: string[] = []
  if (params.source) {
    const s = byCode.get(params.source)
    if (!s) throw new Error(`Неизвестный источник: ${params.source}`)
    if (!s.enabled) {
      throw new Error(
        `Источник '${params.source}' отключён (sources.enabled=false). ` +
          'Включите его в БД или запустите сбор без указания источника.',
      )
    }
    sources = [params.source]
  } else {
    sources = allSources.filter((s) => s.enabled).map((s) => s.code as MetricSourceCode)
    for (const s of allSources) if (!s.enabled) skippedDisabled.push(s.code)
  }

  const objects = params.objectIds
    ? await prisma.object.findMany({ where: { id: { in: params.objectIds } }, select: { id: true } })
    : await prisma.object.findMany({ where: { isActive: true }, select: { id: true } })
  if (objects.length === 0) throw new Error('Под выборку не попало ни одного объекта (импортируйте объекты или проверьте фильтр)')

  const runId = randomUUID()
  const sourceIds = new Map(allSources.map((s) => [s.code, s.id]))

  const jobsData: { object: { id: number }; source: MetricSourceCode }[] = []
  for (const source of sources) {
    for (const object of objects) jobsData.push({ object, source })
  }

  // 1) доменные строки
  await prisma.collectionJob.createMany({
    data: jobsData.map((j) => ({
      runId,
      objectId: j.object.id,
      sourceId: sourceIds.get(j.source)!,
      status: 'QUEUED' as const,
    })),
  })

  // 2) pg-boss задачи + связка boss_job_id
  const created = await prisma.collectionJob.findMany({
    where: { runId },
    select: { id: true, objectId: true, sourceId: true },
    orderBy: { id: 'asc' },
  })
  const codeBySourceId = new Map(allSources.map((s) => [s.id, s.code as MetricSourceCode]))
  const payloads: CollectJobData[] = created.map((c) => ({
    collectionJobId: Number(c.id),
    runId,
    objectId: c.objectId,
    source: codeBySourceId.get(c.sourceId)!,
  }))

  try {
    const bossIds = await sendJobs(
      payloads.map((data) => ({
        name: COLLECT_QUEUE,
        data,
        options: { retryLimit: 2, retryBackoff: true, expireInSeconds: 600 },
      })),
    )
    // связываем пачками (createMany) — порядок возвращается в порядке отправки
    const updates = created.map((c, i) =>
      prisma.collectionJob.update({ where: { id: c.id }, data: { bossJobId: bossIds[i] } }).catch(() => undefined),
    )
    await Promise.all(updates)
  } catch (err) {
    // очередь недоступна — помечаем доменные строки как FAILED
    await prisma.collectionJob.updateMany({
      where: { runId },
      data: { status: 'FAILED', error: `QUEUE_SEND_FAILED: ${String(err)}`, finishedAt: new Date() },
    })
    throw err
  }

  return { runId, enqueued: payloads.length, sources, skippedDisabled, objects: objects.length }
}

/** Обновление статуса доменной задачи. */
export async function updateJobStatus(
  id: number,
  patch: { status?: 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'DEAD'; error?: string | null; attemptStarted?: boolean; attemptFinished?: boolean; incAttempts?: boolean },
): Promise<void> {
  await prisma.collectionJob.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.error !== undefined ? { error: (patch.error ?? '').slice(0, 4000) } : {}),
      ...(patch.attemptStarted ? { startedAt: new Date() } : {}),
      ...(patch.attemptFinished ? { finishedAt: new Date() } : {}),
      ...(patch.incAttempts ? { attempts: { increment: 1 } } : {}),
    },
  })
}

export interface RunStatus {
  run_id: string
  started_at: Date
  finished_at: string | Date | null
  total: number
  by_status: Record<string, number>
}

async function runStatusRow(runId: string): Promise<RunStatus | null> {
  const base = await prisma.$queryRaw<
    { run_id: string; started_at: Date; last_finished: Date | null; total: bigint }[]
  >`
    SELECT "run_id", min("created_at") AS started_at, max("finished_at") AS last_finished, count(*)::bigint AS total
    FROM "collection_jobs" WHERE "run_id" = ${runId}::uuid GROUP BY "run_id"`
  if (!base[0]) return null
  const statusRows = await prisma.$queryRaw<{ status: string; cnt: bigint }[]>`
    SELECT "status", count(*)::bigint AS cnt FROM "collection_jobs" WHERE "run_id" = ${runId}::uuid GROUP BY "status"`
  const by_status: Record<string, number> = {}
  for (const s of statusRows) by_status[s.status] = Number(s.cnt)
  return {
    run_id: base[0].run_id,
    started_at: base[0].started_at,
    finished_at: base[0].last_finished,
    total: Number(base[0].total),
    by_status,
  }
}

export interface JobRowInfo {
  id: number
  object_id: number
  object_name: string
  source: string
  status: string
  attempts: number
  error: string | null
  started_at: Date | null
  finished_at: Date | null
}

/** Статус одного запуска + список задач (первые N). */
export async function getRunStatus(runId: string, jobsLimit = 500): Promise<{ run: RunStatus | null; jobs: JobRowInfo[] }> {
  const run = await runStatusRow(runId)
  if (!run) return { run: null, jobs: [] }
  const jobs = await prisma.$queryRaw<JobRowInfo[]>`
    SELECT j."id", j."object_id", o."name" AS object_name, s."code" AS source,
           j."status"::text AS status, j."attempts", j."error", j."started_at", j."finished_at"
    FROM "collection_jobs" j
    JOIN "objects" o ON o."id" = j."object_id"
    JOIN "sources" s ON s."id" = j."source_id"
    WHERE j."run_id" = ${runId}::uuid
    ORDER BY j."id" LIMIT ${jobsLimit}`
  return { run, jobs }
}

/** Последние запуски (для панели статуса SPA). */
export async function getRecentRuns(limit = 20): Promise<RunStatus[]> {
  const ids = await prisma.$queryRaw<{ run_id: string }[]>`
    SELECT DISTINCT "run_id" FROM "collection_jobs" ORDER BY "run_id" DESC LIMIT ${limit}`
  const runs: RunStatus[] = []
  for (const { run_id } of ids) {
    const r = await runStatusRow(run_id)
    if (r) runs.push(r)
  }
  runs.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
  return runs
}

/** Есть ли в запуске незавершённые задачи (QUEUED/ACTIVE). */
export async function runHasPending(runId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT count(*)::bigint AS cnt FROM "collection_jobs"
    WHERE "run_id" = ${runId}::uuid AND "status" IN ('QUEUED', 'ACTIVE')`
  return Number(rows[0]?.cnt ?? 0) > 0
}
