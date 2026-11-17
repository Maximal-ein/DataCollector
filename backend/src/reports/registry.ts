/**
 * Реестр шаблонов справок: сканирует REPORTS_TEMPLATES_DIR.
 *
 * Шаблон = файл templates/<id>.<ext>, где ext задаёт формат рендера:
 *   .xlsx → ExcelJS    .docx → docx-templates    .html → handlebars + Playwright PDF
 *
 * Имя шаблона (id) = имя файла без расширения, например «spravka».
 * Один id может существовать в нескольких форматах (spravka.xlsx + spravka.html):
 * format в URL уточняет вариант; без format при неоднозначности берётся xlsx.
 */
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ReportFormat, ReportTemplateInfo } from '@dc/shared'

export class TemplateRegistryError extends Error {}

export function templateDir(): string {
  return path.resolve(process.env.REPORTS_TEMPLATES_DIR ?? './templates')
}

const TITLES: Record<string, string> = {
  spravka: 'Справка о показателях объекта',
}

export async function listTemplates(): Promise<ReportTemplateInfo[]> {
  const dir = templateDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    throw new TemplateRegistryError(`Каталог шаблонов не найден: ${dir} (REPORTS_TEMPLATES_DIR)`)
  }
  const out: ReportTemplateInfo[] = []
  for (const file of files) {
    const ext = path.extname(file).slice(1).toLowerCase()
    if (!['xlsx', 'docx', 'html'].includes(ext)) continue
    const id = path.basename(file, path.extname(file))
    const info = await stat(path.join(dir, file))
    if (!info.isFile()) continue
    // html-шаблон рендерится в PDF — его формат для клиента 'pdf'
    const format = ext === 'html' ? ('pdf' as const) : (ext as 'xlsx' | 'docx')
    out.push({ id, format, file, title: TITLES[id] ?? id })
  }
  out.sort((a, b) => a.id.localeCompare(b.id) || a.format.localeCompare(b.format))
  return out
}

export async function findTemplate(id: string, format?: ReportFormat): Promise<ReportTemplateInfo> {
  const templates = await listTemplates()
  const matching = templates.filter((t) => t.id === id)
  if (matching.length === 0) {
    throw Object.assign(
      new Error(`Шаблон «${id}» не найден. Доступные шаблоны: ${templates.map((t) => `${t.id} (${t.format})`).join(', ') || 'нет'}`),
      { statusCode: 404, code: 'TEMPLATE_NOT_FOUND' as const },
    )
  }
  const chosen = format ? matching.find((t) => t.format === format) : matching[0]
  if (!chosen) {
    throw Object.assign(
      new Error(`Шаблон «${id}» недоступен в формате ${format}. Доступные форматы: ${matching.map((t) => t.format).join(', ')}`),
      { statusCode: 404, code: 'TEMPLATE_NOT_FOUND' as const },
    )
  }
  return chosen
}
