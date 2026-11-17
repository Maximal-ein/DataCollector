/** Конфигурация окружения API. */
export const env = {
  apiPort: Number(process.env.API_PORT ?? 3000),
  apiHost: process.env.API_HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Каталог шаблонов справок (в контейнере монтируется как том) */
  templatesDir: process.env.REPORTS_TEMPLATES_DIR ?? './templates',
  /**
   * IP-allowlist для «опасных» эндпоинтов (POST /api/collect,
   * POST /api/diagnostics/mge): IP и CIDR через запятую. Пусто = только localhost.
   */
  collectAllowedIps: (process.env.COLLECT_ALLOWED_IPS ?? '127.0.0.1,::1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Прокси перед API (nginx в docker-compose) — доверять X-Forwarded-For */
  trustProxy: (process.env.API_TRUST_PROXY ?? 'true') === 'true',
}
