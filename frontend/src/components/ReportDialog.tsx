/**
 * Диалог «Скачать справку»: выбор объекта (поиск), шаблона (из /api/reports)
 * и формата; скачивание через GET /api/reports/:template (файл стримится API).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObjectListItem, ReportTemplateInfo } from '@dc/shared'
import { fetchHealth, fetchObjects, fetchReportTemplates, reportDownloadUrl } from '../api'

interface Props {
  preselectedObjectId?: number
  periods: string[]
  onClose: () => void
  toast: (kind: 'ok' | 'warn' | 'error', text: string) => void
}

export default function ReportDialog({ preselectedObjectId, periods, onClose, toast }: Props) {
  const [templates, setTemplates] = useState<ReportTemplateInfo[]>([])
  const [objects, setObjects] = useState<ObjectListItem[]>([])
  const [objectQuery, setObjectQuery] = useState('')
  const [selectedObject, setSelectedObject] = useState<ObjectListItem | null>(null)
  const [templateId, setTemplateId] = useState<string>('')
  const [format, setFormat] = useState<string>('')
  const [period, setPeriod] = useState('')
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const searchSeq = useRef(0)

  useEffect(() => {
    void (async () => {
      try {
        const [tpl, objs] = await Promise.all([fetchReportTemplates(), fetchObjects(undefined, 50)])
        setTemplates(tpl.templates)
        setObjects(objs.items)
        const first = tpl.templates[0]
        if (first) {
          setTemplateId(first.id)
          setFormat(first.format)
        }
      } catch (err) {
        toast('error', `Не удалось загрузить шаблоны: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setLoading(false)
      }
    })()
  }, [toast])

  // предвыбранный объект (из карточки)
  useEffect(() => {
    if (preselectedObjectId) {
      void fetchObjects(undefined, 500).then((all) => {
        const obj = all.items.find((o) => o.id === preselectedObjectId) ?? null
        if (obj) {
          setSelectedObject(obj)
          setObjectQuery(obj.name)
        }
      })
    }
  }, [preselectedObjectId])

  // поиск объектов с дебаунсом
  useEffect(() => {
    if (selectedObject && objectQuery === selectedObject.name) return
    const seq = ++searchSeq.current
    const t = setTimeout(() => {
      void fetchObjects(objectQuery || undefined, 20).then((r) => {
        if (seq === searchSeq.current) setObjects(r.items)
      })
    }, 300)
    return () => clearTimeout(t)
  }, [objectQuery, selectedObject])

  const templateFormats = useMemo(
    () => templates.filter((t) => t.id === templateId).map((t) => t.format),
    [templates, templateId],
  )

  const download = async () => {
    if (!selectedObject || !templateId || !format) return
    setDownloading(true)
    try {
      const health = await fetchHealth()
      if (!health) throw new Error('API недоступен')
      const url = reportDownloadUrl(templateId, selectedObject.id, format, period || undefined)
      const resp = await fetch(url)
      if (!resp.ok) {
        let message = `HTTP ${resp.status}`
        try {
          const body = (await resp.json()) as { error?: string }
          if (body.error) message = body.error
        } catch {
          /* ignore */
        }
        throw new Error(message)
      }
      const blob = await resp.blob()
      const cd = resp.headers.get('content-disposition') ?? ''
      const match = cd.match(/filename\*=UTF-8''([^;]+)/)
      const filename = match ? decodeURIComponent(match[1]!) : `spravka.${format}`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
      toast('ok', `Справка скачана: ${filename}`)
      onClose()
    } catch (err) {
      toast('error', `Справка не сформирована: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Скачать справку</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </header>

        <div className="modal-body">
          {loading && <div className="muted">Загрузка шаблонов…</div>}

          {!loading && templates.length === 0 && (
            <div className="banner banner-warn">
              Шаблоны не найдены. Положите файлы в каталог templates/ (см. templates/README.md) — реестр строится автоматически.
            </div>
          )}

          {templates.length > 0 && (
            <>
              <label className="field">
                <span>Объект</span>
                <input
                  className="input"
                  list="objects-list"
                  placeholder="Начните вводить название / код ДС / УИН…"
                  value={objectQuery}
                  onChange={(e) => {
                    setObjectQuery(e.target.value)
                    setSelectedObject(null)
                  }}
                  onBlur={() => {
                    const found = objects.find((o) => o.name === objectQuery)
                    if (found) setSelectedObject(found)
                  }}
                />
                <datalist id="objects-list">
                  {objects.map((o) => (
                    <option key={o.id} value={o.name}>
                      {o.code_ds ?? o.uin ?? `id ${o.id}`}
                    </option>
                  ))}
                </datalist>
                <span className="hint">
                  {selectedObject
                    ? `Выбран: #${selectedObject.id} · ${selectedObject.code_ds ?? 'без кода ДС'}`
                    : 'Выберите объект из подсказок'}
                </span>
              </label>

              <label className="field">
                <span>Шаблон</span>
                <select
                  className="input"
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value)
                    const first = templates.find((t) => t.id === e.target.value)
                    setFormat(first?.format ?? '')
                  }}
                >
                  {templates.map((t) => (
                    <option key={`${t.id}-${t.format}`} value={t.id}>
                      {t.title} ({t.format})
                    </option>
                  ))}
                </select>
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Формат</span>
                  <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
                    {templateFormats.map((f) => (
                      <option key={f} value={f}>
                        {f === 'xlsx' ? 'Excel (.xlsx)' : f === 'docx' ? 'Word (.docx)' : 'PDF (.pdf)'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Период (необязательно)</span>
                  <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
                    <option value="">Все периоды</option>
                    {periods
                      .filter((p) => p !== '')
                      .map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <button
                className="btn primary wide"
                disabled={!selectedObject || !templateId || !format || downloading}
                onClick={() => void download()}
              >
                {downloading ? 'Формируется…' : `⤓ Скачать ${format.toUpperCase()}`}
              </button>
              <p className="hint">
                Метрики берутся из v_metrics_unified (победители по приоритетам источников).
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
