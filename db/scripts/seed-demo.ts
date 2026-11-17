/**
 * Демо-данные для локальной проверки SPA и отчётов БЕЗ реальных источников.
 *
 *   npm run seed:demo        — фиктивные метрики для всех объектов из БД
 *   npm run seed:demo:clear  — полная очистка метрик (TRUNCATE metrics_*)
 *
 * Данные помечены collected_at = момент запуска; значения детерминированы
 * (seeded PRNG от object_id) — повторный запуск даёт те же числа.
 * Использовать только в dev-окружении!
 *
 * Покрытие подобрано для демонстрации приоритетов:
 *   mge       — все ключи (источник-победитель при конфликте)
 *   dashboard — подмножество с ДРУГИМИ значениями (видно вытеснение в view)
 *   mgz/suid  — подмножества уникальных ключей
 *   gsheets/yandex — немного ключей (источники выключены, но данные есть)
 */
import { getPrisma, upsertMetricBatch } from '../src/index.js'
import type { UpsertMetricRow } from '../src/index.js'
import { PrismaClient } from '@prisma/client'

const prisma = getPrisma()

const KEYS_CURRENT: [string, string][] = [
  ['Статус проекта', ''],
  ['Стадия', ''],
  ['Готовность проекта, %', '%'],
  ['Готовность ПД, %', '%'],
  ['Готовность СМР, %', '%'],
  ['Категория объекта', ''],
  ['Назначение', ''],
  ['Адрес', ''],
  ['Застройщик', ''],
  ['Технический заказчик', ''],
  ['Генподрядчик', ''],
  ['Руководитель проекта', ''],
  ['Дата начала строительства', ''],
  ['Дата окончания (план)', ''],
  ['Разрешение на строительство', ''],
  ['Тип разрешения', ''],
  ['Кол-во этажей', 'эт.'],
  ['Площадь объекта, кв.м', 'кв.м'],
  ['Площадь застройки, кв.м', 'кв.м'],
  ['Строительный объём, куб.м', 'куб.м'],
  ['Количество жилых помещений', 'ед.'],
  ['Ввод жилой площади, кв.м', 'кв.м'],
  ['Бюджет (кап. вложения), млн руб.', 'млн руб.'],
  ['Освоено на текущую дату, млн руб.', 'млн руб.'],
  ['Заключение ГГЭ', ''],
  ['Дата заключения ГГЭ', ''],
  ['Статус ГГЭ', ''],
  ['Экспертиза: № дела', ''],
  ['Экспертиза: смета, млн руб.', 'млн руб.'],
  ['Экспертиза: дата подачи', ''],
  ['Экспертиза: дата приостановки', ''],
  ['Замечания открытые, шт', 'шт'],
  ['Замечания закрытые, шт', 'шт'],
  ['Отказы, шт', 'шт'],
  ['Целевая функция', ''],
  ['Номер функции', ''],
  ['Показатель бюджета', ''],
  ['Текущий контроль', ''],
]

const KEYS_QUARTER: [string, string][] = [
  ['План кап. вложений, млн руб.', 'млн руб.'],
  ['Факт кап. вложений, млн руб.', 'млн руб.'],
  ['Освоение, %', '%'],
  ['Кассовое исполнение, млн руб.', 'млн руб.'],
  ['Выполнено СМР, млн руб.', 'млн руб.'],
]

const KEYS_YEAR: [string, string][] = [
  ['Ввод мощности (план), кв.м', 'кв.м'],
  ['Ввод мощности (факт), кв.м', 'кв.м'],
  ['Лимит бюджета на год, млн руб.', 'млн руб.'],
]

const KEYS_MONTH: [string, string][] = [
  ['Платежи за месяц, млн руб.', 'млн руб.'],
]

const STATUSES = ['проектирование', 'стройка', 'проверка смет', 'подготовка к вводу', 'экспертиза']
const CATEGORIES = ['наука и образование', 'культура', 'здравоохранение', 'спорт', 'транспорт', 'ЖКХ']

/** Детерминированный PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function quarter(d = new Date()): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
}
function prevQuarters(n: number): string[] {
  const out: string[] = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    out.unshift(quarter(d))
    d.setMonth(d.getMonth() - 3)
  }
  return out
}

async function seed(): Promise<void> {
  const objects = await prisma.object.findMany({ where: { isActive: true }, select: { id: true, name: true } })
  if (objects.length === 0) {
    console.error('В БД нет объектов — сначала выполните импорт: npm run import:objects --file=export.xlsx')
    process.exit(1)
  }

  const quarters = prevQuarters(4)
  const collectedAt = new Date()
  let totalRows = 0

  for (const [i, obj] of objects.entries()) {
    const r = rng(obj.id * 2654435761)

    const mgeRows: UpsertMetricRow[] = []
    const dashRows: UpsertMetricRow[] = []
    const mgzRows: UpsertMetricRow[] = []
    const suidRows: UpsertMetricRow[] = []

    for (const [key, unit] of KEYS_CURRENT) {
      let value: string
      let num: number | null = null
      switch (key) {
        case 'Статус проекта': value = STATUSES[Math.floor(r() * STATUSES.length)]!; break
        case 'Категория объекта': value = CATEGORIES[Math.floor(r() * CATEGORIES.length)]!; break
        case 'Адрес': value = `г. Москва, ${['ЮЗАО', 'САО', 'ВАО', 'ЗАО', 'ЦАО', 'ТАО'][Math.floor(r() * 6)]}, ул. Демо-${(obj.id % 90) + 1}`; break
        case 'Застройщик': value = ['ГКУ «РМР»', 'АО «Мосинжпроект»', 'ГБУ «Автомобильные дороги»'][Math.floor(r() * 3)]!; break
        case 'Готовность проекта, %': num = Math.round(r() * 1000) / 10; value = num.toFixed(1); break
        case 'Готовность ПД, %': num = Math.round(r() * 1000) / 10; value = num.toFixed(1); break
        case 'Готовность СМР, %': num = Math.round(r() * 1000) / 10; value = num.toFixed(1); break
        case 'Кол-во этажей': num = 1 + Math.floor(r() * 24); value = String(num); break
        case 'Площадь объекта, кв.м': num = 2000 + Math.floor(r() * 58000); value = String(num); break
        case 'Строительный объём, куб.м': num = 10000 + Math.floor(r() * 290000); value = String(num); break
        case 'Бюджет (кап. вложения), млн руб.': num = 150 + Math.floor(r() * 9850); value = String(num); break
        case 'Освоено на текущую дату, млн руб.': num = 10 + Math.floor(r() * 4200); value = String(num); break
        case 'Замечания открытые, шт': num = Math.floor(r() * 25); value = String(num); break
        case 'Замечания закрытые, шт': num = Math.floor(r() * 140); value = String(num); break
        case 'Стадия': value = ['1.1', '1.2', '2.1', '2.2', '3.1'][Math.floor(r() * 5)]!; break
        default: value = `демо-${Math.floor(r() * 100000)}`; break
      }
      const row: UpsertMetricRow = { metricKey: key, metricValue: value, metricValueNum: num, unit: unit || null, period: '', rawPayload: { demo: true } }
      mgeRows.push(row)
      // Дашборд дублирует часть ключей с другими значениями (демо приоритетов)
      if (['Готовность проекта, %', 'Статус проекта', 'Бюджет (кап. вложения), млн руб.'].includes(key)) {
        dashRows.push({
          ...row,
          metricValueNum: row.metricValueNum !== null ? Math.min(100, row.metricValueNum + 7) : null,
          metricValue: row.metricValueNum !== null ? String(Math.min(100, row.metricValueNum + 7)) : `${row.metricValue} (дашборд)`,
        })
      }
    }

    for (const q of quarters) {
      for (const [key, unit] of KEYS_QUARTER) {
        const num = Math.round(r() * 2500)
        mgeRows.push({ metricKey: key, metricValue: String(num), metricValueNum: num, unit, period: q, rawPayload: { demo: true } })
        if (r() > 0.5) {
          mgzRows.push({ metricKey: `МГЗ: ${key}`, metricValue: String(Math.round(num * 0.9)), metricValueNum: Math.round(num * 0.9), unit, period: q, rawPayload: { demo: true } })
        }
        if (r() > 0.5) {
          suidRows.push({ metricKey: `СУИД: ${key}`, metricValue: String(Math.round(num * 1.1)), metricValueNum: Math.round(num * 1.1), unit, period: q, rawPayload: { demo: true } })
        }
      }
    }
    const year = String(new Date().getFullYear())
    for (const [key, unit] of KEYS_YEAR) {
      const num = Math.round(r() * 9000)
      mgeRows.push({ metricKey: key, metricValue: String(num), metricValueNum: num, unit, period: year, rawPayload: { demo: true } })
    }
    for (const [key, unit] of KEYS_MONTH) {
      const num = Math.round(r() * 400)
      dashRows.push({ metricKey: key, metricValue: String(num), metricValueNum: num, unit, period: `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, rawPayload: { demo: true } })
    }

    totalRows += await upsertMetricBatch('mge', obj.id, collectedAt, mgeRows)
    totalRows += await upsertMetricBatch('dashboard', obj.id, collectedAt, dashRows)
    totalRows += await upsertMetricBatch('mgz', obj.id, collectedAt, mgzRows)
    totalRows += await upsertMetricBatch('suid', obj.id, collectedAt, suidRows)
    // gsheets/yandex: по паре ключей на каждый третий объект
    if (obj.id % 3 === 0) {
      totalRows += await upsertMetricBatch('gsheets', obj.id, collectedAt, [
        { metricKey: 'GSheets: Комментарий', metricValue: `демо-комментарий ${i}`, metricValueNum: null, unit: null, period: '', rawPayload: { demo: true } },
      ])
    }
    if (obj.id % 5 === 0) {
      totalRows += await upsertMetricBatch('yandex', obj.id, collectedAt, [
        { metricKey: 'Yandex: Риск', metricValue: r() > 0.5 ? 'средний' : 'низкий', metricValueNum: null, unit: null, period: '', rawPayload: { demo: true } },
      ])
    }
  }

  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW "v_metrics_unified"`
  console.log(`seed:demo — записано строк метрик: ${totalRows} (объектов: ${objects.length})`)
  console.log('SPA: источник «Единые данные (view)» — победители по приоритетам; «МГЭ»/«Дашборд» — сырые значения.')
}

async function clear(): Promise<void> {
  const tables = ['mge', 'mgz', 'suid', 'dashboard', 'gsheets', 'yandex']
  for (const t of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "metrics_${t}"`)
  }
  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW "v_metrics_unified"`
  console.log('seed:demo:clear — все метрики удалены, view обновлён')
}

const mode = process.argv[2] === 'clear' ? 'clear' : 'seed'
;(mode === 'clear' ? clear() : seed())
  .catch((err) => {
    console.error('seed:demo failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
