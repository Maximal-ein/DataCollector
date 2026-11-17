/**
 * Общие помощники Playwright (восстановлено из шага 4; логика не менялась).
 *
 *  - withBrowserSession: запуск Chromium + контекст с сохранённым storageState;
 *  - ensureLoggedIn: проверка состояния и (если заданы логин/пароль в env)
 *    автоматический вход с сохранением нового storageState.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { credentialsFor, type SiteConfig } from './sites.js'
import { loadSessionState, saveSessionState } from './session-store.js'

const TIMEOUT_MS = Number(process.env.PLAYWRIGHT_TIMEOUT_MS ?? 60000)

export class LoginRequiredError extends Error {
  constructor(site: SiteConfig) {
    super(
      `Сессия истекла для ${site.baseUrl}: после загрузки страница выглядит как форма входа. ` +
        `Обновлите сессию: npm run ${site.authCode === 'mge' ? 'login:mge' : 'login:sudir'}`,
    )
    this.name = 'LoginRequiredError'
  }
}

export async function launchBrowser(opts?: { headless?: boolean }): Promise<Browser> {
  return chromium.launch({
    headless: opts?.headless ?? process.env.PLAYWRIGHT_HEADLESS !== 'false',
    args: ['--no-sandbox'],
  })
}

/**
 * Выполнить fn в контексте с сохранённой сессией источника.
 * Сессии может не быть (storageState=null) — вызывающий код решает,
 * залогиниться ли (ensureLoggedIn) или упасть (LoginRequiredError).
 */
export async function withBrowserSession<T>(
  site: SiteConfig,
  fn: (context: BrowserContext) => Promise<T>,
  opts?: { headless?: boolean },
): Promise<T> {
  const browser = await launchBrowser(opts)
  try {
    const storageState = await loadSessionState(site.authCode)
    const context = await browser.newContext({
      storageState: storageState ?? undefined,
      viewport: { width: 1366, height: 900 },
    })
    context.setDefaultTimeout(TIMEOUT_MS)
    try {
      return await fn(context)
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

/** Открыть страницу и понять, залогинены ли (эвристика по URL). */
export async function openPage(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return page
}

/** Похоже ли текущее состояние страницы на форму входа. */
export function looksLikeLoginPage(page: Page, site: SiteConfig): boolean {
  const url = page.url()
  return site.loginUrlPattern.test(url)
}

/**
 * Убедиться, что мы залогинены; при необходимости войти по логину/паролю из env
 * и сохранить обновлённый storageState. Бросает LoginRequiredError, если войти
 * не удалось (нет credentials / форма не нашлась / после входа снова форма).
 */
export async function ensureLoggedIn(context: BrowserContext, site: SiteConfig): Promise<void> {
  const page = await openPage(context, site.loginUrl)
  try {
    if (!looksLikeLoginPage(page, site)) return // уже с сессией

    const creds = credentialsFor(site.authCode)
    if (!creds) throw new LoginRequiredError(site)

    const userSel = site.loginSelectors.user.split(',')[0]!.trim()
    const passSel = site.loginSelectors.password.split(',')[0]!.trim()
    const submitSel = site.loginSelectors.submit.split(',')[0]!.trim()

    await page.locator(userSel).first().fill(creds.login, { timeout: 10000 })
    await page.locator(passSel).first().fill(creds.password, { timeout: 10000 })
    await Promise.all([page.locator(submitSel).first().click(), page.waitForLoadState('domcontentloaded')])
    await page.waitForTimeout(2000)

    if (looksLikeLoginPage(page, site)) throw new LoginRequiredError(site)

    // вход успешен — сохраняем обновлённый storageState
    const state = await context.storageState()
    await saveSessionState(site.authCode, state)
  } finally {
    await page.close()
  }
}
