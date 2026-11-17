/**
 * Интерактивный логин МГЭ (headful): открывает браузер, ждёт ручного входа,
 * сохраняет storageState (AES-256-GCM) в sessions.
 *
 *   npm run login:mge
 *   PLAYWRIGHT_HEADLESS=false — по умолчанию для этого скрипта (нужно окно).
 *
 * Скрипт ждёт до 5 минут; критерий успеха — после входа URL не похож на форму
 * входа (паттерн см. core/sites.ts → MGE_SITE.loginUrlPattern).
 */
import { chromium } from 'playwright'
import { MGE_SITE } from '@dc/core/src/sites.js'
import { loadSessionState, saveSessionState } from '@dc/core/src/session-store.js'

async function main(): Promise<void> {
  const existing = await loadSessionState('mge')
  console.log(`МГЭ: ${MGE_SITE.baseUrl}`)
  if (existing) console.log('Внимание: сохранённая сессия будет ПЕРЕЗАПИСАНА.')

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const page = await context.newPage()
  await page.goto(MGE_SITE.loginUrl, { waitUntil: 'domcontentloaded' })

  console.log('\n→ Войдите в открывшемся окне браузера (вводите логин/пароль вручную).')
  console.log('  Скрипт сам закроется после успешного входа (до 5 минут).')

  const deadline = Date.now() + 5 * 60 * 1000
  let loggedIn = false
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000)
    const url = page.url()
    const looksLogin = MGE_SITE.loginUrlPattern.test(url)
    if (!looksLogin && url.startsWith(new URL(MGE_SITE.baseUrl).origin)) {
      loggedIn = true
      break
    }
  }

  if (!loggedIn) {
    console.error('Не дождались входа (5 минут). Сессия НЕ сохранена. Попробуйте ещё раз.')
    await browser.close()
    process.exit(1)
  }

  const state = await context.storageState()
  await saveSessionState('mge', state)
  console.log('\n✓ Сессия МГЭ сохранена (зашифрована AES-256-GCM, таблица sessions, source_id=mge).')
  console.log('  Проверка: POST /api/diagnostics/mge')
  await browser.close()
}

main().catch((err) => {
  console.error('login:mge failed:', err)
  process.exit(1)
})
