/**
 * Раздача собранного SPA (frontend/dist) + проксирование /api и /health на API.
 * Для локального просмотра БЕЗ docker:  npm run build -w frontend && npm run serve:spa
 *   API_PORT=3000 (по умолчанию), порт статики 4173.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const PORT = Number(process.env.SPA_PORT ?? 4173)
const API_PORT = Number(process.env.API_PORT ?? 3000)
const DIST = path.resolve('frontend/dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    const proxy = http.request(
      { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    proxy.on('error', () => {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `API (порт ${API_PORT}) недоступен` }))
    })
    req.pipe(proxy)
    return
  }

  let file = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname)
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html') // SPA-роутинг
  if (!existsSync(file)) {
    res.writeHead(404).end('dist не собран: npm run build -w frontend')
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SPA: http://127.0.0.1:${PORT} → dist + API:${API_PORT}`)
})
