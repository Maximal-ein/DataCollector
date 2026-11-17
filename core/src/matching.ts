/**
 * Нечёткое сопоставление названий объектов (восстановлено из шага 4).
 *
 * Алгоритм (согласован с заказчиком):
 *   1. Нормализация: lowercase, ё→е, срез кавычек «»""'', схлопывание пробелов,
 *      срез ведущего кода вида «023-0781 » (в выгрузке СУИД он в отдельной колонке).
 *   2. Сходство — Sørensen–Dice по биграммам (локальная реализация, без зависимостей;
 *      поведение совпадает с pg_trgm similarity в диапазоне практических значений).
 *   3. Пороги:
 *        > 0.85                       — точное совпадение (авто-матч, если нет близкого второго)
 *        0.6 … 0.85                   — кандидат: требуется операторское решение
 *        < 0.6                        — не найдено
 *      Неоднозначность: два кандидата с |Δ| ≤ 0.05 в зоне >0.6 → AMBIGUOUS_MATCH.
 */

export const MATCH_EXACT_THRESHOLD = 0.85
export const MATCH_MIN_THRESHOLD = 0.6
export const MATCH_AMBIGUITY_DELTA = 0.05

/** Нормализация названия для сравнения. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'']/g, ' ')
    .replace(/^\s*\d{2,3}-\d{3,4}\s*/, '') // ведущий код «023-0781 »
    .replace(/\s+/g, ' ')
    .trim()
}

/** Сходство Сёренсена–Дайса по биграммам: 0…1. */
export function diceSimilarity(a: string, b: string): number {
  const s1 = normalizeName(a)
  const s2 = normalizeName(b)
  if (s1 === s2) return 1
  if (s1.length < 2 || s2.length < 2) return 0
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      m.set(bg, (m.get(bg) ?? 0) + 1)
    }
    return m
  }
  const b1 = bigrams(s1)
  const b2 = bigrams(s2)
  let hits = 0
  for (const [bg, n] of b1) {
    const n2 = b2.get(bg)
    if (n2) hits += Math.min(n, n2)
  }
  return (2 * hits) / (s1.length - 1 + s2.length - 1)
}

/** Кандидат из внешней системы (МГЭ и др.). */
export interface MatchCandidate {
  /** ID в сторонней системе (external_ids.mge_id) */
  externalId: string
  name: string
  similarity: number
}

export type MatchResult =
  | { status: 'auto'; best: MatchCandidate }
  | { status: 'ambiguous'; candidates: MatchCandidate[] }
  | { status: 'none' }

/**
 * Сопоставить название объекта со списком кандидатов.
 * candidates — сырой список {id, name} из внешней системы.
 */
export function matchByName(objectName: string, candidates: { id: string; name: string }[]): MatchResult {
  // дедупликация: один и тот же объект мог прийти в нескольких ответах поиска
  const byId = new Map<string, MatchCandidate>()
  for (const c of candidates) {
    const sim = diceSimilarity(objectName, c.name)
    const prev = byId.get(c.id)
    if (!prev || sim > prev.similarity) byId.set(c.id, { externalId: c.id, name: c.name, similarity: sim })
  }
  const scored = [...byId.values()]
    .filter((c) => c.similarity >= MATCH_MIN_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)

  if (scored.length === 0) return { status: 'none' }

  const best = scored[0]!
  const second = scored[1]
  const closeSecond = second !== undefined && best.similarity - second.similarity <= MATCH_AMBIGUITY_DELTA

  if (best.similarity > MATCH_EXACT_THRESHOLD && !closeSecond) {
    return { status: 'auto', best }
  }
  // точная зона с близким вторым, либо зона кандидатов 0.6–0.85 → оператор
  return {
    status: 'ambiguous',
    candidates: scored.slice(0, 5).map((c) => ({ ...c, similarity: Math.round(c.similarity * 1000) / 1000 })),
  }
}
