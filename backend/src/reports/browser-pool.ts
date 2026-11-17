/**
 * Общий singleton-Chromium для API-процесса (PDF-справки, диагностика МГЭ).
 * Доступ сериализован (одна страница за раз) — для LAN-нагрузки достаточно.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

let browser: Browser | null = null
let chain: Promise<unknown> = Promise.resolve() // мьютекс

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
      args: ['--no-sandbox'],
    })
  }
  return browser
}

/** Выполнить fn в новом контексте; вызовы выстраиваются в цепочку. */
export function withSharedBrowser<T>(fn: (context: BrowserContext) => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const b = await getBrowser()
    const context = await b.newContext({ viewport: { width: 1366, height: 900 } })
    try {
      return await fn(context)
    } finally {
      await context.close().catch(() => undefined)
    }
  })
  // не блокируем цепочку ошибкой конкретного вызова
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run as Promise<T>
}

/** Закрыть браузер (вызывается при shutdown API). */
export async function closeSharedBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => undefined)
    browser = null
  }
}

/** Снимок страницы (JPEG base64) — для диагностики. */
export async function screenshotB64(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false })
  return buf.toString('base64')
}
