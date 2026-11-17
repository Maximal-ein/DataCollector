/** Верхняя панель: логотип, поиск, источник, период, статус, действия. */
import type { TableResponse, TableSource, SourceInfo } from '@dc/shared'

interface Props {
  search: string
  onSearch: (v: string) => void
  source: TableSource
  onSource: (v: TableSource) => void
  sources: SourceInfo[]
  period: string
  onPeriod: (v: string) => void
  periods: string[]
  table: TableResponse | null
  apiOk: boolean | null
  onReload: () => void
  onCollect: () => void
  onReport: () => void
}

function periodLabel(p: string): string {
  if (p === '') return 'текущие'
  return p
}

export default function Toolbar({
  search,
  onSearch,
  source,
  onSource,
  sources,
  period,
  onPeriod,
  periods,
  table,
  apiOk,
  onReload,
  onCollect,
  onReport,
}: Props) {
  const collected = table?.data_collected_at ? new Date(table.data_collected_at) : null

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <div className="logo">
          <span className="logo-mark">▦</span> DataCollector
        </div>
        <span className={`api-dot ${apiOk === false ? 'down' : ''}`} title={apiOk === false ? 'API недоступен' : 'API доступен'} />
      </div>

      <div className="toolbar-filters">
        <input
          className="input search"
          type="search"
          placeholder="Объект: название / код ДС / УИН…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <label className="select-wrap" title="Источник данных: единое представление (по приоритетам) или сырая таблица источника">
          <span>Источник</span>
          <select value={source} onChange={(e) => onSource(e.target.value as TableSource)}>
            <option value="unified">Единые данные (view)</option>
            {sources.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label} (сырой){s.has_data ? '' : ' — нет данных'}
              </option>
            ))}
          </select>
        </label>
        <label className="select-wrap" title="Период метрик (из данных)">
          <span>Период</span>
          <select value={period} onChange={(e) => onPeriod(e.target.value)}>
            <option value="">Все периоды</option>
            {periods.map((p) => (
              <option key={p} value={p}>
                {p === '' ? '∅ текущие' : periodLabel(p)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toolbar-actions">
        {collected && (
          <span className="status-chip" title="Свежесть данных: максимальный collected_at в представлении">
            данные на {collected.toLocaleString('ru-RU')}
          </span>
        )}
        <button className="btn ghost" onClick={onReload} title="Перечитать данные из БД">
          ⟳ Обновить таблицу
        </button>
        <button className="btn primary" onClick={onCollect}>
          ▶ Обновить данные
        </button>
        <button className="btn" onClick={onReport}>
          ⤓ Скачать справку
        </button>
      </div>
    </header>
  )
}
