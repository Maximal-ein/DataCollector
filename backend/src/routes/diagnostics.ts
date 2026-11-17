/**
 * POST /api/diagnostics/mge — диагностический снимок реального МГЭ (задача 4).
 *
 * Что делает:
 *   1. Логинится по сохранённому storageState (source='mge'); если сессии нет —
 *      пробует автологин по MGE_LOGIN/MGE_PASSWORD, иначе 409 с подсказкой.
 *   2. Открывает МГЭ и N секунд слушает ВСЕ ответы сети (page.on('response')).
 *   3. Скриншот главной страницы после загрузки (base64 JPEG).
 *   4. Пробует найти первый объект из БД: какие URL дергались при поиске,
 *      в каких JSON-ответах встречается название объекта, что вернулось.
 *   5. Возвращает структурированный JSON-отчёт (формат см. ниже).
 *
 * Только для localhost/LAN — тот же IP-allowlist, что и POST /api/collect.
 * MGE_BASE_URL в env позволяет гонять на mock-сервере (e2e-тесты).
 */
import type Fastify from 'fastify'
import { ZodError } from 'zod'
import { DiagnosticsMgeRequestSchema } from '@dc/shared'
import { getFirstObject } from '@dc/db'
import { MGE_SITE, withBrowserSession, loadSessionState, looksLikeLoginPage, ensureLoggedIn, normalizeName } from '@dc/core'
import type { Page, Response } from 'playwright'
import { assertIpAllowed } from '../ip-guard.js'
import { env } from '../env.js'

interface CapturedResponse {
  seq: number
  ts: string
  phase: 'load' | 'settle' | 'search'
  method: string
  url: string
  status: number
  content_type: string | null
  resource_type: string
  /** первые 500 символов тела (только для XHR/fetch/JSON) */
  body_preview: string | null
  /** ключи верхнего уровня, если тело — JSON-объект */
  json_top_keys: string[] | null
  /** длина массива, если тело — JSON-массив */
  json_array_len: number | null
  /** ключи первого элемента массива */
  json_item_keys: string[] | null
}

interface SearchEvidence {
  url: string
  note: string
  top_level_keys: string[] | null
  match_count: number
  snippet: string
}

const MAX_ENTRIES = 500
const BODY_LIMIT = 512 * 1024

function snippetAround(body: string, needle: string, radius = 90): string {
  const idx = body.toLowerCase().indexOf(needle.toLowerCase())
  if (idx < 0) return ''
  return body.slice(Math.max(0, idx - radius), Math.min(body.length, idx + needle.length + radius)).replace(/\s+/g, ' ')
}

export function registerDiagnosticsRoutes(app: Fastify.FastifyInstance): void {
  app.post('/api/diagnostics/mge', async (req, reply) => {
    assertIpAllowed(req, env.collectAllowedIps)

    let q: ReturnType<typeof DiagnosticsMgeRequestSchema.parse>
    try {
      q = DiagnosticsMgeRequestSchema.parse(req.body ?? {})
    } catch (err) {
      if (err instanceof ZodError) return reply.code(400).send({ error: err.issues[0]?.message ?? 'Некорректное тело запроса' })
      throw err
    }

    const startedAt = new Date()
    const state = await loadSessionState('mge')
    if (!state && !process.env.MGE_LOGIN) {
      return reply.code(409).send({
        error: 'Нет сохранённой сессии МГЭ и не задан MGE_LOGIN для автологина. Выполните: npm run login:mge',
        hint: 'login:mge сохранит storageState (AES-256-GCM) в таблицу sessions',
      })
    }

    // объект для пробного поиска
    const firstObject = await getFirstObject()
    const searchName = q.search_object_name ?? firstObject?.name ?? null
    if (!searchName) {
      return reply.code(409).send({ error: 'В БД нет объектов — импортируйте выгрузку: npm run import:objects --file=export.xlsx' })
    }

    const captured: CapturedResponse[] = []
    const searchUrls: CapturedResponse[] = []
    const evidence: SearchEvidence[] = []
    let phase: 'load' | 'settle' | 'search' = 'load'
    let seq = 0
    const normalizedNeedle = normalizeName(searchName)
    const notes: string[] = []

    const onResponse = async (resp: Response): Promise<void> => {
      if (captured.length >= MAX_ENTRIES) return
      const request = resp.request()
      const url = resp.url()
      const contentType = resp.headers()['content-type'] ?? null
      const resourceType = request.resourceType()
      const entry: CapturedResponse = {
        seq: ++seq,
        ts: new Date().toISOString(),
        phase,
        method: request.method(),
        url,
        status: resp.status(),
        content_type: contentType,
        resource_type: resourceType,
        body_preview: null,
        json_top_keys: null,
        json_array_len: null,
        json_item_keys: null,
      }
      captured.push(entry)

      // тело — только для сетевых JSON/XHR/fetch ответов
      const isJson = (contentType ?? '').includes('json')
      const isApiLike = isJson || resourceType === 'xhr' || resourceType === 'fetch'
      if (!isApiLike) return

      try {
        const body = await resp.body()
        if (body.length > BODY_LIMIT) {
          entry.body_preview = `<тело ${body.length} байт — пропущено>`
          return
        }
        const text = body.toString('utf8')
        entry.body_preview = text.slice(0, 500).replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ')
        let parsed: unknown = undefined
        try {
          parsed = JSON.parse(text)
        } catch {
          /* не JSON — оставляем только preview */
        }
        if (parsed !== undefined) {
          if (Array.isArray(parsed)) {
            entry.json_array_len = parsed.length
            entry.json_item_keys = typeof parsed[0] === 'object' && parsed[0] !== null ? Object.keys(parsed[0] as object).slice(0, 30) : null
          } else if (typeof parsed === 'object' && parsed !== null) {
            entry.json_top_keys = Object.keys(parsed as object).slice(0, 30)
          }
        }
        // свидетельства поиска: тело содержит нормализованное имя объекта
        const normalizedBody = normalizeName(text)
        if (phase === 'search' && normalizedNeedle.length > 5 && normalizedBody.includes(normalizedNeedle)) {
          const matches = normalizedBody.split(normalizedNeedle).length - 1
          evidence.push({
            url,
            note: 'JSON-ответ поиска содержит название объекта',
            top_level_keys: entry.json_top_keys,
            match_count: matches,
            snippet: snippetAround(text, searchName.slice(0, Math.min(40, searchName.length))),
          })
        }
        if (phase === 'search') searchUrls.push(entry)
      } catch {
        /* тело недоступно (редирект/стрим) — это нормально */
      }
    }

    let report: Record<string, unknown>
    try {
      report = await withBrowserSession(
        MGE_SITE,
        async (context) => {
          context.on('response', (r) => void onResponse(r).catch(() => undefined))

          // 1) залогиниться (storageState уже в контексте; при истечении — автологин)
          if (!state) {
            await ensureLoggedIn(context, MGE_SITE)
            notes.push('Сессии не было — выполнен автологин по MGE_LOGIN/MGE_PASSWORD, storageState сохранён')
          }

          const page = await context.newPage()
          page.setDefaultTimeout(30000)
          await page.goto(MGE_SITE.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
          await page.waitForLoadState('networkidle').catch(() => undefined)
          phase = 'settle'
          await page.waitForTimeout(Math.min(q.duration_ms, 60000))
          phase = 'load' // фиксируем «после загрузки»

          const loggedIn = !looksLikeLoginPage(page, MGE_SITE)
          if (!loggedIn) {
            notes.push(
              `После загрузки ${page.url()} страница похожа на форму входа (паттерн ${MGE_SITE.loginUrlPattern}) — вероятно, storageState истёк. Обновите: npm run login:mge`,
            )
          }

          const mainScreenshot = q.screenshot
            ? await page.screenshot({ type: 'jpeg', quality: 70 }).then((b) => b.toString('base64'))
            : null
          const finalUrl = page.url()
          const finalTitle = await page.title().catch(() => '')

          // 2) пробный поиск объекта
          let searchResult: Record<string, unknown> = {
            enabled: false,
            object: firstObject ? { id: firstObject.id, name: firstObject.name, code_ds: firstObject.code_ds } : null,
            note: 'поиск не выполнялся',
          }

          {
            phase = 'search'
            const selectorsTried: string[] = []
            let typed = false
            for (const sel of MGE_SITE.searchSelectors) {
              try {
                const loc = page.locator(sel).first()
                await loc.waitFor({ state: 'visible', timeout: 4000 })
                await loc.fill(searchName)
                await loc.press('Enter')
                typed = true
                selectorsTried.push(`${sel} — ок`)
                break
              } catch {
                selectorsTried.push(`${sel} — не найден`)
              }
            }
            await page.waitForTimeout(5000) // ждём XHR поиска
            const searchScreenshot =
              q.screenshot && typed
                ? await page.screenshot({ type: 'jpeg', quality: 70 }).then((b) => b.toString('base64'))
                : null

            searchResult = {
              enabled: true,
              object: firstObject ? { id: firstObject.id, name: firstObject.name, code_ds: firstObject.code_ds } : null,
              typed_into: typed ? searchName : null,
              selectors_tried: selectorsTried,
              urls_during_search: searchUrls
                .filter((u) => u.resource_type === 'xhr' || u.resource_type === 'fetch' || (u.content_type ?? '').includes('json'))
                .slice(0, 50)
                .map((u) => ({ method: u.method, url: u.url, status: u.status, content_type: u.content_type })),
              found: evidence.length > 0,
              evidence: evidence.slice(0, 10),
              screenshot_base64: searchScreenshot,
              note: typed
                ? evidence.length > 0
                  ? `Название объекта найдено в ${evidence.length} JSON-ответ(ах) — см. evidence`
                  : 'Название объекта не встретилось в перехваченных JSON — снимок всё равно полезен (см. urls_during_search)'
                : 'Ни один из известных селекторов поиска не подошёл — пришлите отчёт, добавим селектор в MGE_SEARCH_SELECTORS',
            }
            phase = 'settle'
          }

          await page.close()

          const byContent: Record<string, number> = {}
          for (const c of captured) {
            const key = (c.content_type ?? '—').split(';')[0]!
            byContent[key] = (byContent[key] ?? 0) + 1
          }

          return {
            ok: true,
            started_at: startedAt.toISOString(),
            duration_ms: q.duration_ms,
            base_url: MGE_SITE.baseUrl,
            session: {
              source: 'mge',
              had_storage_state: state !== null,
              logged_in_guess: loggedIn,
            },
            page: {
              url: finalUrl,
              title: finalTitle,
              screenshot_base64: mainScreenshot,
            },
            responses: captured,
            search: searchResult,
            stats: {
              total: captured.length,
              xhr_or_fetch: captured.filter((c) => c.resource_type === 'xhr' || c.resource_type === 'fetch').length,
              json: captured.filter((c) => (c.content_type ?? '').includes('json')).length,
              by_content_type: byContent,
            },
            notes,
          }
        },
        { headless: !q.headful },
      )
    } catch (err) {
      app.log.error({ err }, 'diagnostics/mge упал')
      return reply.code(502).send({
        ok: false,
        error: `Диагностика не удалась: ${err instanceof Error ? err.message : String(err)}`,
        hint: 'Проверьте: MGE_BASE_URL, наличие сессии (npm run login:mge), доступность сайта из сети, где запущен api-контейнер',
        captured_responses: captured.length,
        responses: captured, // всё, что успели перехватить до падения
      })
    }

    app.log.info({ total: (report.stats as Record<string, number>).total }, 'diagnostics/mge готов')
    return reply.send(report)
  })
}
