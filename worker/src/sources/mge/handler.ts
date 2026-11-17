/**
 * Обработчик сбора МГЭ (восстановлен из шага 4; правки — после диагностических
 * логов заказчика; общий слой: @dc/core browser/sites/matching).
 *
 * Алгоритм:
 *   1. mge_id уже известен (external_ids) → сразу карточка объекта.
 *   2. Иначе — поиск по названию на сайте (селекторы MGE_SEARCH_SELECTORS),
 *      перехват JSON-ответов поиска → extractCandidates.
 *   3. Нечёткий матчинг (matching.ts):
 *        auto      → кэшируем mge_id в external_ids, идём в карточку;
 *        ambiguous → доменная ошибка AMBIGUOUS_MATCH (без ретрая; кандидаты —
 *                    в error, разбирается npm run resolve:mge);
 *        none      → доменная ошибка OBJECT_NOT_RESOLVED_ON_MGE (без ретрая).
 *   4. Карточка: слушаем XHR JSON → extractMetrics → идемпотентный upsert.
 *   5. Успех → REFRESH v_metrics_unified (троттлинг в index.ts).
 */
import type { Response } from 'playwright'
import type { CollectJobData, NormalizedMetric } from '@dc/shared'
import { NormalizedMetricSchema } from '@dc/shared'
import { getObjectById, setExternalId, upsertMetricBatch } from '@dc/db'
import { MGE_SITE, withBrowserSession, ensureLoggedIn, matchByName, type MatchCandidate } from '@dc/core'
import { extractCandidates, extractMetrics } from './normalizer.js'

/** Доменные ошибки БЕЗ ретрая (воркер пометит job FAILED и не бросит в boss). */
export class PermanentCollectError extends Error {
  code: 'AMBIGUOUS_MATCH' | 'OBJECT_NOT_RESOLVED_ON_MGE' | 'MGE_EMPTY_DATA'
  candidates?: MatchCandidate[]
  constructor(code: PermanentCollectError['code'], message: string, candidates?: MatchCandidate[]) {
    super(message)
    this.code = code
    this.candidates = candidates
  }
}

async function captureJson(page: import('playwright').Page, during: () => Promise<void>): Promise<unknown[]> {
  const bodies: unknown[] = []
  const onResponse = async (resp: Response): Promise<void> => {
    const ct = resp.headers()['content-type'] ?? ''
    if (!ct.includes('json')) return
    try {
      bodies.push(JSON.parse((await resp.body()).toString('utf8')))
    } catch {
      /* не JSON — пропускаем */
    }
  }
  page.on('response', (r) => void onResponse(r).catch(() => undefined))
  await during()
  await page.waitForTimeout(3000) // добираем поздние XHR
  return bodies
}

interface MgeCollectResult {
  written: number
  mgeId: string
  via: 'cached_id' | 'search_match'
}

export async function collectMge(job: CollectJobData): Promise<MgeCollectResult> {
  const object = await getObjectById(job.objectId)
  if (!object) throw new PermanentCollectError('OBJECT_NOT_RESOLVED_ON_MGE', `Объект ${job.objectId} не найден в БД`)

  const externalIds = (object.external_ids ?? {}) as Record<string, string>
  const cachedId = externalIds['mge_id']

  return withBrowserSession(MGE_SITE, async (context) => {
    await ensureLoggedIn(context, MGE_SITE)
    const page = await context.newPage()
    page.setDefaultTimeout(45000)

    let mgeId = cachedId ?? null
    let via: MgeCollectResult['via'] = 'cached_id'

    if (!mgeId) {
      // ── поиск по названию ──
      await page.goto(MGE_SITE.baseUrl, { waitUntil: 'domcontentloaded' })

      // слушатель вешаем ДО ввода: XHR поиска срабатывает сразу после Enter
      const searchBodies = await captureJson(page, async () => {
        let typed = false
        for (const sel of MGE_SITE.searchSelectors) {
          try {
            const loc = page.locator(sel).first()
            await loc.waitFor({ state: 'visible', timeout: 8000 })
            await loc.fill(object.name)
            await loc.press('Enter')
            typed = true
            break
          } catch {
            /* пробуем следующий селектор */
          }
        }
        if (!typed) {
          throw new Error(
            `Не найдено поле поиска на ${MGE_SITE.baseUrl} (селекторы: ${MGE_SITE.searchSelectors.join(', ')}). ` +
              'Уточните MGE_SEARCH_SELECTORS по результатам POST /api/diagnostics/mge',
          )
        }
        await page.waitForLoadState('networkidle').catch(() => undefined)
      })

      const candidates = searchBodies.flatMap((b) => extractCandidates(b))
      if (candidates.length === 0) {
        throw new PermanentCollectError(
          'OBJECT_NOT_RESOLVED_ON_MGE',
          `Поиск «${object.name}» не дал разбираемых кандидатов (перехвачено JSON: ${searchBodies.length}). ` +
            'Возможно, структура ответа МГЭ отличается — пришлите вывод POST /api/diagnostics/mge',
        )
      }

      const match = matchByName(object.name, candidates)
      if (match.status === 'none') {
        throw new PermanentCollectError(
          'OBJECT_NOT_RESOLVED_ON_MGE',
          `Объект «${object.name}» не найден на МГЭ (лучшее сходство < 0.6; кандидатов в зоне поиска: ${candidates.length})`,
        )
      }
      if (match.status === 'ambiguous') {
        throw new PermanentCollectError(
          'AMBIGUOUS_MATCH',
          `Однозначного соответствия для «${object.name}» нет — выберите кандидата: npm run resolve:mge`,
          match.candidates,
        )
      }
      mgeId = match.best.externalId
      via = 'search_match'
      await setExternalId(job.objectId, 'mge_id', mgeId) // кэшируем
    }

    // ── карточка объекта ──
    const cardUrl = MGE_SITE.baseUrl.replace(/\/$/, '') + (MGE_SITE.objectPath?.(mgeId) ?? `/objects/${encodeURIComponent(mgeId)}`)
    const bodies = await captureJson(page, async () => {
      await page.goto(cardUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => undefined)
    })

    if (bodies.length === 0) {
      throw new PermanentCollectError(
        'MGE_EMPTY_DATA',
        `Карточка ${cardUrl} не отдала ни одного JSON — проверьте URL карточки (MGE_BASE_URL/objectPath) по диагностике`,
      )
    }

    // нормализация (Zod) + upsert
    const collectedAt = new Date()
    const valid: NormalizedMetric[] = []
    for (const body of bodies) {
      for (const m of extractMetrics(body)) {
        const parsed = NormalizedMetricSchema.safeParse(m)
        if (parsed.success) valid.push(parsed.data)
      }
    }
    if (valid.length === 0) {
      throw new PermanentCollectError(
        'MGE_EMPTY_DATA',
        `JSON карточки получен (${bodies.length} ответов), но метрик не извлечено — пришлите вывод диагностики, поправим extractMetrics`,
      )
    }

    const written = await upsertMetricBatch('mge', job.objectId, collectedAt, valid.map((m) => ({
      metricKey: m.metricKey,
      metricValue: m.metricValue ?? null,
      metricValueNum: m.metricValueNum ?? null,
      unit: m.unit ?? null,
      period: m.period ?? '',
      rawPayload: m.rawPayload,
    })))

    await page.close()
    return { written, mgeId: mgeId!, via }
  })
}
