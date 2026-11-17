/**
 * Интерактивный логин СУДИР (headful): ОДНА сессия на МГЗ/СУИД/Дашборд.
 *
 *   npm run login:sudir
 *
 * Открывает SUDIR_LOGIN_START_URL (по умолчанию mgz.mos.ru); войдите через
 * СУДИР вручную. После возврата на сайт (не на страницу входа) storageState
 * сохраняется (AES-256-GCM, sessions, source_id=sudir) и переиспользуется
 * всеми тремя сайтами (шаг 5).
 */
import { chromium } from 'playwright'
import { SUDIR_LOGIN_START_URL } from '@dc/core/src/sites.js'
import { saveSessionState } from '@dc/core/src/session-store.js'

async function main(): Promise<void> {
  console.log(`СУДИР: старт с ${SUDIR_LOGIN_START_URL}`)
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const page = await context.newPage()
  await page.goto(SUDIR_LOGIN_START_URL, { waitUntil: 'domcontentloaded' })

  console.log('\n→ Войдите через СУДИР в открывшемся окне (логин/пароль, при необходимости СМС).')
  console.log('  После возврата на сайт сессия сохранится автоматически (до 5 минут).')

  const deadline = Date.now() + 5 * 60 * 1000
  let loggedIn = false
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000)
    const url = page.url()
    // не страница входа и не домен SSO
    if (!/passport|sso|auth|login/i.test(url)) {
      loggedIn = true
      break
    }
  }

  if (!loggedIn) {
    console.error('Не дождались входа (5 минут). Сессия НЕ сохранена.')
    await browser.close()
    process.exit(1)
  }

  const state = await context.storageState()
  await saveSessionState('sudir', state)
  console.log('\n✓ Сессия СУДИР сохранена (общая для МГЗ/СУИД/Дашборда; source_id=sudir).')
  await browser.close()
}

main().catch((err) => {
  console.error('login:sudir failed:', err)
  process.exit(1)
})
