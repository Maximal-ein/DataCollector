import ExcelJS from 'exceljs'
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile('/tmp/spravka-2.xlsx')
const ws = wb.worksheets[0]
console.log('лист:', ws.name, '· строк:', ws.rowCount)
for (let r = 1; r <= Math.min(ws.rowCount, 22); r++) {
  const vals = []
  for (let c = 1; c <= 5; c++) {
    const v = ws.getRow(r).getCell(c).value
    if (v !== null && v !== undefined) vals.push(String(v).slice(0, 34))
  }
  if (vals.length) console.log(`  r${r}: ${vals.join(' | ')}`)
}
let leftCount = 0
for (let r = 1; r <= ws.rowCount; r++) {
  for (let c = 1; c <= ws.columnCount; c++) {
    const t = String(ws.getRow(r).getCell(c).value ?? '')
    if (t.includes('{{')) leftCount++
  }
}
console.log('незаполненных плейсхолдеров:', leftCount)
