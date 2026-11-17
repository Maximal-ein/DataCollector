/**
 * Читатели табличных источников: Google Sheets (service account) и
 * Яндекс Таблицы 360 (OAuth-токен организации).
 *
 * Общий контракт: readTable() → { header: string[], rows: string[][] } —
 * дальше один и тот же пайплайн: normalizer → сопоставление объектов → upsert.
 */
import { readFile } from 'node:fs/promises'
import { GoogleAuth } from 'google-auth-library'

export interface RawTable {
  header: string[]
  rows: string[][]
  meta: { source: 'gsheets' | 'yandex'; spreadsheet?: string; sheet?: string; range?: string }
}

// ─────────────────────────────────────────────── Google Sheets ──

/** Простой CSV-парсер (кавычки, запятая в кавычках, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * Google Sheets, ДВА способа чтения:
 *   1. Service account (GOOGLE_SERVICE_ACCOUNT_FILE + доступ аккаунту к таблице)
 *      — основной, через Sheets API v4;
 *   2. Если ключа нет — публичный CSV-экспорт таблицы (доступ «все, у кого
 *      есть ссылка»): подходит для тестов и простых сценариев.
 * Таблица: первая строка — заголовок, дальше — данные.
 * Инструкция по credentials — в README («Google Sheets / Яндекс Таблицы»).
 */
export async function readGsheets(): Promise<RawTable> {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? './secrets/google-service-account.json'
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID
  const sheetName = process.env.GOOGLE_SHEET_NAME ?? ''

  if (!spreadsheetId) throw new Error('GOOGLE_SPREADSHEET_ID не задан (id таблицы из URL)')

  // ── путь 1: сервисный аккаунт + Sheets API v4 ──
  let key: string | null = null
  try {
    key = await readFile(keyFile, 'utf8')
  } catch {
    key = null // файла нет — попробуем публичный CSV ниже
  }

  if (key) {
    const auth = new GoogleAuth({
      credentials: JSON.parse(key),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    const client = await auth.getClient()
    const accessToken = await client.getAccessToken()

    const range = sheetName ? `${encodeURIComponent(sheetName)}!A1:ZZ` : 'A1:ZZ'
    const apiBase = process.env.GOOGLE_API_BASE_URL ?? 'https://sheets.googleapis.com'
    const url = `${apiBase}/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS`
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken.token}` } })
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 500)
      throw new Error(`Google Sheets API ${resp.status}: ${text}. Проверьте GOOGLE_SPREADSHEET_ID и доступ сервисного аккаунта к таблице`)
    }
    const json = (await resp.json()) as { values?: string[][] }
    const values = json.values ?? []
    if (values.length === 0) throw new Error('Таблица пуста (первая строка — заголовок, дальше — данные)')
    const [header = [], ...rows] = values
    return {
      header: header.map((h) => String(h ?? '')),
      rows: rows.map((r) => header.map((_h, i) => String(r[i] ?? ''))),
      meta: { source: 'gsheets', spreadsheet: spreadsheetId, sheet: sheetName || undefined, range },
    }
  }

  // ── путь 2: публичный CSV-экспорт (без сервисного аккаунта) ──
  const csvTemplate =
    process.env.GOOGLE_CSV_URL_TEMPLATE ?? 'https://docs.google.com/spreadsheets/d/{id}/export?format=csv'
  const csvUrl = csvTemplate.replace('{id}', encodeURIComponent(spreadsheetId))
  const resp = await fetch(csvUrl, { redirect: 'follow' })
  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 300)
    throw new Error(
      `Не удалось прочитать Google Sheets (${resp.status}: ${text}). ` +
        'Либо настройте сервисный аккаунт (GOOGLE_SERVICE_ACCOUNT_FILE, инструкция в README), ' +
        'либо откройте таблицу для чтения по ссылке (CSV-экспорт)',
    )
  }
  const csv = await resp.text()
  const matrix = parseCsv(csv)
  if (matrix.length === 0) throw new Error('CSV таблицы пуст')
  const [header = [], ...rows] = matrix
  return {
    header,
    rows: rows.map((r) => header.map((_h, i) => r[i] ?? '')),
    meta: { source: 'gsheets', spreadsheet: spreadsheetId, sheet: sheetName || undefined, range: 'csv-export' },
  }
}

// ──────────────────────────────────────────── Яндекс Таблицы 360 ──

/**
 * Яндекс Таблицы 360 (Yandex 360 для бизнеса).
 *
 * ЧЕСТНАЯ ОГОВОРКА: публичной документированной версии REST API Таблиц 360
 * на момент реализации нет — эндпоинт и структура ответа настраиваются через
 * env (YANDEX_TABLES_URL_TEMPLATE / YANDEX_TABLES_* ). Шаблон по умолчанию
 * соответствует веб-интерфейсу Таблиц (books/{bookId}/views/{viewId}).
 * Если у организации появится официальный API — меняется ТОЛЬКО эта функция.
 *
 * Шаблон URL: подставляются {book_id} и {view_id}; ответ ожидается
 * { rows: [[…], …] } либо { records: [{…}] } либо массив массивов.
 * Авторизация: OAuth-токен Яндекса (заголовок Authorization: OAuth <token>).
 */
export async function readYandexTables(): Promise<RawTable> {
  const token = process.env.YANDEX_OAUTH_TOKEN
  const bookId = process.env.YANDEX_TABLES_BOOK_ID
  const viewId = process.env.YANDEX_TABLES_VIEW_ID ?? ''
  const template =
    process.env.YANDEX_TABLES_URL_TEMPLATE ??
    'https://tables360.yandex.ru/api/books/{book_id}/views/{view_id}/rows'

  if (!token || !bookId) {
    throw new Error('Yandex: задайте YANDEX_OAUTH_TOKEN и YANDEX_TABLES_BOOK_ID (см. README — раздел «Яндекс Таблицы 360»)')
  }
  const url = template.replace('{book_id}', encodeURIComponent(bookId)).replace('{view_id}', encodeURIComponent(viewId))

  const resp = await fetch(url, { headers: { Authorization: `OAuth ${token}`, Accept: 'application/json' } })
  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 500)
    throw new Error(
      `Yandex Tables 360 → ${resp.status}: ${text}. ` +
        'Если формат API отличается, переопределите YANDEX_TABLES_URL_TEMPLATE и пришлите пример ответа — адаптируем readYandexTables',
    )
  }
  const json: unknown = await resp.json()

  let matrix: string[][] = []
  if (Array.isArray(json)) {
    matrix = (json as unknown[][]).map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')) : [String(row ?? '')]))
  } else if (typeof json === 'object' && json !== null) {
    const obj = json as Record<string, unknown>
    const rowsRaw = (obj['rows'] ?? obj['records'] ?? obj['data']) as unknown
    if (Array.isArray(rowsRaw)) {
      if (rowsRaw.every((r) => Array.isArray(r))) {
        matrix = (rowsRaw as unknown[][]).map((row) => row.map((c) => String(c ?? '')))
      } else {
        // массив объектов: колонки — объединение ключей
        const records = rowsRaw as Record<string, unknown>[]
        const header = [...new Set(records.flatMap((r) => Object.keys(r)))]
        matrix = [header, ...records.map((r) => header.map((h) => String(r[h] ?? '')))]
      }
    }
  }
  if (matrix.length === 0) throw new Error('Yandex Tables 360: не удалось разобрать ответ (ожидались rows/records/data)')

  const [header = [], ...rows] = matrix
  return {
    header,
    rows: rows.map((r) => header.map((_h, i) => String(r[i] ?? ''))),
    meta: { source: 'yandex', spreadsheet: bookId, sheet: viewId || undefined },
  }
}
