/**
 * Mock-сервер МГЭ для e2e-тестов воркера и диагностики БЕЗ реального сайта.
 *
 *   node scripts/mock-mge.mjs [--file=export.xlsx] [--port=9465]
 *
 * Поведение имитирует SPA-портал:
 *   GET  /                     → 302 /login без cookie; с cookie — «SPA»
 *   GET  /login                → форма входа (input[name=login] и т.д.)
 *   POST /login                → ставит cookie mge_session, 302 /
 *   GET  /api/projects?search= → JSON {items:[{id,name}]} (только с cookie)
 *                                для первого объекта возвращает + «двойника»
 *                                (демонстрация AMBIGUOUS_MATCH → resolve:mge)
 *   GET  /objects/:id          → страница карточки (SPA, дергает /api/objects/:id)
 *   GET  /api/objects/:id      → JSON с показателями (только с cookie)
 *
 * Данные объектов — из выгрузки export.xlsx (колонки A/B/C/D).
 */
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import ExcelJS from 'exceljs'

const args = process.argv.slice(2)
const port = Number(args.find((a) => a.startsWith('--port='))?.slice(7) ?? 9465)
const file = args.find((a) => a.startsWith('--file='))?.slice(7) ?? 'export.xlsx'

function cellText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return typeof v.text === 'string' ? v.text : String(v.result ?? '')
  return String(v)
}

async function loadObjects() {
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    const ws = wb.worksheets[0]
    const out = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const name = cellText(ws.getRow(r).getCell(2).value).trim()
      if (!name) continue
      out.push({ id: `MGE-${String(r - 1).padStart(4, '0')}`, name })
    }
    return out
  } catch {
    console.warn(`[mock-mge] не прочитан ${file} — использую встроенный список`)
    return [
      { id: 'MGE-0001', name: '023-0781Блок начальных классов на 300 мест' },
      { id: 'MGE-0002', name: '023-0786 Здание образовательной организации' },
      { id: 'MGE-0003', name: '023-0789 Многофункциональный культурный центр' },
    ]
  }
}

const objects = await loadObjects()
// «двойник» первого объекта — чтобы поиск давал AMBIGUOUS_MATCH (для демо resolve:mge)
// имя почти идентично (сходство ~0.98 < 1.0): как «второй корпус» того же проекта
const FIRST = objects[0]
const TWIN = FIRST ? { id: 'MGE-9999', name: FIRST.name + '-2' } : null

const COOKIE = 'mge_session=mock-session-token'

const html = (body, extraHead = '') => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>МГЭ (mock)</title>${extraHead}</head>
<body style="font-family:system-ui,sans-serif;max-width:900px;margin:40px auto">
${body}
</body></html>`

const spaPage = html(`
  <h1>МГЭ — государственная экспертиза (mock)</h1>
  <p><input type="search" placeholder="Поиск объекта" style="width:420px;padding:8px" id="q">
     <button onclick="doSearch()">Найти</button></p>
  <div id="results">Введите название объекта…</div>
  <div id="card"></div>
  <script>
    async function boot() { // фоновый XHR при загрузке (ловится диагностикой)
      try { const r = await fetch('/api/projects?search='); const j = await r.json();
        document.getElementById('results').textContent = 'Всего объектов: ' + (j.items?.length ?? 0);
      } catch {}
    }
    async function doSearch() {
      const q = document.getElementById('q').value;
      const r = await fetch('/api/projects?search=' + encodeURIComponent(q));
      const j = await r.json();
      document.getElementById('results').innerHTML = (j.items||[]).map(i =>
        '<p><a href="/objects/' + encodeURIComponent(i.id) + '">' + i.name + ' [' + i.id + ']</a></p>').join('');
    }
    document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    boot();
  </script>`)

const cardPage = (id) => html(`
  <h1>Карточка объекта</h1>
  <div id="card">Загрузка…</div>
  <script>
    fetch('/api/objects/${id.replace(/'/g, '')}')
      .then(r => r.json())
      .then(j => {
        document.getElementById('card').innerHTML =
          '<h2>' + j.project.name + '</h2>' +
          '<table>' + Object.entries(j.indicators).map(([k, v]) =>
            '<tr><td>' + k + '</td><td>' + v + '</td></tr>').join('') + '</table>';
      });
  </script>`)

const loginPage = html(`
  <h1>Вход на портал МГЭ (mock)</h1>
  <form method="POST" action="/login">
    <p><input name="login" placeholder="Логин" style="width:260px;padding:8px"></p>
    <p><input name="password" type="password" placeholder="Пароль" style="width:260px;padding:8px"></p>
    <p><button type="submit">Войти</button></p>
  </form>`)

function projectJson(id) {
  const obj = objects.find((o) => o.id === id) ?? objects[0] ?? { id, name: 'Неизвестный объект' }
  return {
    project: { id: obj.id, name: obj.name, status: 'экспертиза пройдена', address: 'г. Москва,mock' },
    indicators: {
      readiness_pct: 45.2,
      readiness_pd: 60.1,
      readiness_smr: 12.5,
      budget_mln: 1250,
      funded_mln: 340.5,
      open_defects: 3,
      closed_defects: 12,
      floors: 5,
      area_sqm: 12800.4,
      ggz_conclusion: 'положительное',
    },
    period: '2026-Q4',
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  const hasCookie = (req.headers.cookie ?? '').includes('mge_session')

  if (url.pathname === '/login' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(loginPage)
  }
  if (url.pathname === '/login' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.writeHead(302, { 'set-cookie': `${COOKIE}; Path=/`, location: '/' })
      res.end()
    })
    return
  }
  if (!hasCookie) {
    res.writeHead(302, { location: '/login' })
    return res.end()
  }

  if (url.pathname === '/' || url.pathname === '') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(spaPage)
  }

  if (url.pathname === '/api/projects') {
    const q = (url.searchParams.get('search') ?? '').trim().toLowerCase()
    let items = q
      ? objects.filter((o) => o.name.toLowerCase().includes(q))
      : objects.slice(0, 10)
    // двойник для первого объекта: поиск по его имени вернёт двух кандидатов
    if (TWIN && q && FIRST && FIRST.name.toLowerCase().includes(q)) {
      items = [FIRST, TWIN]
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ items, total: items.length }))
  }

  const cardMatch = url.pathname.match(/^\/api\/objects\/(.+)$/)
  if (cardMatch) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify(projectJson(decodeURIComponent(cardMatch[1]))))
  }

  const pageMatch = url.pathname.match(/^\/objects\/(.+)$/)
  if (pageMatch) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(cardPage(decodeURIComponent(pageMatch[1])))
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-mge] готов: http://127.0.0.1:${port} (объектов: ${objects.length}${TWIN ? ', +1 двойник для AMBIGUOUS-демо' : ''})`)
  console.log(`[mock-mge] логин: любые логин/пароль на /login`)
})
