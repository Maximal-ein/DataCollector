import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __dcPrisma: PrismaClient | undefined
}

/**
 * Единый инстанс PrismaClient на процесс (api / worker / скрипты логина).
 * Кэшируется в globalThis, чтобы переживать hot-reload в dev-режиме.
 */
export function getPrisma(): PrismaClient {
  if (!globalThis.__dcPrisma) {
    globalThis.__dcPrisma = new PrismaClient({
      log:
        process.env.LOG_LEVEL === 'debug'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    })
  }
  return globalThis.__dcPrisma
}

/** Готовый к использованию клиент (ленивое подключение при первом запросе). */
export const prisma = getPrisma()

export * from '@prisma/client'
export * from './repos/metrics.js'
export * from './repos/objects.js'
export * from './repos/table.js'
export * from './repos/jobs.js'
export { getBoss, startBoss, sendJobs, ensureQueue } from './boss.js'
