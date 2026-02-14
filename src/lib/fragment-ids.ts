export const PREFIXES: Record<string, string> = {
  prose: 'pr',
  character: 'ch',
  guideline: 'gl',
  knowledge: 'kn',
}

export function generateFragmentId(type: string): string {
  const prefix = PREFIXES[type] ?? type.slice(0, 4).toLowerCase()
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${suffix}`
}
