import { writeFileSync } from 'node:fs'
import { Client } from 'pg'
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const r = await c.query('SELECT name, code_ds FROM objects ORDER BY id LIMIT 5')
const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"'
const lines = ['Наименование объекта,Код ДС,Готовность проекта %,Бюджет млн руб.,Комментарий']
for (const [i, o] of r.rows.entries()) {
  lines.push([esc(o.name), esc(o.code_ds), 40 + i * 5, 500 + i * 100, esc('демо-комментарий ' + (i + 1))].join(','))
}
writeFileSync('/tmp/gsheet.csv', lines.join('\n'))
console.log(lines.length, 'строк CSV записано')
await c.end()
