/**
 * Нормализация табличных данных (Google Sheets / Яндекс Таблицы 360)
 * в метрики объектов.
 *
 * Поддерживаются ДВА формата таблицы (выбор — автоматически):
 *
 * 1) «широкий» (по умолчанию): одна строка = один объект,
 *    каждая колонка (кроме идентифицирующих) = метрика:
 *      | Наименование | Код ДС | Готовность, % | Бюджет, млн |
 *      | Школа №1     | 023-1  | 45            | 1200        |
 *    → объект «Школа №1», метрики «Готовность, %»=45, «Бюджет, млн»=1200.
 *
 * 2) «длинный» (если задан TABULAR_MAPPING_JSON):
 *      | Объект | Показатель | Значение | Ед. изм. | Период |
 *      | Школа  | Готовность | 45       | %        | 2026-Q3 |
 *    {"objectColumns":["Объект","Наименование","Наименование объекта"],
 *     "keyColumn":"Показатель","valueColumn":"Значение",
 *     "unitColumn":"Ед. изм.","periodColumn":"Период",
 *     "codeColumn":"Код ДС","prefix":""}
 *
 * Идентификация объекта: колонка «Код ДС» (точное совпадение) либо
 * «Наименование…» (нечёткий матчинг, как в МГЭ).
 */
import type { NormalizedMetric, MetricSourceCode } from '@dc/shared'
import { PeriodSchema } from '@dc/shared'

export interface TabularMapping {
  objectColumns: string[]
  codeColumn: string
  keyColumn?: string
  valueColumn?: string
  unitColumn?: string
  periodColumn?: string
  prefix: string
}

export function loadMapping(): TabularMapping {
  const raw = process.env.TABULAR_MAPPING_JSON
  const base: TabularMapping = {
    objectColumns: ['Наименование объекта', 'Наименование проекта', 'Объект', 'Наименование'],
    codeColumn: 'Код ДС',
    prefix: '',
  }
  if (!raw) return base
  try {
    return { ...base, ...(JSON.parse(raw) as Partial<TabularMapping>) }
  } catch {
    throw new Error('TABULAR_MAPPING_JSON — не валидный JSON')
  }
}

export interface ObjectMetricsDraft {
  /** имя объекта из таблицы (для матчинга) */
  name: string | null
  /** код ДС из таблицы (точный матчинг) */
  codeDs: string | null
  metrics: NormalizedMetric[]
}

function findCol(header: string[], candidates: string[]): number {
  for (const cand of candidates) {
    const idx = header.findIndex((h) => h.trim().toLowerCase() === cand.trim().toLowerCase())
    if (idx >= 0) return idx
  }
  return -1
}

function toMetric(source: MetricSourceCode, key: string, value: string, unit: string | null, period: string, prefix: string): NormalizedMetric {
  const fullKey = prefix ? `${prefix}${key}` : key
  const num = value.trim() !== '' && !Number.isNaN(Number(value.replace(',', '.').replace(/\s/g, '')))
    ? Number(value.replace(',', '.').replace(/\s/g, ''))
    : null
  return {
    metricKey: fullKey.slice(0, 200),
    metricValue: value === '' ? null : value,
    metricValueNum: num,
    unit,
    period: PeriodSchema.safeParse(period).success ? period : '',
    rawPayload: { source },
  }
}

/** Разобрать таблицу в черновики «объект → метрики». */
export function parseTable(
  table: { header: string[]; rows: string[][] },
  source: MetricSourceCode,
): ObjectMetricsDraft[] {
  const mapping = loadMapping()
  const { header, rows } = table

  const nameCol = findCol(header, mapping.objectColumns)
  const codeCol = findCol(header, [mapping.codeColumn, 'Код ДС', 'КодДС', 'code_ds'])
  const keyCol = mapping.keyColumn ? findCol(header, [mapping.keyColumn]) : -1
  const valueCol = mapping.valueColumn ? findCol(header, [mapping.valueColumn]) : -1
  const unitCol = mapping.unitColumn ? findCol(header, [mapping.unitColumn]) : -1
  const periodCol = mapping.periodColumn ? findCol(header, [mapping.periodColumn]) : -1

  const drafts = new Map<string, ObjectMetricsDraft>()
  const getDraft = (name: string | null, codeDs: string | null): ObjectMetricsDraft | null => {
    const id = `${name ?? ''}|${codeDs ?? ''}`
    if (!drafts.has(id)) drafts.set(id, { name, codeDs, metrics: [] })
    return drafts.get(id)!
  }

  // «длинный» формат: есть и keyColumn, и valueColumn
  if (keyCol >= 0 && valueCol >= 0) {
    for (const row of rows) {
      const name = nameCol >= 0 ? (row[nameCol] ?? '').trim() : null
      const codeDs = codeCol >= 0 ? (row[codeCol] ?? '').trim() || null : null
      if (!name && !codeDs) continue
      const key = (row[keyCol] ?? '').trim()
      if (!key) continue
      const value = row[valueCol] ?? ''
      const unit = unitCol >= 0 ? (row[unitCol] ?? '').trim() || null : null
      const period = periodCol >= 0 ? (row[periodCol] ?? '').trim() : ''
      getDraft(name || null, codeDs)?.metrics.push(toMetric(source, key, value, unit, period, mapping.prefix))
    }
    return [...drafts.values()]
  }

  // «широкий» формат: каждая колонка — метрика
  const skipCols = new Set([nameCol, codeCol, periodCol].filter((c) => c >= 0))
  for (const row of rows) {
    const name = nameCol >= 0 ? (row[nameCol] ?? '').trim() : null
    const codeDs = codeCol >= 0 ? (row[codeCol] ?? '').trim() || null : null
    if (!name && !codeDs) continue
    const period = periodCol >= 0 ? (row[periodCol] ?? '').trim() : ''
    const draft = getDraft(name || null, codeDs)!
    header.forEach((h, c) => {
      if (skipCols.has(c) || h.trim() === '') return
      draft.metrics.push(toMetric(source, h.trim(), row[c] ?? '', null, period, mapping.prefix))
    })
  }
  return [...drafts.values()]
}
