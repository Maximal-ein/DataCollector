/**
 * IP-allowlist для эндпоинтов, которые запускают браузер/сбор
 * (POST /api/collect, POST /api/diagnostics/mge).
 *
 * Формат COLLECT_ALLOWED_IPS: IP или CIDR через запятую (IPv4/IPv6).
 * Пустое значение = только localhost (127.0.0.1, ::1).
 * API за nginx (docker-compose) — fastify с trustProxy корректно берёт
 * адрес клиента из X-Forwarded-For.
 */
import type { FastifyRequest } from 'fastify'
import ipaddr from 'ipaddr.js'

const LOCALHOST = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** Пара (адрес, длина префикса) — результат parseCIDR / parse+range. */
type Subnet = [ipaddr.IPv4 | ipaddr.IPv6, number]

function parseEntry(entry: string): Subnet | null {
  try {
    if (entry.includes('/')) return ipaddr.parseCIDR(entry) as Subnet
    const addr = ipaddr.parse(entry)
    return [addr, addr.kind() === 'ipv4' ? 32 : 128]
  } catch {
    return null
  }
}

export function clientIpAllowed(ip: string | undefined, allowlistRaw: string[]): boolean {
  const entries = allowlistRaw.length > 0 ? allowlistRaw : ['127.0.0.1', '::1']
  if (!ip) return false
  let addr: ipaddr.IPv4 | ipaddr.IPv6
  try {
    addr = ipaddr.process(ip)
  } catch {
    return false
  }
  if (LOCALHOST.has(addr.toString())) {
    return entries.some((e) => LOCALHOST.has(e.trim().replace(/^::ffff:/, '')) || e.trim() === '127.0.0.1' || e.trim() === '::1')
  }
  const subnets = entries.map((e) => parseEntry(e.trim())).filter((s): s is Subnet => s !== null)
  return subnets.some((s) => {
    try {
      return addr.match(s)
    } catch {
      return false
    }
  })
}

/** Проверка IP запроса по allowlist; кидает ошибку 403-семантики. */
export function assertIpAllowed(req: FastifyRequest, allowlistRaw: string[]): void {
  if (!clientIpAllowed(req.ip, allowlistRaw)) {
    throw Object.assign(new Error(`Доступ с ${req.ip} запрещён (COLLECT_ALLOWED_IPS)`), { statusCode: 403 })
  }
}
