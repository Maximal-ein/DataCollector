/**
 * Сводная таблица для SPA: GET /api/table.
 *
 * Режимы:
 *   source='unified' → v_metrics_unified (победители по приоритетам источников)
 *   source='<код>'    → metrics_<код>, последний срез по (object, key, period)
 *                       (полная история — через /api/objects/:id/metrics?raw=1)
 */
import { Prisma } from '@prisma/client'
import { getPrisma } from '../index.js'
import type { MetricSourceCode, TableColumn, TableRow, SourceInfo, TableSource } from '@dc/shared'
import { METRIC_SOURCE_CODES, SOURCE_LABELS } from '@dc/shared'

const prisma = getPrisma()

interface CellRow {
  object_id: number
  cells: Record<string, { v: string | null; n: number | null; s: string; u: string | null; c: Date }>
}

export interface PivotResult {
  columns: TableColumn[]
  rows: TableRow[]
  total: number
  periods: string[]
  sources: SourceInfo[]
  data_collected_at: Date | null
}

export async function pivotTable(params: {
  source: TableSource
  period?: string
  search?: string
  limit: number
  offset: number
}): Promise<PivotResult> {
  const { source, period, search, limit, offset } = params
  const periodFilter = period ?? null
  const like = search ? `%${search}%` : null

  // 1) Колонки: метрические ключи выборки
  const from = source === 'unified' ? Prisma.raw(`"v_metrics_unified"`) : Prisma.raw(`"metrics_${source}"`)
  const keyRows = await prisma.$queryRaw<{ metric_key: string; cnt: bigint }[]>(
    Prisma.sql`SELECT "metric_key", count(*)::bigint AS cnt FROM ${from}
      WHERE (${periodFilter}::text IS NULL OR "period" = ${periodFilter})
      GROUP BY "metric_key" ORDER BY "metric_key"`,
  )
  const columns: TableColumn[] = keyRows.map((r) => ({
    key: r.metric_key,
    label: r.metric_key,
    fill: 0, // заполняется ниже
  }))

  // 2) Ячейки: jsonb_object_agg по объекту
  const cellsExpr =
    source === 'unified'
      ? Prisma.sql`jsonb_object_agg("metric_key", jsonb_build_object('v', "metric_value", 'n', "metric_value_num", 's', "source_code", 'u', "unit", 'c', "collected_at"))`
      : Prisma.sql`jsonb_object_agg("metric_key", jsonb_build_object('v', "metric_value", 'n', "metric_value_num", 's', ${source}::text, 'u', "unit", 'c', "collected_at"))`

  const cellsFrom =
    source === 'unified'
      ? Prisma.sql`(SELECT "object_id", ${cellsExpr} AS cells FROM "v_metrics_unified"
           WHERE (${periodFilter}::text IS NULL OR "period" = ${periodFilter}) GROUP BY "object_id")`
      : Prisma.sql`(SELECT "object_id", ${cellsExpr} AS cells FROM (
             SELECT DISTINCT ON ("object_id", "metric_key", "period") *
             FROM "metrics_${Prisma.raw(source)}"
             WHERE (${periodFilter}::text IS NULL OR "period" = ${periodFilter})
             ORDER BY "object_id", "metric_key", "period", "collected_at" DESC
           ) latest GROUP BY "object_id")`

  const objectFilter = Prisma.sql`
    WHERE "o"."is_active"
      AND (${like}::text IS NULL OR "o"."name" ILIKE ${like} OR "o"."code_ds" ILIKE ${like} OR "o"."uin" ILIKE ${like})`

  const cellRows = await prisma.$queryRaw<CellRow[]>(
    Prisma.sql`SELECT "o"."id" AS object_id, COALESCE("c"."cells", '{}'::jsonb) AS cells
      FROM "objects" "o"
      LEFT JOIN ${cellsFrom} "c" ON "c"."object_id" = "o"."id"
      ${objectFilter}
      ORDER BY "o"."name" LIMIT ${limit} OFFSET ${offset}`,
  )
  const totalRows = await prisma.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT count(*)::bigint AS count FROM "objects" "o" ${objectFilter}`,
  )
  const total = Number(totalRows[0]?.count ?? 0)

  const rows: TableRow[] = cellRows.map((r) => {
    const cells: TableRow['cells'] = {}
    for (const [key, cell] of Object.entries(r.cells ?? {})) {
      cells[key] = {
        v: cell.v ?? null,
        n: cell.n ?? null,
        s: cell.s,
        u: cell.u ?? null,
        c: new Date(cell.c).toISOString(),
      }
    }
    return {
      object_id: r.object_id,
      name: '',
      code_ds: null,
      uin: null,
      cells,
    }
  })

  // 3) Подмешиваем name/code_ds/uin одним запросом (порядок сохраняем в Node)
  const ids = rows.map((r) => r.object_id)
  if (ids.length > 0) {
    const meta = await prisma.$queryRaw<{ id: number; name: string; code_ds: string | null; uin: string | null }[]>(
      Prisma.sql`SELECT "id", "name", "code_ds", "uin" FROM "objects" WHERE "id" IN (${Prisma.join(ids)})`,
    )
    const byId = new Map(meta.map((m) => [m.id, m]))
    for (const row of rows) {
      const m = byId.get(row.object_id)
      row.name = m?.name ?? ''
      row.code_ds = m?.code_ds ?? null
      row.uin = m?.uin ?? null
    }
  }

  // fill-доля колонок (по текущей странице)
  for (const col of columns) {
    let filled = 0
    for (const row of rows) if (row.cells[col.key] !== undefined) filled++
    col.fill = rows.length > 0 ? Math.round((filled / rows.length) * 100) / 100 : 0
  }

  // 4) Периоды выборки (для фильтра)
  const periods = await prisma.$queryRaw<{ period: string }[]>(
    Prisma.sql`SELECT DISTINCT "period" FROM ${from} ORDER BY "period"`,
  )

  // 5) Справочник источников + наличие данных
  const sourcesRows = await prisma.$queryRaw<{ code: string; priority: number; enabled: boolean }[]>`
    SELECT "code", "priority", "enabled" FROM "sources" WHERE "code" != 'sudir'`
  const sources: SourceInfo[] = []
  for (const s of sourcesRows) {
    if (!METRIC_SOURCE_CODES.includes(s.code as MetricSourceCode)) continue
    const has = await prisma.$queryRaw<{ ok: boolean }[]>(
      Prisma.sql`SELECT EXISTS (SELECT 1 FROM "metrics_${Prisma.raw(s.code)}" LIMIT 1) AS ok`,
    )
    sources.push({
      code: s.code,
      label: (SOURCE_LABELS as Record<string, string>)[s.code] ?? s.code,
      priority: s.priority,
      enabled: s.enabled,
      has_data: has[0]?.ok === true,
    })
  }
  sources.sort((a, b) => b.priority - a.priority)

  // 6) Свежесть данных (максимум collected_at в представлении)
  const fresh = await prisma.$queryRaw<{ max: Date | null }[]>`
    SELECT max("collected_at") AS max FROM "v_metrics_unified"`

  return {
    columns,
    rows,
    total,
    periods: periods.map((p) => p.period),
    sources,
    data_collected_at: fresh[0]?.max ?? null,
  }
}
