export const PREFIXES: Record<string, string> = {
  prose: 'pr',
  character: 'ch',
  guideline: 'gl',
  knowledge: 'kn',
  image: 'im',
  icon: 'ic',
  marker: 'mk',
}

// Consonant-vowel alternation produces pronounceable, LLM-friendly IDs.
// 13 consonants × 5 vowels = 65 combos per pair; 3 pairs (6 chars) ≈ 274k unique IDs per type.
const CONSONANTS = 'bdfgkmnprstvz'
const VOWELS = 'aeiou'

export function generateFragmentId(type: string): string {
  const prefix = PREFIXES[type] ?? type.slice(0, 4).toLowerCase()
  const chars: string[] = []
  for (let i = 0; i < 6; i++) {
    const pool = i % 2 === 0 ? CONSONANTS : VOWELS
    chars.push(pool[Math.floor(Math.random() * pool.length)])
  }
  return `${prefix}-${chars.join('')}`
}

export function generateBranchId(): string {
  const chars: string[] = []
  for (let i = 0; i < 6; i++) {
    const pool = i % 2 === 0 ? CONSONANTS : VOWELS
    chars.push(pool[Math.floor(Math.random() * pool.length)])
  }
  return `br-${chars.join('')}`
}

export function generateFolderId(): string {
  const chars: string[] = []
  for (let i = 0; i < 6; i++) {
    const pool = i % 2 === 0 ? CONSONANTS : VOWELS
    chars.push(pool[Math.floor(Math.random() * pool.length)])
  }
  return `fld-${chars.join('')}`
}
