/**
 * Шифрование storageState (AES-256-GCM).
 *
 * Формат в БД (sessions.storage_state_encrypted, BYTEA):
 *   iv(12 байт) || authTag(16 байт) || ciphertext
 * Ключ — SESSION_ENCRYPTION_KEY (hex, 64 символа = 32 байта).
 * Смена ключа инвалидирует сохранённые сессии (потребуется перелогин).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_LEN = 12
const TAG_LEN = 16

export class SessionCryptoError extends Error {}

/** Ключ шифрования из env (32 байта в hex). */
export function getSessionKey(): Buffer {
  const hex = process.env.SESSION_ENCRYPTION_KEY ?? ''
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new SessionCryptoError(
      'SESSION_ENCRYPTION_KEY не задан или не является 64-символьным hex (32 байта). ' +
        'Сгенерируйте: openssl rand -hex 32',
    )
  }
  return Buffer.from(hex, 'hex')
}

/** Зашифровать JSON storageState → BYTEA для sessions. */
export function encryptStorageState(storageStateJson: string): Buffer {
  const key = getSessionKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(storageStateJson, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct])
}

/** Расшифровать BYTEA из sessions → JSON storageState. */
export function decryptStorageState(encrypted: Buffer): string {
  if (encrypted.length < IV_LEN + TAG_LEN) {
    throw new SessionCryptoError('Повреждённый storageState (короче iv+tag)')
  }
  const key = getSessionKey()
  const iv = encrypted.subarray(0, IV_LEN)
  const tag = encrypted.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = encrypted.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
