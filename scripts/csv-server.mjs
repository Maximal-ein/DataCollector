// Тестовый CSV-сервер, имитирующий публичный экспорт Google Sheets.
// Используется только для e2e-проверки табличного конвейера в песочнице.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
http.createServer(async (req, res) => {
  if (req.url.startsWith('/test-sheet')) {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' })
    return res.end(await readFile('/tmp/gsheet.csv'))
  }
  res.writeHead(404).end()
}).listen(9466, '127.0.0.1', () => console.log('csv-server: http://127.0.0.1:9466/test-sheet'))
