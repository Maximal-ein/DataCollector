/**
 * Операторский инструмент разрешения неоднозначных соответствий МГЭ (задача 5).
 *
 * Объект «требует решения», если последний сбор МГЭ завершился ошибкой
 * AMBIGUOUS_MATCH: поиск по названию дал нескольких кандидатов в зоне 0.6–0.85
 * (или двух близких >0.85). Кандидаты сохранены в collection_jobs.error.
 *
 * Режимы:
 *   npm run resolve:mge                          — интерактивный (список → выбор)
 *   npm run resolve:mge -- --object 12           — сразу по объекту
 *   npm run resolve:mge -- --object 12 --mge-id MGE-0007   — без диалога
 *   npm run resolve:mge -- --list                — только список
 *
 * После выбора: mge_id пишется в objects.external_ids (merge), все
 * AMBIGUOUS_MATCH-задачи объекта помечаются RESOLVED (error → префикс
 * 'RESOLVED:'), опционально сразу перезапускается сбор объекта (--enqueue,
 * в интерактивном режиме — вопрос).
 */
import { createInterface } from 'node:readline/promises'
import { prisma, setExternalId, enqueueCollect, stopBoss, type JobRowInfo } from '@dc/db'
import type { MatchCandidate } from '@dc/core/src/matching.js'

interface AmbiguousJob {
  jobId: number
  objectId: number
  objectName: string
  codeDs: string | null
  candidates: MatchCandidate[]
  createdAt: Date
}

/** Разобрать CANDIDATES:[...] из collection_jobs.error. */
function parseCandidates(error: string): MatchCandidate[] {
  const idx = error.indexOf('CANDIDATES:')
  if (idx < 0) return []
  try {
    return JSON.parse(error.slice(idx + 'CANDIDATES:'.length)) as MatchCandidate[]
  } catch {
    return []
  }
}

/** Последняя AMBIGUOUS_MATCH-задача на каждый объект. */
async function listAmbiguous(): Promise<AmbiguousJob[]> {
  const rows = await prisma.$queryRaw<JobRowInfo[]>`
    SELECT j."id", j."object_id", o."name" AS object_name, s."code" AS source,
           j."status"::text AS status, j."attempts", j."error", j."started_at", j."finished_at"
    FROM "collection_jobs" j
    JOIN "objects" o ON o."id" = j."object_id"
    JOIN "sources" s ON s."id" = j."source_id"
    WHERE s."code" = 'mge' AND j."error" LIKE 'AMBIGUOUS_MATCH%'
      AND NOT EXISTS (
        SELECT 1 FROM "collection_jobs" newer
        WHERE newer."object_id" = j."object_id" AND newer."source_id" = j."source_id"
          AND newer."id" > j."id" AND newer."status" IN ('COMPLETED')
      )
    ORDER BY j."object_id", j."id" DESC`
  const seen = new Set<number>()
  const out: AmbiguousJob[] = []
  for (const row of rows) {
    if (seen.has(row.object_id)) continue
    seen.add(row.object_id)
    const obj = await prisma.object.findUnique({ where: { id: row.object_id }, select: { codeDs: true } })
    out.push({
      jobId: Number(row.id),
      objectId: row.object_id,
      objectName: row.object_name,
      codeDs: obj?.codeDs ?? null,
      candidates: parseCandidates(row.error ?? ''),
      createdAt: new Date(),
    })
  }
  return out
}

async function showList(items: AmbiguousJob[]): Promise<void> {
  if (items.length === 0) {
    console.log('Однозначных соответствий, требующих решения, нет (AMBIGUOUS_MATCH отсутствуют).')
    return
  }
  console.log(`Объектов, требующих решения: ${items.length}\n`)
  for (const [i, item] of items.entries()) {
    console.log(`  [${i + 1}] объект #${item.objectId} — ${item.objectName}`)
    if (item.codeDs) console.log(`      код ДС: ${item.codeDs}`)
    for (const c of item.candidates) {
      console.log(`      · ${c.name}  (mge_id=${c.externalId}, сходство ${c.similarity})`)
    }
    console.log('')
  }
}

async function applyChoice(item: AmbiguousJob, candidate: MatchCandidate, enqueue: boolean): Promise<void> {
  await setExternalId(item.objectId, 'mge_id', candidate.externalId)
  console.log(`✓ objects.external_ids.mge_id = ${candidate.externalId} (объект #${item.objectId})`)

  // помечаем AMBIGUOUS-задачи объекта как разрешённые (error остаётся для аудита)
  await prisma.collectionJob.updateMany({
    where: { objectId: item.objectId, error: { startsWith: 'AMBIGUOUS_MATCH' } },
    data: { error: `RESOLVED: mge_id=${candidate.externalId} (${candidate.name})` },
  })

  if (enqueue) {
    const res = await enqueueCollect({ source: 'mge', objectIds: [item.objectId] })
    console.log(`✓ сбор перезапущен: run_id=${res.runId} (задач: ${res.enqueued})`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
  }

  const items = await listAmbiguous()

  if (args.includes('--list')) {
    await showList(items)
    return
  }

  const objectIdArg = flag('object')
  const mgeIdArg = flag('mge-id')

  if (objectIdArg && mgeIdArg) {
    // неинтерактивный режим
    const item = items.find((x) => x.objectId === Number(objectIdArg))
    if (!item) {
      console.error(`У объекта #${objectIdArg} нет AMBIGUOUS_MATCH (или уже разрешён).`)
      process.exit(1)
    }
    const candidate = item.candidates.find((c) => c.externalId === mgeIdArg)
    if (!candidate) {
      console.error(`mge_id=${mgeIdArg} нет среди кандидатов: ${item.candidates.map((c) => c.externalId).join(', ')}`)
      process.exit(1)
    }
    await applyChoice(item, candidate, args.includes('--enqueue'))
    return
  }

  // интерактивный режим
  if (items.length === 0) {
    await showList(items)
    return
  }
  await showList(items)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const pick = (await rl.question('Номер объекта из списка (или Enter для выхода): ')).trim()
    if (pick === '') return
    const item = items[Number(pick) - 1]
    if (!item) {
      console.log('Нет такого номера.')
      return
    }
    console.log(`\nОбъект: #${item.objectId} — ${item.objectName}`)
    item.candidates.forEach((c, i) => {
      console.log(`  [${i + 1}] ${c.name}  (mge_id=${c.externalId}, сходство ${c.similarity})`)
    })
    const cpick = (await rl.question('Какой кандидат правильный (номер): ')).trim()
    const candidate = item.candidates[Number(cpick) - 1]
    if (!candidate) {
      console.log('Нет такого кандидата — отмена.')
      return
    }
    const enqueue = (await rl.question('Перезапустить сбор МГЭ по этому объекту сейчас? [y/N]: ')).trim().toLowerCase() === 'y'
    await applyChoice(item, candidate, enqueue)
    console.log('\nГотово.')
  } finally {
    rl.close()
  }
}

main()
  .catch((err) => {
    console.error('resolve:mge failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await stopBoss().catch(() => undefined)
    await prisma.$disconnect()
  })
