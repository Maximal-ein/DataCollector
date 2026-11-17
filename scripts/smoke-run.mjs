// Запуск смоук-теста схемы без psql — напрямую через node-postgres.
// Использование: npm run db:smoke:local  (нужен DATABASE_URL)
//
// Разбивает SQL-файл на отдельные инструкции (каждая — в autocommit),
// потому что REFRESH MATERIALIZED VIEW CONCURRENTLY нельзя выполнять
// внутри транзакции, а pg.Client.query() с несколькими инструкциями
// в одном вызове выполняет их в одной неявной транзакции.
// Разделитель учитывает dollar-quoting ($$...$$) в DO-блоках.

import { readFile } from 'node:fs/promises'
import { Client } from 'pg'

if (!process.env.DATABASE_URL) {
  console.error('Не задан DATABASE_URL')
  process.exit(1)
}

function splitStatements(sql) {
  const statements = []
  let buf = ''
  let inDollar = false
  let inLineComment = false
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (inLineComment) {
      buf += ch
      if (ch === '\n') inLineComment = false
      i += 1
      continue
    }
    if (!inDollar && ch === '-' && next === '-') {
      inLineComment = true
      buf += '--'
      i += 2
      continue
    }
    if (ch === '$' && next === '$') {
      inDollar = !inDollar
      buf += '$$'
      i += 2
      continue
    }
    if (!inDollar && ch === ';') {
      statements.push(buf)
      buf = ''
      i += 1
      continue
    }
    buf += ch
    i += 1
  }
  statements.push(buf)
  return statements
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter((s) => s.length > 0)
}

const sqlPath = new URL('../db/scripts/smoke-test.sql', import.meta.url)
const sql = await readFile(sqlPath, 'utf8')

const client = new Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  const statements = splitStatements(sql)
  for (const statement of statements) {
    await client.query(statement)
  }
  console.log(`SMOKE TEST OK (${statements.length} инструкций)`)
} catch (err) {
  console.error('SMOKE TEST FAILED:', err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
