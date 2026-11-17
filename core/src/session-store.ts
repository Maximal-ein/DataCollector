/**
 * Хранилище авторизационных сессий: таблица sessions + AES-256-GCM.
 *
 * По одной записи на источник АВТОРИЗАЦИИ:
 *   source_id = sources.code='mge'      — своя сессия МГЭ
 *   source_id = sources.code='sudir'    — ОДНА сессия СУДИР для МГЗ/СУИД/Дашборда
 */
import { prisma } from '@dc/db'
import type { BrowserContext } from 'playwright'
import { decryptStorageState, encryptStorageState } from './crypto.js'

/** Тип storageState производим от Playwright (экспортного имени в 1.49 нет). */
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>

export class SessionNotFoundError extends Error {
  constructor(authCode: 'mge' | 'sudir') {
    super(
      `Нет сохранённой сессии для '${authCode}'. Выполните интерактивный логин: ` +
        (authCode === 'mge' ? 'npm run login:mge' : 'npm run login:sudir'),
    )
    this.name = 'SessionNotFoundError'
  }
}

async function sourceIdByCode(code: string): Promise<number | null> {
  const row = await prisma.source.findUnique({ where: { code }, select: { id: true } })
  return row?.id ?? null
}

/** Загрузить расшифрованный storageState (null — сессии нет). */
export async function loadSessionState(authCode: 'mge' | 'sudir'): Promise<StorageState | null> {
  const sourceId = await sourceIdByCode(authCode)
  if (sourceId === null) return null
  const row = await prisma.session.findUnique({ where: { sourceId } })
  if (!row?.storageStateEncrypted) return null
  try {
    return JSON.parse(decryptStorageState(Buffer.from(row.storageStateEncrypted))) as StorageState
  } catch {
    // ключ сменили / данные повреждены — считаем сессию отсутствующей
    return null
  }
}
/** Сохранить (upsert) зашифрованный storageState. */
export async function saveSessionState(authCode: 'mge' | 'sudir', state: StorageState): Promise<void> {
  const sourceId = await sourceIdByCode(authCode)
  if (sourceId === null) {
    throw new Error(`Справочник sources не содержит код '${authCode}' — примените миграции`)
  }
  const encrypted = encryptStorageState(JSON.stringify(state))
  await prisma.session.upsert({
    where: { sourceId },
    create: { sourceId, storageStateEncrypted: encrypted },
    update: { storageStateEncrypted: encrypted },
  })
}
