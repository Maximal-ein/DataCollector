/** Типизированный клиент REST API для SPA. Никакой логики сбора на клиенте. */
import type {
  TableResponse,
  TableSource,
  ObjectsListResponse,
  ObjectMetricsResponse,
  CollectStatusResponse,
  ReportTemplateInfo,
} from '@dc/shared'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function get<T>(url: string): Promise<T> {
  const resp = await fetch(url)
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`
    try {
      const body = (await resp.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* тело не JSON */
    }
    throw new ApiError(resp.status, message)
  }
  return (await resp.json()) as T
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`
    try {
      const err = (await resp.json()) as { error?: string }
      if (err.error) message = err.error
    } catch {
      /* ignore */
    }
    throw new ApiError(resp.status, message)
  }
  return (await resp.json()) as T
}

export interface CollectStartResponse {
  run_id: string
  enqueued: number
  sources: string[]
  skipped_disabled: string[]
  objects: number
}

export function fetchTable(params: { source: TableSource; period?: string; search?: string; limit?: number }): Promise<TableResponse> {
  const qs = new URLSearchParams()
  qs.set('source', params.source)
  if (params.period !== undefined && params.period !== '') qs.set('period', params.period)
  if (params.search) qs.set('search', params.search)
  qs.set('limit', String(params.limit ?? 1000))
  return get<TableResponse>(`/api/table?${qs.toString()}`)
}

export function fetchObjects(search: string | undefined, limit = 50): Promise<ObjectsListResponse> {
  const qs = new URLSearchParams()
  if (search) qs.set('search', search)
  qs.set('limit', String(limit))
  return get<ObjectsListResponse>(`/api/objects?${qs.toString()}`)
}

export function fetchObjectMetrics(
  id: number,
  opts: { raw?: boolean; source?: string; period?: string } = {},
): Promise<ObjectMetricsResponse> {
  const qs = new URLSearchParams()
  if (opts.raw) qs.set('raw', 'true')
  if (opts.source) qs.set('source', opts.source)
  if (opts.period) qs.set('period', opts.period)
  return get<ObjectMetricsResponse>(`/api/objects/${id}/metrics?${qs.toString()}`)
}

export function startCollect(body: { source?: string; objectIds?: number[] }): Promise<CollectStartResponse> {
  return post<CollectStartResponse>('/api/collect', body)
}

export function fetchCollectStatus(runId?: string): Promise<CollectStatusResponse> {
  const qs = runId ? `?run_id=${encodeURIComponent(runId)}` : ''
  return get<CollectStatusResponse>(`/api/collect/status${qs}`)
}

export function fetchReportTemplates(): Promise<{ templates: ReportTemplateInfo[] }> {
  return get<{ templates: ReportTemplateInfo[] }>('/api/reports')
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const r = await fetch('/health')
    return r.ok
  } catch {
    return false
  }
}

export function reportDownloadUrl(templateId: string, objectId: number, format: string, period?: string): string {
  const qs = new URLSearchParams({ object_id: String(objectId), format })
  if (period) qs.set('period', period)
  return `/api/reports/${encodeURIComponent(templateId)}?${qs.toString()}`
}
