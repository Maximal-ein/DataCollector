/**
 * Репозиторий объектов: поиск для SPA и служебные выборки.
 */
import { Prisma } from '@prisma/client'
import { getPrisma } from '../index.js'

const prisma = getPrisma()

export interface ObjectRecord {
  id: number
  name: string
  address: string | null
  code_ds: string | null
  uin: string | null
  suid_id: string | null
  is_active: boolean
  external_ids: Prisma.JsonValue
}

export interface ObjectSearchResult {
  total: number
  items: ObjectRecord[]
}

/** Поиск по name (ILIKE) / code_ds / uin / suid_id (ILIKE). */
export async function searchObjects(params: { search?: string; limit: number; offset: number }): Promise<ObjectSearchResult> {
  const like = params.search ? `%${params.search}%` : null
  const where = Prisma.sql`
    WHERE (${like}::text IS NULL
      OR "name" ILIKE ${like}
      OR "code_ds" ILIKE ${like}
      OR "uin" ILIKE ${like}
      OR "suid_id" ILIKE ${like})`

  const items = await prisma.$queryRaw<ObjectRecord[]>(
    Prisma.sql`SELECT "id", "name", "address", "code_ds", "uin", "suid_id", "is_active", "external_ids"
      FROM "objects" ${where}
      ORDER BY "name" LIMIT ${params.limit} OFFSET ${params.offset}`,
  )
  const totalRows = await prisma.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT count(*)::bigint AS count FROM "objects" ${where}`,
  )
  return { total: Number(totalRows[0]?.count ?? 0), items }
}

export async function getObjectById(id: number): Promise<ObjectRecord | null> {
  const rows = await prisma.$queryRaw<ObjectRecord[]>`
    SELECT "id", "name", "address", "code_ds", "uin", "suid_id", "is_active", "external_ids"
    FROM "objects" WHERE "id" = ${id}`
  return rows[0] ?? null
}

/** Первый активный объект (для диагностики МГЭ по умолчанию). */
export async function getFirstObject(): Promise<ObjectRecord | null> {
  const rows = await prisma.$queryRaw<ObjectRecord[]>`
    SELECT "id", "name", "address", "code_ds", "uin", "suid_id", "is_active", "external_ids"
    FROM "objects" WHERE "is_active" ORDER BY "id" LIMIT 1`
  return rows[0] ?? null
}

/** Записать external_ids.mge_id (merge с существующими ключами). */
export async function setExternalId(objectId: number, key: string, value: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "objects"
    SET "external_ids" = COALESCE("external_ids", '{}'::jsonb) || jsonb_build_object(${key}, ${value}::text),
        "updated_at" = now()
    WHERE "id" = ${objectId}`
}
