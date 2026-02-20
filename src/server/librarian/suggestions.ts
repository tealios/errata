import { generateFragmentId } from '@/lib/fragment-ids'
import type { Fragment } from '../fragments/schema'
import {
  createFragment,
  getFragment,
  listFragments,
  updateFragment,
  updateFragmentVersioned,
} from '../fragments/storage'
import { registry } from '../fragments/registry'
import type { LibrarianAnalysis } from './storage'

type KnowledgeSuggestion = LibrarianAnalysis['knowledgeSuggestions'][number]

interface ApplySuggestionResult {
  fragmentId: string
  created: boolean
  updated: boolean
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function resolveSourceFragmentId(
  analysis: LibrarianAnalysis,
  suggestion: KnowledgeSuggestion,
): string | null {
  return suggestion.sourceFragmentId ?? analysis.fragmentId ?? null
}

async function findSuggestionFragment(
  dataDir: string,
  storyId: string,
  analysis: LibrarianAnalysis,
  suggestion: KnowledgeSuggestion,
): Promise<Fragment | null> {
  if (suggestion.targetFragmentId) {
    const target = await getFragment(dataDir, storyId, suggestion.targetFragmentId)
    if (target && target.type === suggestion.type && (target.type === 'character' || target.type === 'knowledge')) {
      return target
    }
  }

  if (suggestion.createdFragmentId) {
    const existing = await getFragment(dataDir, storyId, suggestion.createdFragmentId)
    if (existing) return existing
  }

  // Match by name against ALL fragments of the same type (not just librarian-created ones)
  const candidates = await listFragments(dataDir, storyId)
  const normalizedTargetName = normalizeName(suggestion.name)

  const matching = candidates.filter((fragment) => {
    if (fragment.type !== suggestion.type) return false
    if (normalizeName(fragment.name) !== normalizedTargetName) return false
    return true
  })

  if (matching.length === 0) return null
  return matching[0] ?? null
}

export async function applyKnowledgeSuggestion(args: {
  dataDir: string
  storyId: string
  analysis: LibrarianAnalysis
  suggestionIndex: number
  reason: 'manual-accept' | 'auto-apply'
}): Promise<ApplySuggestionResult> {
  const { dataDir, storyId, analysis, suggestionIndex, reason } = args
  const suggestion = analysis.knowledgeSuggestions[suggestionIndex]
  if (!suggestion) {
    throw new Error('Invalid suggestion index')
  }

  const sourceFragmentId = resolveSourceFragmentId(analysis, suggestion)
  const existing = await findSuggestionFragment(dataDir, storyId, analysis, suggestion)

  if (existing) {
    const versioned = await updateFragmentVersioned(
      dataDir,
      storyId,
      existing.id,
      {
        name: suggestion.name,
        description: suggestion.description.slice(0, 250),
        content: suggestion.content,
      },
      { reason: `librarian-${reason}` },
    )
    if (!versioned) {
      throw new Error(`Fragment not found: ${existing.id}`)
    }

    const refs = sourceFragmentId
      ? Array.from(new Set([...versioned.refs, sourceFragmentId]))
      : versioned.refs

    const finalUpdated: Fragment = {
      ...versioned,
      refs,
      meta: {
        ...versioned.meta,
        source: 'librarian-suggestion',
        analysisId: analysis.id,
        suggestionIndex,
        sourceFragmentId: sourceFragmentId ?? undefined,
        autoApplied: reason === 'auto-apply',
        updatedFromSuggestionAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    }

    await updateFragment(dataDir, storyId, finalUpdated)
    return { fragmentId: finalUpdated.id, created: false, updated: true }
  }

  const id = suggestion.createdFragmentId ?? generateFragmentId(suggestion.type)
  const now = new Date().toISOString()
  const fragment: Fragment = {
    id,
    type: suggestion.type,
    name: suggestion.name,
    description: suggestion.description.slice(0, 250),
    content: suggestion.content,
    tags: [],
    refs: sourceFragmentId ? [sourceFragmentId] : [],
    sticky: registry.getType(suggestion.type)?.stickyByDefault ?? false,
    placement: 'user',
    createdAt: now,
    updatedAt: now,
    archived: false,
    order: 0,
    meta: {
      source: 'librarian-suggestion',
      analysisId: analysis.id,
      suggestionIndex,
      sourceFragmentId: sourceFragmentId ?? undefined,
      autoApplied: reason === 'auto-apply',
    },
    version: 1,
    versions: [],
  }

  await createFragment(dataDir, storyId, fragment)
  return { fragmentId: id, created: true, updated: false }
}
