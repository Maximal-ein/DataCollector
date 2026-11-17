/**
 * Карточка объекта (боковая панель): метрики-победители (unified) и сырая
 * история по источникам — для отладки приоритетов. Отсюда же — выгрузка справки.
 */
import { useEffect, useState } from 'react'
import type { ObjectMetricsResponse } from '@dc/shared'
import { fetchObjectMetrics } from '../api'

interface Props {
  objectId: number
  onClose: () => void
  onReport: (objectId: number) => void
}

const SOURCE_LABELS: Record<string, string> = {
  mge: 'МГЭ',
  mgz: 'МГЗ',
  suid: 'СУИД',
  dashboard: 'Дашборд',
  gsheets: 'Google Sheets',
  yandex: 'Yandex',
}

export default function ObjectDrawer({ objectId, onClose, onReport }: Props) {
  const [mode, setMode] = useState<'unified' | 'raw'>('unified')
  const [rawSource, setRawSource] = useState<string>('mge')
  const [data, setData] = useState<ObjectMetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchObjectMetrics(objectId, mode === 'raw' ? { raw: true, source: rawSource } : {})
      .then((d) => setData(d))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [objectId, mode, rawSource])

  const metrics = data?.metrics ?? []

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>{data?.object.name ?? `Объект #${objectId}`}</h2>
            <div className="drawer-sub">
              {data?.object.code_ds ? `код ДС ${data.object.code_ds}` : 'код ДС —'} · {data?.object.uin ? `УИН ${data.object.uin}` : 'УИН —'}
            </div>
          </div>
          <button className="btn-close" onClick={onClose} title="Закрыть (Esc)">
            ✕
          </button>
        </header>

        <div className="drawer-tabs">
          <button className={`tab ${mode === 'unified' ? 'active' : ''}`} onClick={() => setMode('unified')}>
            Единые метрики (view)
          </button>
          <button className={`tab ${mode === 'raw' ? 'active' : ''}`} onClick={() => setMode('raw')}>
            Сырые метрики (источник)
          </button>
          {mode === 'raw' && (
            <select className="input small" value={rawSource} onChange={(e) => setRawSource(e.target.value)}>
              {Object.entries(SOURCE_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="drawer-body">
          {loading && <div className="muted pad">Загрузка…</div>}
          {error && <div className="banner banner-error">{error}</div>}
          {!loading && !error && metrics.length === 0 && (
            <div className="table-state empty">
              <p>
                {mode === 'unified'
                  ? 'Метрик нет — запустите сбор (кнопка «Обновить данные»).'
                  : `У источника ${SOURCE_LABELS[rawSource] ?? rawSource} нет метрик по этому объекту.`}
              </p>
            </div>
          )}
          {!loading && metrics.length > 0 && (
            <table className="drawer-table">
              <thead>
                <tr>
                  <th>Показатель</th>
                  <th>Значение</th>
                  <th>Ед.</th>
                  <th>{mode === 'unified' ? 'Источник' : 'Период'}</th>
                  <th>Собрано</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m, i) => (
                  <tr key={`${m.metric_key}-${m.period}-${i}`}>
                    <td title={m.metric_key}>{m.metric_key}</td>
                    <td className={m.metric_value_num !== null ? 'num' : ''}>{m.metric_value ?? '—'}</td>
                    <td>{m.unit ?? ''}</td>
                    <td>
                      {mode === 'unified'
                        ? (SOURCE_LABELS[m.source_code] ?? m.source_code)
                        : m.period === ''
                          ? 'текущее'
                          : m.period}
                    </td>
                    <td className="muted">{new Date(m.collected_at).toLocaleString('ru-RU')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="drawer-foot">
          <button className="btn primary" onClick={() => onReport(objectId)} disabled={metrics.length === 0}>
            ⤓ Скачать справку по объекту
          </button>
          {metrics.length === 0 && (
            <span className="muted" title="Для справки нужны метрики">
              (нет метрик)
            </span>
          )}
        </footer>
      </aside>
    </div>
  )
}

export { SOURCE_LABELS }
