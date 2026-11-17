/**
 * Нормализатор МГЭ (восстановлен из шага 4; правки — ТОЛЬКО после
 * диагностических логов заказчика, см. POST /api/diagnostics/mge).
 *
 * ВНИМАНИЕ: структуры JSON-ответов МГЭ — ПРЕДПОЛОЖЕНИЯ. Все парсеры
 * написаны защитно (несколько вариантов формы данных) и помечены ASSUMPTION.
 *
 * Экспортирует:
 *   extractCandidates(json) — список {id, name} из ответа поиска;
 *   extractMetrics(json)    — метрики из JSON карточки объекта
 *     (flattening листьев дерева + MGE_METRIC_MAP для переименования).
 */
import type { NormalizedMetric } from '@dc/shared'
import { PeriodSchema } from '@dc/shared'

export interface RawCandidate {
  id: string
  name: string
}

/** Массив внутри JSON: items | data | data.items | data.content | корень. */
function findArray(json: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 3 || json === null || typeof json !== 'object') return null
  if (Array.isArray(json)) return json.every((x) => typeof x === 'object' && x !== null) ? (json as Record<string, unknown>[]) : null
  const obj = json as Record<string, unknown>
  for (const key of ['items', 'data', 'content', 'results', 'list']) {
    if (key in obj) {
      const found = findArray(obj[key], depth + 1)
      if (found) return found
    }
  }
  return null
}

const NAME_FIELDS = ['name', 'projectName', 'project_name', 'title', 'objectName', 'object_name', 'наименование']
const ID_FIELDS = ['id', 'projectId', 'project_id', 'objectId', 'object_id', 'mgeId', 'guid', 'uuid']

/** ASSUMPTION: ответ поиска содержит массив объектов с id и наименованием. */
export function extractCandidates(json: unknown): RawCandidate[] {
  const arr = findArray(json)
  if (!arr) return []
  const out: RawCandidate[] = []
  for (const item of arr) {
    const name = NAME_FIELDS.map((f) => item[f]).find((v) => typeof v === 'string' && v.trim().length > 0)
    const id = ID_FIELDS.map((f) => item[f]).find((v) => typeof v === 'string' || typeof v === 'number')
    if (typeof name === 'string' && id !== undefined) out.push({ id: String(id), name })
  }
  return out
}

/** Карта переименования путей МГЭ → канонические ключи (env MGE_METRIC_MAP, JSON). */
function metricMap(): Record<string, string> {
  const raw = process.env.MGE_METRIC_MAP
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

function flatten(node: unknown, prefix: string, out: { path: string; value: unknown }[]): void {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    out.push({ path: prefix, value: node.length === 0 ? null : JSON.stringify(node).slice(0, 500) })
    return
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out)
    }
    return
  }
  out.push({ path: prefix, value: node })
}

const PERIOD_VALUE_RE = /^(\d{4})(?:-Q([1-4])|-(0[1-9]|1[0-2]))?$/
const PERIOD_KEY_RE = /(^|\.)(period|periods|quarter|year|month|год|квартал|период)$/i

/**
 * ASSUMPTION: метрики карточки — листья дерева JSON; период задаётся либо
 * полем period на верхнем уровне, либо полем-значением, похожим на период.
 * Числа → metric_value_num; «unit»-поля присоединяются к соседним метрикам.
 */
export function extractMetrics(json: unknown): NormalizedMetric[] {
  const map = metricMap()
  const flat: { path: string; value: unknown }[] = []
  flatten(json, '', flat)

  // период пакета (если есть)
  let batchPeriod = ''
  for (const { path, value } of flat) {
    if (PERIOD_KEY_RE.test(path) && typeof value === 'string' && PeriodSchema.safeParse(value).success) {
      batchPeriod = value
      break
    }
  }

  const metrics: NormalizedMetric[] = []
  for (const { path, value } of flat) {
    if (PERIOD_KEY_RE.test(path)) continue // период — не метрика
    if (/(^|\.)(unit|units|ед_изм|единица_измерения)$/i.test(path)) continue // единицы — отдельно

    const key = map[path] ?? path
    if (typeof value === 'number') {
      metrics.push({ metricKey: key, metricValue: String(value), metricValueNum: value, unit: null, period: batchPeriod, rawPayload: { path } })
    } else if (typeof value === 'string') {
      if (PERIOD_VALUE_RE.test(value.trim()) && /(год|year|quarter|квартал|период|period)/i.test(path)) continue
      const num = value.trim() !== '' && !Number.isNaN(Number(value.replace(',', '.'))) ? Number(value.replace(',', '.')) : null
      metrics.push({
        metricKey: key,
        metricValue: value,
        metricValueNum: num,
        unit: null,
        period: batchPeriod,
        rawPayload: { path },
      })
    } else if (typeof value === 'boolean') {
      metrics.push({ metricKey: key, metricValue: String(value), metricValueNum: null, unit: null, period: batchPeriod, rawPayload: { path } })
    }
  }
  return metrics
}
