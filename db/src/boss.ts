/**
 * Обёртка pg-boss: один инстанс на процесс (api — send, worker — send+work).
 *
 * Особенность pg-boss v10: send/insert требуют ЗАРАНЕЕ созданную очередь
 * (INNER JOIN на pgboss.queue) — поэтому перед отправкой вызываем
 * createQueue (идемпотентно). insert(jobs[]) возвращает массив id задач.
 */
import PgBoss from 'pg-boss'

declare global {
  // eslint-disable-next-line no-var
  var __dcBoss: PgBoss | undefined
  // eslint-disable-next-line no-var
  var __dcBossStarted: Promise<PgBoss> | undefined
}

export function getBoss(): PgBoss {
  if (!globalThis.__dcBoss) {
    if (!process.env.DATABASE_URL) throw new Error('Не задан DATABASE_URL')
    globalThis.__dcBoss = new PgBoss({ connectionString: process.env.DATABASE_URL })
  }
  return globalThis.__dcBoss
}

/** start() идемпотентен: один и тот же промис на процесс. */
export function startBoss(): Promise<PgBoss> {
  if (!globalThis.__dcBossStarted) {
    globalThis.__dcBossStarted = getBoss()
      .start()
      .catch((err) => {
        globalThis.__dcBossStarted = undefined
        throw err
      })
  }
  return globalThis.__dcBossStarted
}

/** Остановить boss (нужно CLI-скриптам, иначе процесс не завершается). */
export async function stopBoss(): Promise<void> {
  if (globalThis.__dcBossStarted) {
    await getBoss().stop({ graceful: true, timeout: 5000 }).catch(() => undefined)
    globalThis.__dcBossStarted = undefined
    globalThis.__dcBoss = undefined
  }
}

/** Создать очередь, если её ещё нет (идемпотентно). */
export async function ensureQueue(name: string): Promise<void> {
  const boss = await startBoss()
  try {
    await boss.createQueue(name)
  } catch {
    // createQueue конфликтует при гонке параллельных созданий — это норма
  }
}

/**
 * Отправить пачку задач одним INSERT (pg-boss insert()).
 * Возвращает id задач в порядке отправки (для collection_jobs.boss_job_id).
 */
export async function sendJobs(
  jobs: { name: string; data: unknown; options?: Record<string, unknown> }[],
): Promise<(string | null)[]> {
  if (jobs.length === 0) return []
  const boss = await startBoss()
  await ensureQueue(jobs[0]!.name)
  // типы pg-boss объявляют Promise<void>, но реализация возвращает id вставленных задач
  const ids = (await boss.insert(
    jobs.map((j) => ({
      name: j.name,
      data: j.data as object,
      ...(j.options ?? {}),
    })),
  )) as unknown as (string | null)[] | null
  return ids ?? []
}
