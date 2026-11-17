/**
 * Рендер docx-шаблона (библиотека docx-templates, разделители {{ }}).
 *
 * Язык шаблона (см. templates/README.md):
 *   {{object.name}}, {{generated_at}}, …
 *   цикл:  {{#for m in metrics}} … {{m.key}} {{m.value}} {{m.unit}} … {{/for}}
 *   условие: {{#if metric.value}} … {{/if}}
 */
import { readFile } from 'node:fs/promises'
import { createReport } from 'docx-templates'
import type { ReportData } from '@dc/shared'

export async function renderDocx(templatePath: string, data: ReportData): Promise<Buffer> {
  const template = await readFile(templatePath)
  const buffer = await createReport({
    template,
    data: {
      ...data,
      // вычисляемые поля (как в xlsx/html-рендерах)
      metrics_count: data.metrics.length,
      period_label: data.period === '' ? 'все периоды' : data.period,
      period: data.period === '' ? 'все периоды' : data.period,
    },
    cmdDelimiter: ['{{', '}}'],
    failFast: false,
  })
  return Buffer.from(buffer as ArrayBuffer)
}
