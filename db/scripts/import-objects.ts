/**
 * Импорт объектов из выгрузки СУИД (export.xlsx).
 *
 * Использование:
 *   npm run import:objects --file=export.xlsx [--sheet="Список проектов"]
 *
 * Маппинг колонок (согласован на ревью):
 *   A «Идентификатор проекта» → suid_id (hex, UNIQUE)
 *   B «Наименование проекта»  → name
 *   C «Код ДС»                → code_ds (UNIQUE, nullable)
 *   D «УИН»                   → uin (UNIQUE, nullable)
 *   Остальные колонки (роли, статусы, даты, хештеги, инициатор) НЕ импортируются.
 *
 * Правила:
 *   * нормализация: trim; пустая строка → NULL;
 *   * строка должна содержать хотя бы один идентификатор (suid_id/code_ds/uin),
 *     иначе — ошибка строки NO_IDENTIFIER;
 *   * upsert по приоритету идентификаторов suid_id → code_ds → uin;
 *   * если разные идентификаторы одной строки указывают на РАЗНЫЕ существующие
 *     объекты — ошибка IDENTIFIER_CONFLICT (строка не записывается);
 *   * идемпотентность: excel_row_hash (SHA-256 нормализованной строки);
 *     повторный импорт без изменений → skipped;
 *   * на все записанные строки ставится import_batch_id (UUID запуска).
 *
 * Выход: отчёт created / updated / skipped / errors (+ причины построчно).
 */
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { prisma } from '../src/index.js'

interface RowOutcome {
  row: number
  status: 'created' | 'updated' | 'skipped' | 'error'
  detail?: string
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('result' in value) return String((value as { result?: unknown }).result ?? '')
    if (value instanceof Date) return value.toISOString()
    return ''
  }
  return String(value)
}

function norm(value: string): string | null {
  const t = value.replace(/\s+/g, ' ').trim()
  return t.length > 0 ? t : null
}

function rowHash(row: { suidId: string | null; name: string; codeDs: string | null; uin: string | null }): string {
  return createHash('sha256').update(JSON.stringify([row.suidId, row.name, row.codeDs, row.uin])).digest('hex')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const fileArg = args.find((a) => a.startsWith('--file='))
  const sheetArg = args.find((a) => a.startsWith('--sheet='))
  const file = fileArg ? fileArg.slice(7) : 'export.xlsx'

  const abs = path.resolve(file)
  try {
    await readFile(abs)
  } catch {
    console.error(`Файл не найден: ${abs}`)
    process.exit(1)
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(abs)
  const ws = sheetArg
    ? wb.getWorksheet(sheetArg.slice(8))
    : (wb.worksheets[0] ?? undefined)
  if (!ws) {
    console.error(sheetArg ? `Лист «${sheetArg.slice(8)}» не найден` : 'В файле нет листов')
    process.exit(1)
  }

  // Заголовок: колонки A–D ищем по названию (устойчиво к перестановке)
  const header = ws.getRow(1)
  const colOf: Record<string, number> = {}
  for (let c = 1; c <= Math.max(ws.columnCount, 4); c++) {
    const title = cellText(header.getCell(c).value).trim().toLowerCase()
    if (title.includes('идентификатор проекта')) colOf.suidId = c
    else if (title.includes('наименование проекта')) colOf.name = c
    else if (title.trim() === 'код дс' || title.includes('код дс')) colOf.codeDs = c
    else if (title === 'уин') colOf.uin = c
  }
  if (!colOf.suidId || !colOf.name || !colOf.codeDs || !colOf.uin) {
    console.error(
      `Не найдены колонки A–D. Найдено: ${JSON.stringify(colOf)}. ` +
        'Ожидаются заголовки «Идентификатор проекта», «Наименование проекта», «Код ДС», «УИН».',
    )
    process.exit(1)
  }

  const batchId = randomUUID()
  const outcomes: RowOutcome[] = []

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const suidId = norm(cellText(row.getCell(colOf.suidId!).value))
    const name = norm(cellText(row.getCell(colOf.name!).value))
    const codeDs = norm(cellText(row.getCell(colOf.codeDs!).value))
    const uin = norm(cellText(row.getCell(colOf.uin!).value))

    if (!suidId && !codeDs && !uin) {
      outcomes.push({ row: r, status: 'error', detail: 'NO_IDENTIFIER: строка без идентификаторов (пустые A, C, D)' })
      continue
    }
    if (!name) {
      outcomes.push({ row: r, status: 'error', detail: 'NO_NAME: пустое наименование (колонка B)' })
      continue
    }

    const hash = rowHash({ suidId, name, codeDs, uin })

    // поиск существующих по каждому идентификатору
    const found = new Map<number, 'suid_id' | 'code_ds' | 'uin'>()
    const lookups: { field: 'suidId' | 'codeDs' | 'uin'; value: string }[] = []
    if (suidId) lookups.push({ field: 'suidId', value: suidId })
    if (codeDs) lookups.push({ field: 'codeDs', value: codeDs })
    if (uin) lookups.push({ field: 'uin', value: uin })
    for (const l of lookups) {
      const existing = await prisma.object.findFirst({
        where: { [l.field]: l.value },
        select: { id: true, excelRowHash: true },
      })
      if (existing && !found.has(existing.id)) found.set(existing.id, l.field === 'suidId' ? 'suid_id' : l.field === 'codeDs' ? 'code_ds' : 'uin')
    }

    // разные идентификаторы → разные объекты: конфликт
    if (found.size > 1) {
      outcomes.push({
        row: r,
        status: 'error',
        detail: `IDENTIFIER_CONFLICT: идентификаторы строки указывают на разные объекты (${[...found.keys()].join(', ')})`,
      })
      continue
    }

    if (found.size === 1) {
      const [objId] = [...found.keys()]!
      const existing = await prisma.object.findUnique({ where: { id: objId } })
      if (existing?.excelRowHash === hash) {
        outcomes.push({ row: r, status: 'skipped', detail: 'без изменений (hash совпал)' })
        continue
      }
      await prisma.object.update({
        where: { id: objId },
        data: {
          name,
          codeDs: codeDs ?? existing?.codeDs ?? null,
          uin: uin ?? existing?.uin ?? null,
          suidId: suidId ?? existing?.suidId ?? null,
          importBatchId: batchId,
          excelRowHash: hash,
        },
      })
      outcomes.push({ row: r, status: 'updated', detail: `id=${objId}` })
      continue
    }

    const created = await prisma.object.create({
      data: { name, codeDs, uin, suidId, importBatchId: batchId, excelRowHash: hash },
      select: { id: true },
    })
    outcomes.push({ row: r, status: 'created', detail: `id=${created.id}` })
  }

  const counts = outcomes.reduce<Record<string, number>>((acc, o) => ((acc[o.status] = (acc[o.status] ?? 0) + 1), acc), {})
  console.log('──────────────────────────────')
  console.log(`Импорт завершён: ${abs}`)
  console.log(`Партия (import_batch_id): ${batchId}`)
  console.log(`  создано:   ${counts.created ?? 0}`)
  console.log(`  обновлено: ${counts.updated ?? 0}`)
  console.log(`  пропущено (без изменений): ${counts.skipped ?? 0}`)
  console.log(`  ошибок:    ${counts.error ?? 0}`)
  const errors = outcomes.filter((o) => o.status === 'error')
  if (errors.length > 0) {
    console.log('\nОшибки:')
    for (const e of errors) console.log(`  строка ${e.row}: ${e.detail}`)
  }
  const total = await prisma.object.count()
  console.log(`\nВсего объектов в БД: ${total}`)
}

main()
  .catch((err) => {
    console.error('Импорт прерван:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
