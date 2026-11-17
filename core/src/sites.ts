/**
 * Конфигурация сайтов-источников (восстановлено из шага 4, логика не менялась).
 *
 * ВАЖНО: все URL и селекторы переопределяются через env — это позволяет
 * запускать e2e-тесты на mock-сервере и подстраиваться под реальную структуру
 * сайтов после диагностических снимков (POST /api/diagnostics/mge).
 *
 * Селекторы поиска/логина — ПРЕДПОЛОЖЕНИЯ до диагностических логов заказчика;
 * правятся здесь одним местом (общий слой).
 */

export interface LoginSelectors {
  user: string
  password: string
  submit: string
}

export interface SiteConfig {
  /** Код источника метрик ('mge') либо код авторизации ('sudir') */
  authCode: 'mge' | 'sudir'
  baseUrl: string
  /** Страница логина (по умолчанию — baseUrl) */
  loginUrl: string
  loginSelectors: LoginSelectors
  /** URL главной страницы выглядит как форма входа (эвристика «не залогинен») */
  loginUrlPattern: RegExp
  /** Селекторы поиска объекта (перебираются по порядку) — для сбора и диагностики */
  searchSelectors: string[]
  /** Путь к карточке объекта по внешнему id (шаблон с :id) */
  objectPath?: (externalId: string) => string
}

const env = (name: string, fallback: string): string => process.env[name]?.trim() || fallback

/** Базовый URL МГЭ (переопределяется для тестов на mock-сервере). */
const MGE_BASE = env('MGE_BASE_URL', 'https://expertiza.mos.ru')

/** МГЭ — expertiza.mos.ru, своя авторизация (своя запись в sessions). */
export const MGE_SITE: SiteConfig = {
  authCode: 'mge',
  baseUrl: MGE_BASE,
  loginUrl: env('MGE_LOGIN_URL', MGE_BASE),
  loginSelectors: {
    user: env('MGE_LOGIN_USER_SELECTOR', 'input[name="login"], input[name="username"], input[type="email"]'),
    password: env('MGE_LOGIN_PASSWORD_SELECTOR', 'input[name="password"], input[type="password"]'),
    submit: env('MGE_LOGIN_SUBMIT_SELECTOR', 'button[type="submit"], input[type="submit"]'),
  },
  // эвристика: после загрузки главной нас не выкинуло на страницу входа
  loginUrlPattern: /login|auth|passort|sso|signin/i,
  searchSelectors: (process.env.MGE_SEARCH_SELECTORS?.trim() || 'input[type="search"], input[placeholder*="поиск" i], input[name="query"], input[name="search"]')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  objectPath: (id) => `/objects/${encodeURIComponent(id)}`,
}

/** Сайты, входящие через СУДИР (общая сессия, authCode='sudir'). */
export interface SudirSite {
  code: 'mgz' | 'suid' | 'dashboard'
  baseUrl: string
}

export const SUDIR_SITES: SudirSite[] = [
  { code: 'mgz', baseUrl: env('MGZ_BASE_URL', 'https://mgz.mos.ru') },
  { code: 'suid', baseUrl: env('SUID_BASE_URL', 'https://suid.mos.ru') },
  { code: 'dashboard', baseUrl: env('DASHBOARD_BASE_URL', 'https://dashboard-stroi.mos.ru') },
]

/** С какой страницы начинать интерактивный логин СУДИР (login:sudir). */
export const SUDIR_LOGIN_START_URL = env('SUDIR_LOGIN_START_URL', 'https://mgz.mos.ru')

export function siteForSource(source: string): SiteConfig | null {
  if (source === 'mge') return MGE_SITE
  const sudir = SUDIR_SITES.find((s) => s.code === source)
  if (!sudir) return null
  return {
    authCode: 'sudir',
    baseUrl: sudir.baseUrl,
    loginUrl: sudir.baseUrl,
    // СУДИР: единый вход — редирект на passport.mos.ru и подобные
    loginUrlPattern: /passport|sso|auth|login/i,
    loginSelectors: {
      user: env('SUDIR_LOGIN_USER_SELECTOR', 'input[name="login"], input[id="login"]'),
      password: env('SUDIR_LOGIN_PASSWORD_SELECTOR', 'input[name="password"], input[type="password"]'),
      submit: env('SUDIR_LOGIN_SUBMIT_SELECTOR', 'button[type="submit"], input[type="submit"]'),
    },
    searchSelectors: [],
  }
}

/** Учётные данные для автоматического продления сессии (если заданы в env). */
export function credentialsFor(authCode: 'mge' | 'sudir'): { login: string; password: string } | null {
  const prefix = authCode === 'mge' ? 'MGE' : 'SUDIR'
  const login = process.env[`${prefix}_LOGIN`]?.trim()
  const password = process.env[`${prefix}_PASSWORD`]
  return login && password ? { login, password } : null
}
