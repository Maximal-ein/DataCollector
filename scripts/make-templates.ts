/**
 * Генератор ТЕСТОВЫХ шаблонов справок (заменяются заказчиком на реальные формы).
 *
 *   npm run make:templates
 *
 * Создаёт в templates/:
 *   spravka.xlsx — ExcelJS-шаблон с блоком метрик {{#metrics}}…{{/metrics}}
 *   spravka.docx — docx-шаблон (docx-templates, разделители {{ }})
 *   spravka.html — HTML+CSS для PDF (handlebars)
 *   README.md    — документация языка шаблонов
 *
 * Скрипт можно запускать повторно — файлы перезаписываются.
 * Сгенерированные файлы — ИСХОДНИКИ шаблонов: редактируйте их в Excel/Word
 * (или замените своими), сохраните в templates/ с тем же id.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, BorderStyle } from 'docx'

const DIR = path.resolve('templates')
await mkdir(DIR, { recursive: true })

// ─────────────────────────────────────────────────────────── xlsx ──
{
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Справка', {
    views: [{ state: 'frozen', ySplit: 9 }],
  })

  ws.mergeCells('A1:E1')
  const title = ws.getCell('A1')
  title.value = 'СПРАВКА О ПОКАЗАТЕЛЯХ ОБЪЕКТА'
  title.font = { bold: true, size: 14 }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 28

  const info: [string, string][] = [
    ['Наименование объекта:', '{{object.name}}'],
    ['Код ДС:', '{{object.code_ds}}'],
    ['УИН:', '{{object.uin}}'],
    ['Идентификатор СУИД:', '{{object.suid_id}}'],
    ['Период:', '{{period}}'],
    ['Метрик всего:', '{{metrics_count}}'],
  ]
  info.forEach(([label, value], i) => {
    const r = 3 + i
    ws.getCell(r, 1).value = label
    ws.getCell(r, 1).font = { bold: true }
    ws.mergeCells(r, 2, r, 5)
    ws.getCell(r, 2).value = value
  })

  // шапка таблицы метрик
  const headerRow = 10
  const headers = ['Показатель', 'Значение', 'Ед. изм.', 'Период', 'Источник']
  headers.forEach((h, c) => {
    const cell = ws.getCell(headerRow, c + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B5797' } }
    cell.alignment = { horizontal: 'center' }
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
    }
  })

  // блок метрик: маркер-строка, строка-шаблон, маркер-строка
  ws.getCell(headerRow + 1, 1).value = '{{#metrics}}'
  const tplRow = headerRow + 2
  const tplValues = ['{{metric.key}}', '{{metric.value}}', '{{metric.unit}}', '{{metric.period}}', '{{metric.source}}']
  tplValues.forEach((v, c) => {
    const cell = ws.getCell(tplRow, c + 1)
    cell.value = v
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
    }
  })
  ws.getCell(headerRow + 3, 1).value = '{{/metrics}}'

  ws.getCell(tplRow + 2, 1).value = 'Сформировано: {{generated_at}}  ·  DataCollector'
  ws.getCell(tplRow + 2, 1).font = { italic: true, color: { argb: 'FF808080' }, size: 9 }

  ws.getColumn(1).width = 52
  ws.getColumn(2).width = 30
  ws.getColumn(3).width = 12
  ws.getColumn(4).width = 12
  ws.getColumn(5).width = 12

  await writeFile(path.join(DIR, 'spravka.xlsx'), Buffer.from(await wb.xlsx.writeBuffer()))
  console.log('✓ templates/spravka.xlsx')
}

// ─────────────────────────────────────────────────────────── docx ──
{
  const P = (text: string, opts?: { bold?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }) =>
    new Paragraph({
      alignment: opts?.align,
      children: [new TextRun({ text, bold: opts?.bold, size: opts?.size })],
    })

  const infoCell = (text: string, bold = false) =>
    new TableCell({
      width: { size: 25, type: WidthType.PERCENTAGE },
      children: [P(text, { bold })],
    })

  const border = { style: BorderStyle.SINGLE, size: 1, color: '999999' }
  const metricsHeader = new TableRow({
    tableHeader: true,
    children: ['Показатель', 'Значение', 'Ед. изм.', 'Период', 'Источник'].map(
      (t) =>
        new TableCell({
          shading: { fill: '2B5797' },
          children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: 'FFFFFF' })] })],
          borders: { top: border, bottom: border, left: border, right: border },
        }),
    ),
  })
  // строки-команды docx-templates: FOR / тело цикла / END-FOR — паттерн из документации
  const forRow = new TableRow({
    children: [
      new TableCell({ children: [P('{{FOR m IN metrics}}')] }),
      new TableCell({ children: [P('')] }),
      new TableCell({ children: [P('')] }),
      new TableCell({ children: [P('')] }),
      new TableCell({ children: [P('')] }),
    ],
  })
  const bodyRow = new TableRow({
    children: ['{{$m.key}}', '{{$m.value}}', '{{$m.unit}}', '{{$m.period}}', '{{$m.source}}'].map(
      (t) =>
        new TableCell({
          children: [P(t)],
          borders: { top: border, bottom: border, left: border, right: border },
        }),
    ),
  })
  const endForRow = new TableRow({
    children: [
      new TableCell({ children: [P('{{END-FOR m}}')] }),
      new TableCell({ children: [P('')] }),
      new TableCell({ children: [P('')] }),
      new TableCell({ children: [P('')] }),
      new TableCell({ children: [P('')] }),
    ],
  })

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [
      {
        properties: {},
        children: [
          P('СПРАВКА О ПОКАЗАТЕЛЯХ ОБЪЕКТА', { bold: true, size: 30, align: AlignmentType.CENTER }),
          P(''),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [infoCell('Наименование объекта:', true), infoCell('{{object.name}}')] }),
              new TableRow({ children: [infoCell('Код ДС:', true), infoCell('{{object.code_ds}}')] }),
              new TableRow({ children: [infoCell('УИН:', true), infoCell('{{object.uin}}')] }),
              new TableRow({ children: [infoCell('Идентификатор СУИД:', true), infoCell('{{object.suid_id}}')] }),
              new TableRow({ children: [infoCell('Период:', true), infoCell('{{period}}')] }),
              new TableRow({ children: [infoCell('Метрик всего:', true), infoCell('{{metrics_count}}')] }),
            ],
          }),
          P(''),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [metricsHeader, forRow, bodyRow, endForRow],
          }),
          P(''),
          P('Сформировано: {{generated_at}}  ·  DataCollector', { size: 18 }),
        ],
      },
    ],
  })

  await writeFile(path.join(DIR, 'spravka.docx'), await Packer.toBuffer(doc))
  console.log('✓ templates/spravka.docx')
}

// ─────────────────────────────────────────────────────────── html ──
{
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Справка о показателях объекта</title>
<style>
  @page { size: A4; margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "PT Serif", "Times New Roman", serif; color: #1a1a1a; font-size: 11pt; margin: 0; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 4mm; text-transform: uppercase; letter-spacing: .4px; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  .meta td { padding: 2mm 3mm; border: 1px solid #c9c9c9; }
  .meta td:first-child { width: 38%; font-weight: 700; background: #f4f6f9; }
  table.metrics { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.metrics th { background: #2b5797; color: #fff; padding: 2mm 2.5mm; text-align: left; border: 1px solid #2b5797; }
  table.metrics td { padding: 1.6mm 2.5mm; border: 1px solid #c9c9c9; }
  table.metrics tr:nth-child(even) td { background: #f7f9fc; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  footer { margin-top: 6mm; font-size: 8.5pt; color: #777; font-style: italic; }
</style>
</head>
<body>
  <h1>Справка о показателях объекта</h1>
  <table class="meta">
    <tr><td>Наименование объекта</td><td>{{object.name}}</td></tr>
    <tr><td>Код ДС</td><td>{{object.code_ds}}</td></tr>
    <tr><td>УИН</td><td>{{object.uin}}</td></tr>
    <tr><td>Идентификатор СУИД</td><td>{{object.suid_id}}</td></tr>
    <tr><td>Период</td><td>{{period_label}}</td></tr>
    <tr><td>Метрик всего</td><td>{{metrics_count}}</td></tr>
  </table>
  <table class="metrics">
    <thead>
      <tr><th>Показатель</th><th>Значение</th><th>Ед. изм.</th><th>Период</th><th>Источник</th></tr>
    </thead>
    <tbody>
      {{#each metrics}}
      <tr>
        <td>{{this.key}}</td>
        <td class="num">{{this.value}}</td>
        <td>{{this.unit}}</td>
        <td>{{#if this.period}}{{this.period}}{{else}}текущее{{/if}}</td>
        <td>{{this.source}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  <footer>Сформировано: {{generated_at}} · DataCollector</footer>
</body>
</html>
`
  await writeFile(path.join(DIR, 'spravka.html'), html, 'utf8')
  console.log('✓ templates/spravka.html')
}

// ─────────────────────────────────────────────────────── README ──
{
  const md = `# Шаблоны справок

Каталог шаблонов модуля экспорта (\`GET /api/reports/:template?object_id=&format=\`).
Шаблон = файл \`<id>.<ext>\`; **id** — имя файла, **format** — расширение:
\`.xlsx\` (ExcelJS), \`.docx\` (docx-templates), \`.html\` (handlebars → Chromium PDF).

Тестовые примеры: \`spravka.*\` — замените их на реальные формы (id сохраните
или добавьте новые; реестр строится автоматически по файлам каталога).

## Общие данные (все форматы)

| Токен | Значение |
|---|---|
| \`{{object.name}}\` | наименование объекта |
| \`{{object.code_ds}}\` / \`{{object.uin}}\` / \`{{object.suid_id}}\` | идентификаторы из выгрузки СУИД |
| \`{{object.address}}\` | адрес (если есть) |
| \`{{generated_at}}\` | дата генерации (ДД.ММ.ГГГГ ЧЧ:ММ) |
| \`{{period}}\` | выбранный период (\`&period=\` в URL; пусто = все) |
| \`{{metrics_count}}\` | количество метрик |

Метрики берутся из \`v_metrics_unified\` (победители по приоритетам источников).

## Повторяющийся блок метрик

**xlsx** — маркеры в ячейках строк (см. spravka.xlsx, строки 11–13):

\`\`\`
A: {{#metrics}}
A: {{metric.key}}  B: {{metric.value}}  C: {{metric.unit}}  D: {{metric.period}}  E: {{metric.source}}
A: {{/metrics}}
\`\`\`
Строки между маркерами (или сама строка, если оба маркера в ней) дублируются
на каждую метрику; стили строки-шаблона сохраняются.

**docx** (docx-templates, разделители \`{{ }}\`, выражения JavaScript):

\`\`\`
{{FOR m IN metrics}}          ← отдельная строка таблицы
  {{$m.key}}  {{$m.value}}  {{$m.unit}}  {{$m.period}}  {{$m.source}}
{{END-FOR m}}                 ← отдельная строка таблицы
\`\`\`

**html** (handlebars):

\`\`\`
{{#each metrics}} {{this.key}} {{this.value}} … {{/each}}
\`\`\`

## Формат вызова

\`\`\`bash
curl -OJ "http://localhost:3000/api/reports/spravka?object_id=1&format=xlsx"
curl -OJ "http://localhost:3000/api/reports/spravka?object_id=1&format=pdf&period=2026-Q4"
\`\`\`

Ошибки: \`404\` шаблон/объект не найден, \`422\` метрики пусты (сначала сбор),
\`500\` ошибка рендера.
`
  await writeFile(path.join(DIR, 'README.md'), md, 'utf8')
  console.log('✓ templates/README.md')
}

console.log('\nГотово. Шаблоны можно править в Excel/Word — это обычные файлы.')
