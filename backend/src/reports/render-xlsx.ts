/**
 * Рендер xlsx-шаблона (ExcelJS).
 *
 * Поддерживаемый язык шаблона:
 *   {{object.name}} {{object.code_ds}} {{object.uin}} {{object.suid_id}}
 *   {{object.address}} {{generated_at}} {{period}} {{metrics_count}}
 *
 * Повторяющийся блок метрик — маркеры в ЯЧЕЙКАХ СТРОК:
 *   строка с {{#metrics}} … строки-шаблоны … строка с {{/metrics}}
 *   (если оба маркера в одной строке — эта строка и есть шаблон).
 * В строках-шаблонах: {{metric.key}} {{metric.value}} {{metric.unit}}
 *   {{metric.period}} {{metric.source}} {{metric.collected_at}}
 *
 * Стили строк-шаблонов копируются в сгенерированные строки.
 */
import { readFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import type { ReportData } from '@dc/shared'

type Ctx = Record<string, unknown>

function resolvePath(ctx: Ctx, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = ctx
  for (const p of parts) {
    if (cur === null || cur === undefined) return null
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function replaceTokens(text: string, ctx: Ctx): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path: string) => {
    const v = resolvePath(ctx, path)
    return v === null || v === undefined ? '' : String(v)
  })
}

const RE_START = /\{\{\s*#metrics\s*\}\}/
const RE_END = /\{\{\s*\/metrics\s*\}\}/
const HAS_TOKEN = /\{\{\s*[#/]?[a-zA-Z0-9_.]+\s*\}\}/

/** Найти границы блока метрик. Возвращает [startRow, endRow] (1-based) либо null. */
function findMetricsBlock(ws: ExcelJS.Worksheet): [number, number] | null {
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    let hasStart = false
    let hasEnd = false
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value
      if (typeof v !== 'string') continue
      if (RE_START.test(v)) hasStart = true
      if (RE_END.test(v)) hasEnd = true
    }
    if (hasStart && hasEnd) return [r, r] // оба маркера в одной строке
    if (hasStart) {
      for (let r2 = r + 1; r2 <= ws.rowCount; r2++) {
        const row2 = ws.getRow(r2)
        for (let c = 1; c <= row2.cellCount; c++) {
          if (typeof row2.getCell(c).value === 'string' && RE_END.test(row2.getCell(c).value as string)) {
            return [r, r2]
          }
        }
      }
      return [r, r] // незакрытый блок: шаблон — сама строка с маркером
    }
  }
  return null
}

function cellTexts(row: ExcelJS.Row): (string | null)[] {
  const out: (string | null)[] = []
  for (let c = 1; c <= Math.max(row.cellCount, 1); c++) {
    const v = row.getCell(c).value
    out.push(typeof v === 'string' ? v : null)
  }
  return out
}

export async function renderXlsx(templatePath: string, data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(templatePath)
  const baseCtx: Ctx = {
    object: data.object,
    generated_at: data.generated_at,
    period: data.period === '' ? 'все периоды' : data.period || 'все периоды',
    metrics_count: data.metrics.length,
  }

  for (const ws of wb.worksheets) {
    // 1) повторяющийся блок метрик
    const block = findMetricsBlock(ws)
    if (block) {
      const [startR, endR] = block
      const sameRow = startR === endR
      const templateRows = sameRow
        ? [ws.getRow(startR)]
        : Array.from({ length: endR - startR - 1 }, (_, i) => ws.getRow(startR + 1 + i))

      // клоны строк (значения + стили), по набору на каждую метрику
      const generated: { values: (string | null)[]; styles: unknown[]; numFmt: unknown[] }[][] = []
      for (const m of data.metrics) {
        const ctx: Ctx = {
          ...baseCtx,
          metric: {
            key: m.key,
            value: m.value ?? '',
            unit: m.unit ?? '',
            period: m.period === '' ? 'текущее' : m.period,
            source: m.source,
            collected_at: m.collected_at,
          },
        }
        const rowsForMetric = templateRows.map((trow) => {
          const texts = cellTexts(trow)
          const values = texts.map((t) => (t === null ? null : replaceTokens(t, ctx)))
          const styles = texts.map((_t, i) => ({ ...(trow.getCell(i + 1).style ?? {}) }) as unknown)
          const numFmt = texts.map((_t, i) => trow.getCell(i + 1).numFmt as unknown)
          return { values, styles, numFmt }
        })
        generated.push(rowsForMetric)
      }

      // вставляем сгенерированные строки ПОСЛЕ начала блока, затем удаляем маркеры
      const insertAt = endR + 1
      const flat = generated.flat()
      // выравниваем длины строк к максимальной ширине шаблона
      const width = Math.max(...templateRows.map((r) => Math.max(r.cellCount, 1)), 1)
      const newRows = flat.map((gr) => {
        const vals: (string | null)[] = [...gr.values]
        const styles = [...gr.styles]
        const numFmt = [...gr.numFmt]
        while (vals.length < width) vals.push(null)
        while (styles.length < width) styles.push({})
        while (numFmt.length < width) numFmt.push(undefined)
        return { vals, styles, numFmt }
      })

      ws.spliceRows(insertAt, 0, ...newRows.map((nr) => nr.vals))
      // применяем стили к вставленным строкам
      for (let i = 0; i < newRows.length; i++) {
        const row = ws.getRow(insertAt + i)
        for (let c = 1; c <= width; c++) {
          const cell = row.getCell(c)
          cell.style = (newRows[i]!.styles[c - 1] ?? {}) as typeof cell.style
          const fmt = newRows[i]!.numFmt[c - 1]
          if (typeof fmt === 'string' && fmt !== '') cell.numFmt = fmt
        }
      }
      // удаляем исходные строки-шаблоны с маркерами (startR..endR)
      ws.spliceRows(startR, endR - startR + 1)
    }

    // 2) простые токены во всех оставшихся ячейках
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      for (let c = 1; c <= row.cellCount; c++) {
        const cell = row.getCell(c)
        if (typeof cell.value === 'string' && HAS_TOKEN.test(cell.value)) {
          cell.value = replaceTokens(cell.value, baseCtx)
        }
      }
    }
    // мержить ячейки заново не нужно — mergeRanges сохраняются
  }

  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}
