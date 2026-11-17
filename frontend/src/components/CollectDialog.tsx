/**
 * Диалог «Обновить данные»: выбор источника и охвата объектов, запуск сбора
 * (POST /api/collect) и поллинг статуса (GET /api/collect/status) до завершения.
 * Сбор выполняет воркер — клиент только триггерит и показывает прогресс.
 */
import { useEffect, useRef, useState } from 'react'
import type { SourceInfo } from '@dc/shared'
import { fetchCollectStatus, fetchObjects, startCollect } from '../api'
import type { CollectStartResponse } from '../api'

interface Props {
  sources: SourceInfo[]
  currentSearch: string
  selectedObjectId: number | null
  onClose: () => void
  onFinished: (summary: { ok: boolean; text: string }) => void
  toast: (kind: 'ok' | 'warn' | 'error', text: string) => void
}

type Scope = 'all' | 'filtered' | 'selected'

interface RunState {
  start: CollectStartResponse
  byStatus: Record<string, number>
  jobs: { id: number; object_name: string; source: string; status: string; error: string | null }[]
  done: boolean
}

export default function CollectDialog({ sources, currentSearch, selectedObjectId, onClose, onFinished, toast }: Props) {
  const enabledSources = sources.filter((s) => s.enabled)
  const [source, setSource] = useState<string>(enabledSources[0]?.code ?? 'mge')
  const [scope, setScope] = useState<Scope>('all')
  const [run, setRun] = useState<RunState | null>(null)
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const start = async () => {
    setStarting(true)
    try {
      let objectIds: number[] | undefined
      if (scope === 'filtered' && currentSearch) {
        const objects = await fetchObjects(currentSearch, 500)
        objectIds = objects.items.map((o) => o.id)
        if (objectIds.length === 0) toast('warn', 'Под текущий фильтр не попало ни одного объекта — будет запущен сбор по всем')
      } else if (scope === 'selected' && selectedObjectId) {
        objectIds = [selectedObjectId]
      }
      const startResp = await startCollect({ source: source === '' ? undefined : source, objectIds })
      const state: RunState = { start: startResp, byStatus: {}, jobs: [], done: false }
      setRun(state)
      toast('ok', `Сбор запущен: ${startResp.enqueued} задач (run ${startResp.run_id.slice(0, 8)}…)`)

      pollRef.current = setInterval(async () => {
        try {
          const st = await fetchCollectStatus(startResp.run_id)
          const done = !st.run || (st.run.by_status['QUEUED'] ?? 0) + (st.run.by_status['ACTIVE'] ?? 0) === 0
          setRun((prev) =>
            prev
              ? {
                  ...prev,
                  byStatus: st.run?.by_status ?? {},
                  jobs: st.jobs.map((j) => ({ id: j.id, object_name: j.object_name, source: j.source, status: j.status, error: j.error })),
                  done,
                }
              : prev,
          )
          if (done && pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        } catch {
          /* сети нет — продолжаем пытаться */
        }
      }, 2000)
    } catch (err) {
      toast('error', `Не удалось запустить сбор: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setStarting(false)
    }
  }

  // итоговое уведомление — один раз при переходе run.done → true
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (run?.done && !notifiedRef.current) {
      notifiedRef.current = true
      const b = run.byStatus
      const failed = (b['FAILED'] ?? 0) + (b['DEAD'] ?? 0)
      const ok = failed === 0
      onFinished({
        ok,
        text: ok
          ? `Сбор завершён: ${b['COMPLETED'] ?? 0} задач успешно`
          : `Сбор завершён с ошибками: успешно ${b['COMPLETED'] ?? 0}, ошибок ${failed}${
              run.jobs.some((j) => (j.error ?? '').startsWith('AMBIGUOUS_MATCH')) ? ' · есть неоднозначные соответствия — npm run resolve:mge' : ''
            }`,
      })
    }
  }, [run?.done, run, onFinished])

  const total = run?.start.enqueued ?? 0
  const doneCount = run ? (run.byStatus['COMPLETED'] ?? 0) + (run.byStatus['FAILED'] ?? 0) + (run.byStatus['DEAD'] ?? 0) : 0
  const failedJobs = (run?.jobs ?? []).filter((j) => j.status === 'FAILED' || j.status === 'DEAD').slice(0, 8)

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Обновить данные</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </header>

        {!run && (
          <div className="modal-body">
            <p className="muted">
              Сбор выполняет воркер (Playwright/таблицы). Клиент только запускает и следит за статусом.
            </p>

            <label className="field">
              <span>Источник</span>
              <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
                {enabledSources.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label} (приоритет {s.priority})
                  </option>
                ))}
                {enabledSources.length === 0 && <option value="">нет включённых источников</option>}
              </select>
              {sources.some((s) => !s.enabled) && (
                <span className="hint">
                  Отключены (sources.enabled=false): {sources.filter((s) => !s.enabled).map((s) => s.label).join(', ')}
                </span>
              )}
            </label>

            <div className="field">
              <span>Объекты</span>
              <div className="radio-group">
                <label>
                  <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> Все активные
                </label>
                <label>
                  <input
                    type="radio"
                    checked={scope === 'filtered'}
                    onChange={() => setScope('filtered')}
                    disabled={!currentSearch}
                  />{' '}
                  Под текущим поиском{currentSearch ? ` («${currentSearch}»)` : ' (нет фильтра)'}
                </label>
                <label>
                  <input
                    type="radio"
                    checked={scope === 'selected'}
                    onChange={() => setScope('selected')}
                    disabled={selectedObjectId === null}
                  />{' '}
                  Выбранный объект{selectedObjectId ? ` #${selectedObjectId}` : ' (не выбран)'}
                </label>
              </div>
            </div>

            <button className="btn primary wide" disabled={starting || enabledSources.length === 0} onClick={() => void start()}>
              {starting ? 'Запуск…' : '▶ Запустить сбор'}
            </button>
          </div>
        )}

        {run && (
          <div className="modal-body">
            <div className="run-summary">
              <div>
                <strong>Запуск {run.start.run_id.slice(0, 8)}…</strong>
                <div className="muted">
                  {run.start.sources.join(', ')} · объектов в охвате: {run.start.objects}
                </div>
              </div>
              <div className={`status-chip ${run.done ? '' : 'pulse'}`}>{run.done ? 'завершён' : 'выполняется…'}</div>
            </div>

            <div className="progress">
              <div style={{ width: total > 0 ? `${(doneCount / total) * 100}%` : '0%' }} />
            </div>
            <div className="run-counts">
              {(['COMPLETED', 'QUEUED', 'ACTIVE', 'FAILED', 'DEAD'] as const).map((st) => (
                <span key={st} className={`count count-${st.toLowerCase()}`}>
                  {st === 'COMPLETED' ? 'успешно' : st === 'QUEUED' ? 'в очереди' : st === 'ACTIVE' ? 'в работе' : st === 'FAILED' ? 'ошибки' : 'dead-letter'}
                  : <strong>{run.byStatus[st] ?? 0}</strong>
                </span>
              ))}
            </div>

            {failedJobs.length > 0 && (
              <div className="failed-list">
                <h4>Ошибки (первые {failedJobs.length})</h4>
                {failedJobs.map((j) => (
                  <div key={j.id} className="failed-item">
                    <span className="muted">#{j.id} · {j.object_name} · {j.source}</span>
                    <div className="err">{j.error ?? ''}</div>
                    {(j.error ?? '').startsWith('AMBIGUOUS_MATCH') && (
                      <div className="hint">→ выберите соответствие: npm run resolve:mge</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button className="btn wide" onClick={onClose}>
              {run.done ? 'Закрыть' : 'Свернуть (сбор продолжается)'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
