import { z } from 'zod'
import { MetricSourceCodeSchema } from './sources.js'

/** Имя очереди задач сбора в pg-boss. */
export const COLLECT_QUEUE = 'collect'

/** Имя cron-расписания суточного сбора в pg-boss. */
export const COLLECT_CRON_NAME = 'collect-daily'

/**
 * Статус доменной задачи сбора (колонка collection_jobs.status).
 * FAILED — была неудачная попытка, ожидается ретрай;
 * DEAD    — dead-letter: попытки исчерпаны (последняя ошибка в error).
 */
export const JobStatusSchema = z.enum(['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'DEAD'])
export type JobStatus = z.infer<typeof JobStatusSchema>

/** Тело задачи в очереди (pg-boss payload). Совпадает с полями collection_jobs. */
export const CollectJobDataSchema = z.object({
  collectionJobId: z.number().int().positive(),
  runId: z.string().uuid(),
  objectId: z.number().int().positive(),
  source: MetricSourceCodeSchema,
})
export type CollectJobData = z.infer<typeof CollectJobDataSchema>

/** POST /api/collect — запуск сбора. */
export const CollectRequestSchema = z.object({
  /** Не задан — все включённые (sources.enabled) источники. */
  source: MetricSourceCodeSchema.optional(),
  /** Не задан — все активные объекты (objects.is_active). */
  objectIds: z.array(z.number().int().positive()).optional(),
})
export type CollectRequest = z.infer<typeof CollectRequestSchema>

/**
 * POST /api/diagnostics/mge — диагностический снимок реального МГЭ.
 * Тот же IP-allowlist, что и у POST /api/collect.
 */
export const DiagnosticsMgeRequestSchema = z.object({
  /** headful-режим (только при локальном запуске с X-сервером; в docker — false) */
  headful: z.boolean().default(false),
  /** Сколько секунд слушать сеть после загрузки главной страницы (5–60) */
  duration_ms: z.number().int().min(3000).max(60000).default(15000),
  /** Имя объекта для пробного поиска; по умолчанию — первый объект из БД */
  search_object_name: z.string().trim().min(1).max(300).optional(),
  /** Снимать ли скриншоты (base64 JPEG в ответе) */
  screenshot: z.boolean().default(true),
})
export type DiagnosticsMgeRequest = z.infer<typeof DiagnosticsMgeRequestSchema>
