/**
 * Обработчик табличных источников (gsheets / yandex): один пайплайн —
 * чтение таблицы → разбор → сопоставление объектов → upsert.
 *
 * Сопоставление:
 *   1. по коду ДС (точное совпадение с objects.code_ds);
 *   2. по названию — нечёткий матчинг (тот же алгоритм, что и для МГЭ):
 *      auto → пишем; ambiguous → AMBIGUOUS_MATCH (оператор, resolve-инструмент
 *      общий); none → OBJECT_NOT_RESOLVED_ON_MGE-аналог для таблиц.
 */
import type { CollectJobData, MetricSourceCode, NormalizedMetric } from '@dc/shared'
import { NormalizedMetricSchema } from '@dc/shared'
import { prisma, upsertMetricBatch, setExternalId } from '@dc/db'
import { matchByName } from '@dc/core'
import { PermanentCollectError } from '../mge/handler.js'
import { readGsheets, readYandexTables } from './readers.js'
import { parseTable } from './normalizer.js'

export interface TabularCollectResult {
  written: number
  resolved: number
  /** строки с неоднозначным соответствием — пропущены, ждут оператора */
  ambiguous: { name: string; candidates: { id: string; name: string; similarity: number }[] }[]
  /** строки без соответствия в БД (например, служебные строки таблицы) */
  unresolved: number
}

/** Сбор «всей таблицы» сразу: одна задача = все объекты источника. */
export async function collectTabular(job: CollectJobData): Promise<TabularCollectResult> {
  const source: MetricSourceCode = job.source
  const table = source === 'gsheets' ? await readGsheets() : await readYandexTables()
  const drafts = parseTable(table, source)
  if (drafts.length === 0) {
    throw new PermanentCollectError('MGE_EMPTY_DATA', `Таблица ${source} не содержит разбираемых строк (заголовок: ${table.header.slice(0, 8).join(', ')}…)`)
  }

  const result: TabularCollectResult = { written: 0, resolved: 0, ambiguous: [], unresolved: 0 }

  // объекты БД одним запросом (сопоставляем по коду и по названию)
  const objects = await prisma.object.findMany({
    where: { isActive: true },
    select: { id: true, name: true, codeDs: true },
  })
  const byCode = new Map(objects.filter((o) => o.codeDs).map((o) => [o.codeDs!, o]))

  const collectedAt = new Date()

  for (const draft of drafts) {
    // 1) точное совпадение по коду ДС
    let target = draft.codeDs ? byCode.get(draft.codeDs.trim()) : undefined

    // 2) нечёткое сопоставление по названию
    if (!target && draft.name) {
      const match = matchByName(draft.name, objects.map((o) => ({ id: String(o.id), name: o.name })))
      if (match.status === 'auto') {
        target = objects.find((o) => String(o.id) === match.best.externalId)
      } else if (match.status === 'ambiguous') {
        // неоднозначная строка: пропускаем, не валим всю таблицу
        result.ambiguous.push({
          name: draft.name,
          candidates: match.candidates.map((c) => ({
            id: c.externalId,
            name: c.name,
            similarity: c.similarity,
          })),
        })
        continue
      }
      if (match.status === 'none') {
        result.unresolved += 1
        continue
      }
    }

    if (!target) {
      result.unresolved += 1
      continue
    }

    const valid: NormalizedMetric[] = []
    for (const m of draft.metrics) {
      const parsed = NormalizedMetricSchema.safeParse(m)
      if (parsed.success) valid.push(parsed.data)
    }
    if (valid.length > 0) {
      result.written += await upsertMetricBatch(source, target.id, collectedAt, valid.map((m) => ({
        metricKey: m.metricKey,
        metricValue: m.metricValue ?? null,
        metricValueNum: m.metricValueNum ?? null,
        unit: m.unit ?? null,
        period: m.period ?? '',
        rawPayload: m.rawPayload,
      })))
    }
    result.resolved += 1
    // кэшируем соответствие строки таблицы → объект (для будущих запусков)
    await setExternalId(target.id, source === 'gsheets' ? 'gsheets_row' : 'yandex_key', draft.name ?? draft.codeDs ?? String(target.id)).catch(() => undefined)
  }

  return result
}
