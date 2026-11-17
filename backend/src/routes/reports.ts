/** GET /api/reports (реестр) + GET /api/reports/:template?object_id=&format= (файл) */
import type Fastify from 'fastify'
import path from 'node:path'
import { ReportQuerySchema } from '@dc/shared'
import { listTemplates, findTemplate, templateDir } from '../reports/registry.js'
import { buildReportData } from '../reports/data.js'
import { renderXlsx } from '../reports/render-xlsx.js'
import { renderDocx } from '../reports/render-docx.js'
import { renderPdf } from '../reports/render-pdf.js'

const CONTENT_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
}

export function registerReportsRoutes(app: Fastify.FastifyInstance): void {
  app.get('/api/reports', async () => ({ templates: await listTemplates() }))

  app.get('/api/reports/:template', async (req, reply) => {
    const templateId = (req.params as { template: string }).template
    let q: ReturnType<typeof ReportQuerySchema.parse>
    try {
      q = ReportQuerySchema.parse(req.query ?? {})
    } catch (err) {
      const message = err instanceof Error ? err.message.split('\n')[0]! : 'Некорректные параметры'
      return reply.code(400).send({ error: `Параметры запроса: ${message}` })
    }

    // 1) шаблон
    let template
    try {
      template = await findTemplate(templateId, q.format)
    } catch (err) {
      const e = err as Error & { statusCode?: number }
      return reply.code(e.statusCode ?? 404).send({ error: e.message })
    }

    // 2) данные (объект + метрики)
    let data
    try {
      data = await buildReportData(q.object_id, q.period)
    } catch (err) {
      const e = err as Error & { statusCode?: number; code?: string }
      if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message, code: e.code })
      throw err
    }

    // 3) рендер
    const filePath = path.join(templateDir(), template.file)
    let buffer: Buffer
    try {
      if (template.format === 'xlsx') buffer = await renderXlsx(filePath, data)
      else if (template.format === 'docx') buffer = await renderDocx(filePath, data)
      else buffer = await renderPdf(filePath, data)
    } catch (err) {
      app.log.error({ err, template: template.file }, 'рендер справки упал')
      return reply.code(500).send({ error: `Ошибка рендера шаблона ${template.file}: ${err instanceof Error ? err.message : String(err)}` })
    }

    const safeName = data.object.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '_').slice(0, 60)
    const filename = `${template.id}-${safeName}-${data.object.id}.${template.format}`
    reply
      .header('Content-Type', CONTENT_TYPES[template.format])
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .header('Content-Length', buffer.length)
    return reply.send(buffer)
  })
}
