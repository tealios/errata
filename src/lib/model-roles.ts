export interface ModelRoleConfig {
  key: string
  label: string
  description: string
  fallback: string[]
}

export const MODEL_ROLES: ModelRoleConfig[] = [
  { key: 'generation', label: 'Generation', description: 'Main prose writing', fallback: [] },
  { key: 'librarian', label: 'Librarian', description: 'Background analysis and summaries', fallback: ['generation'] },
  { key: 'proseTransform', label: 'Prose Transform', description: 'Rewrite, expand, compress selected text', fallback: ['librarian', 'generation'] },
  { key: 'librarianChat', label: 'Librarian Chat', description: 'Interactive librarian conversation', fallback: ['librarian', 'generation'] },
  { key: 'librarianRefine', label: 'Librarian Refine', description: 'Fragment refinement', fallback: ['librarian', 'generation'] },
  { key: 'characterChat', label: 'Character Chat', description: 'In-character conversations', fallback: ['generation'] },
]

/** Map from role key to its settings field names */
export function roleSettingsKeys(roleKey: string): { providerId: string; modelId: string } {
  if (roleKey === 'generation') {
    return { providerId: 'providerId', modelId: 'modelId' }
  }
  return {
    providerId: `${roleKey}ProviderId`,
    modelId: `${roleKey}ModelId`,
  }
}
