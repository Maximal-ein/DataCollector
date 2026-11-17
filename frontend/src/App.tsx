/**
 * DataCollector SPA (шаг 6, раунд «фронтенд»).
 *
 * Читает только готовые данные (v_metrics_unified / metrics_*):
 *   • сводная таблица 1000+ строк × ~100 колонок (TanStack Table + react-virtual);
 *   • фильтры: поиск объекта (name/code_ds/uin), источник (view/сырой), период;
 *   • «Обновить данные» — POST /api/collect + поллинг /api/collect/status;
 *   • «Скачать справку» — GET /api/reports/:template (xlsx/docx/pdf);
 *   • карточка объекта: метрики-победители + сырая история по источникам.
 * Никакой бизнес-логики сбора на клиенте.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TableResponse, TableSource } from '@dc/shared'
import { fetchCollectStatus, fetchTable, fetchHealth } from './api'
import Toolbar from './components/Toolbar'
import DataTable from './components/DataTable'
import ObjectDrawer from './components/ObjectDrawer'
import CollectDialog from './components/CollectDialog'
import ReportDialog from './components/ReportDialog'
import Toasts, { type Toast, type ToastKind } from './components/Toasts'

export default function App() {
  // ── фильтры ──
  const [source, setSource] = useState<TableSource>('unified')
  const [period, setPeriod] = useState<string>('') // '' = все
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

  // ── данные ──
  const [table, setTable] = useState<TableResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [apiOk, setApiOk] = useState<boolean | null>(null)

  // ── UI ──
  const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null)
  const [collectOpen, setCollectOpen] = useState(false)
  const [reportObjectId, setReportObjectId] = useState<number | null>(null) // null = диалог закрыт
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastSeq = useRef(0)

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev.slice(-4), { id, kind, text }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 10000 : 6000)
  }, [])

  // дебаунс поиска
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTable({
        source,
        period: period === '' ? undefined : period,
        search: searchDebounced || undefined,
      })
      setTable(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setTable(null)
    } finally {
      setLoading(false)
    }
  }, [source, period, searchDebounced])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    void fetchHealth().then(setApiOk)
  }, [])

  const periods = useMemo(() => table?.periods ?? [], [table])

  return (
    <div className="app">
      <Toolbar
        search={search}
        onSearch={setSearch}
        source={source}
        onSource={setSource}
        sources={table?.sources ?? []}
        period={period}
        onPeriod={setPeriod}
        periods={periods}
        table={table}
        apiOk={apiOk}
        onReload={() => void reload()}
        onCollect={() => setCollectOpen(true)}
        onReport={() => setReportObjectId(0)}
      />

      <main className="main">
        {error && <div className="banner banner-error">Ошибка загрузки: {error}</div>}
        {apiOk === false && (
          <div className="banner banner-warn">
            API недоступен. Проверьте сервис api (docker compose ps) — без него данные не загрузятся.
          </div>
        )}
        {loading && !table && <div className="banner">Загрузка данных…</div>}

        <DataTable
          table={table}
          loading={loading}
          source={source}
          onObjectClick={(id) => setSelectedObjectId(id)}
          onCollectHint={() => setCollectOpen(true)}
          onImportHint={undefined}
        />

        <footer className="footer">
          DataCollector · данные из v_metrics_unified (приоритеты источников) ·{' '}
          {table ? `${table.rows.length} из ${table.total} объектов · ${table.columns.length} показателей` : '—'}
        </footer>
      </main>

      {selectedObjectId !== null && (
        <ObjectDrawer
          objectId={selectedObjectId}
          onClose={() => setSelectedObjectId(null)}
          onReport={(id) => setReportObjectId(id)}
        />
      )}

      {collectOpen && (
        <CollectDialog
          sources={table?.sources ?? []}
          currentSearch={searchDebounced}
          selectedObjectId={selectedObjectId}
          onClose={() => setCollectOpen(false)}
          onFinished={(summary) => {
            toast(summary.ok ? 'ok' : summary.ok ? 'ok' : 'warn', summary.text)
            void reload()
          }}
          toast={toast}
        />
      )}

      {reportObjectId !== null && (
        <ReportDialog
          preselectedObjectId={reportObjectId || undefined}
          periods={periods}
          onClose={() => setReportObjectId(null)}
          toast={toast}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  )
}

/** Ссылка на последний запуск — для чипа статуса в тулбаре (подгружаем лениво). */
export function useLastRun() {
  const [last, setLast] = useState<{ run_id: string; by_status: Record<string, number>; finished_at: string | null } | null>(null)
  useEffect(() => {
    void fetchCollectStatus()
      .then((s) => setLast(s.recent[0] ?? null))
      .catch(() => undefined)
  }, [])
  return last
}
