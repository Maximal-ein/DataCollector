/**
 * Рендер PDF: HTML+CSS-шаблон (handlebars) → Chromium page.pdf().
 *
 * Язык шаблона — handlebars:
 *   {{object.name}}, {{generated_at}}, {{period_label}}
 *   {{#each metrics}} {{this.key}} {{this.value}} {{/each}}
 */
import { readFile } from 'node:fs/promises'
import Handlebars from 'handlebars'
import type { ReportData } from '@dc/shared'
import { withSharedBrowser } from './browser-pool.js'

export async function renderPdf(templatePath: string, data: ReportData): Promise<Buffer> {
  const html = await readFile(templatePath, 'utf8')
  const compile = Handlebars.compile(html, { noEscape: false })
  const body = compile({
    ...data,
    // вычисляемые поля (как в xlsx/docx-рендерах)
    metrics_count: data.metrics.length,
    period_label: data.period === '' ? 'все периоды' : data.period,
  })

  return withSharedBrowser(async (context) => {
    const page = await context.newPage()
    try {
      await page.setContent(body, { waitUntil: 'load' })
      // даём шрифтам/картинкам (если появятся в реальных формах) время примениться
      await page.evaluate('document.fonts?.ready ?? undefined').catch(() => undefined)
      return Buffer.from(await page.pdf({ format: 'A4', printBackground: true }))
    } finally {
      await page.close()
    }
  })
}
