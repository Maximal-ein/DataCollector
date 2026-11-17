/**
 * Сводная таблица: TanStack Table + @tanstack/react-virtual.
 * Виртуализируются и строки, и колонки; первые две колонки (объект, код ДС)
 * закреплены слева, шапка — сверху. 1000+ × ~100 без лагов.
 */
import { useMemo, useRef } from 'react'
import { useReactTable, getCoreRowModel, type ColumnDef } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { TableResponse, TableRow, TableSource } from '@dc/shared'

interface Props {
  table: TableResponse | null
  loading: boolean
  source: TableSource
  onObjectClick: (objectId: number) => void
  onCollectHint: () => void
  onImportHint?: () => void
}

const SOURCE_ABBR: Record<string, string> = {
  mge: 'МГЭ',
  mgz: 'МГЗ',
  suid: 'СУИД',
  dashboard: 'ДШБ',
  gsheets: 'GS',
  yandex: 'ЯНД',
  unified: '',
}

const ROW_H = 34
const HEAD_H = 44
const STICKY_1 = 300 // Наименование
const STICKY_2 = 104 // Код ДС
const COL_W = 172

export default function DataTable({ table, loading, source, onObjectClick, onCollectHint, onImportHint }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => table?.rows ?? [], [table])
  const metricColumns = useMemo(() => table?.columns ?? [], [table])

  const columns = useMemo<ColumnDef<TableRow, unknown>[]>(() => {
    const sticky: ColumnDef<TableRow, unknown>[] = [
      {
        id: 'name',
        header: 'Объект',
        cell: (info) => (
          <div className="cell-name" title={`${info.getValue() as string}\nкод ДС: ${info.row.original.code_ds ?? '—'} · УИН: ${info.row.original.uin ?? '—'}`}>
            {info.getValue() as string}
          </div>
        ),
      },
      {
        id: 'code_ds',
        header: 'Код ДС',
        cell: (info) => <span className="cell-code">{(info.getValue() as string) ?? '—'}</span>,
      },
    ]
    const metrics: ColumnDef<TableRow, unknown>[] = metricColumns.map((col) => ({
      id: col.key,
      header: col.label.length > 26 ? col.label.slice(0, 25) + '…' : col.label,
      cell: (info) => {
        const cell = info.row.original.cells[col.key]
        if (!cell) return <span className="cell-empty">—</span>
        const tip = `${col.key}: ${cell.v ?? '—'}${cell.u ? ` ${cell.u}` : ''}\nисточник: ${cell.s} · собрано: ${new Date(cell.c).toLocaleString('ru-RU')}`
        return (
          <span className={`cell-val ${cell.n !== null ? 'num' : ''}`} title={tip}>
            {cell.v ?? '—'}
            {source === 'unified' && cell.s !== 'unified' && <sup className="src-badge">{SOURCE_ABBR[cell.s] ?? cell.s}</sup>}
          </span>
        )
      },
    }))
    return [...sticky, ...metrics]
  }, [metricColumns, source])

  const tanTable = useReactTable<TableRow>({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const rowVirtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })

  const colVirtual = useVirtualizer({
    count: metricColumns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COL_W,
    horizontal: true,
    paddingStart: STICKY_1 + STICKY_2,
    overscan: 8,
  })

  // ── пустые состояния ──
  if (loading && !table) {
    return <div className="table-state">Загрузка таблицы…</div>
  }
  if (!table) return null

  if (table.total === 0) {
    return (
      <div className="table-state empty">
        <h3>Объектов пока нет</h3>
        <p>
          Импортируйте выгрузку СУИД:
          <code> npm run import:objects --file=export.xlsx</code>
        </p>
        <p className="muted">После импорта здесь появится таблица объектов; метрики заполнятся после сбора.</p>
        {onImportHint && <button className="btn" onClick={onImportHint}>Как импортировать?</button>}
      </div>
    )
  }

  const showNoMetrics = table.columns.length === 0

  return (
    <div className="table-wrap-outer">
      {showNoMetrics && (
        <div className="banner banner-warn">
          По выбранному источнику/периоду метрик нет. Запустите сбор —{' '}
          <button className="link" onClick={onCollectHint}>
            Обновить данные
          </button>
        </div>
      )}
      <div className="table-wrap" ref={scrollRef}>
        <div
          className="table-inner"
          style={{ width: STICKY_1 + STICKY_2 + metricColumns.length * COL_W }}
        >
          {/* ── шапка (sticky top) ── */}
          <div className="thead" style={{ height: HEAD_H }}>
            <div className="th sticky-1" style={{ width: STICKY_1 }}>
              Объект ({table.rows.length}/{table.total})
            </div>
            <div className="th sticky-2" style={{ width: STICKY_2 }}>
              Код ДС
            </div>
            <div className="thead-metrics" style={{ width: metricColumns.length * COL_W }}>
              {colVirtual.getVirtualItems().map((vc) => {
                const col = metricColumns[vc.index]
                if (!col) return null
                return (
                  <div
                    key={col.key}
                    className="th th-metric"
                    style={{ left: vc.start - STICKY_1 - STICKY_2, width: COL_W }}
                    title={`${col.label}\nзаполнено: ${Math.round(col.fill * 100)}%`}
                  >
                    <span className="th-label">{col.label.length > 26 ? col.label.slice(0, 25) + '…' : col.label}</span>
                    <span className="th-fill" style={{ width: `${Math.round(col.fill * 100)}%` }} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── строки ── */}
          <div className="tbody-spacer" style={{ height: rowVirtual.getTotalSize() }}>
            {rowVirtual.getVirtualItems().map((vr) => {
              const row = tanTable.getRowModel().rows[vr.index]
              if (!row) return null
              return (
                <div
                  key={row.id}
                  className="tr"
                  style={{ height: ROW_H, transform: `translateY(${vr.start}px)` }}
                  onClick={() => onObjectClick(row.original.object_id)}
                >
                  <div className="td sticky-1" style={{ width: STICKY_1 }}>
                    <span className="cell-name">{row.original.name}</span>
                  </div>
                  <div className="td sticky-2" style={{ width: STICKY_2 }}>
                    <span className="cell-code">{row.original.code_ds ?? '—'}</span>
                  </div>
                  <div className="td-metrics" style={{ width: metricColumns.length * COL_W }}>
                    {colVirtual.getVirtualItems().map((vc) => {
                      const col = metricColumns[vc.index]
                      if (!col) return null
                      const cell = row.original.cells[col.key]
                      const tip = cell
                        ? `${col.key}: ${cell.v ?? '—'}${cell.u ? ` ${cell.u}` : ''}\nисточник: ${cell.s} · собрано: ${new Date(cell.c).toLocaleString('ru-RU')}`
                        : col.key
                      return (
                        <div
                          key={col.key}
                          className={`td td-metric ${cell?.n !== null && cell ? 'num' : ''}`}
                          style={{ left: vc.start - STICKY_1 - STICKY_2, width: COL_W }}
                          title={tip}
                        >
                          {cell ? (
                            <>
                              {cell.v ?? '—'}
                              {source === 'unified' && cell.s !== 'unified' && (
                                <sup className="src-badge">{SOURCE_ABBR[cell.s] ?? cell.s}</sup>
                              )}
                            </>
                          ) : (
                            <span className="cell-empty">—</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {source === 'unified' && table.columns.length > 0 && (
        <div className="legend">
          {Object.entries(SOURCE_ABBR)
            .filter(([code]) => table.sources.some((s) => s.code === code && s.has_data))
            .map(([code, abbr]) => (
              <span key={code}>
                <span className="src-badge">{abbr}</span> — источник-победитель по приоритету
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
