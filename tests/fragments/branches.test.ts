import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createTempDir } from '../setup'
import {
  getBranchesIndex,
  getContentRoot,
  getContentRootForBranch,
  switchActiveBranch,
  createBranch,
  deleteBranch,
  renameBranch,
  migrateIfNeeded,
  clearMigrationCache,
  withBranch,
} from '../../src/server/fragments/branches'
import { createStory, createFragment, getFragment, listFragments } from '../../src/server/fragments/storage'
import { getProseChain, addProseSection } from '../../src/server/fragments/prose-chain'
import { saveState, getState, saveAnalysis, getAnalysis, saveChatHistory, getChatHistory } from '../../src/server/librarian/storage'
import type { LibrarianAnalysis, LibrarianState } from '../../src/server/librarian/storage'
import type { StoryMeta, Fragment } from '../../src/server/fragments/schema'

let dataDir: string
let cleanup: () => Promise<void>

const TEST_STORY_ID = 'test-story'

function makeStory(id: string = TEST_STORY_ID): StoryMeta {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Test Story',
    description: 'A test story',
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: {
      outputFormat: 'markdown',
      enabledPlugins: [],
      summarizationThreshold: 4,
      maxSteps: 10,
      providerId: null,
      modelId: null,
      librarianProviderId: null,
      librarianModelId: null,
      autoApplyLibrarianSuggestions: false,
      contextOrderMode: 'simple',
      fragmentOrder: [],
      enabledBuiltinTools: [],
      contextCompact: { type: 'proseLimit', value: 10 },
      summaryCompact: { maxCharacters: 12000, targetCharacters: 9000 },
      enableHierarchicalSummary: false,
      characterChatProviderId: null,
      characterChatModelId: null,
    },
  }
}

function makeFragment(id: string, content: string = 'test content'): Fragment {
  const now = new Date().toISOString()
  return {
    id,
    type: 'prose',
    name: `Fragment ${id}`,
    description: 'A test fragment',
    content,
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user',
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    archived: false,
    version: 1,
    versions: [],
  }
}

beforeEach(async () => {
  clearMigrationCache()
  const temp = await createTempDir()
  dataDir = temp.path
  cleanup = temp.cleanup
})

afterEach(async () => {
  clearMigrationCache()
  await cleanup()
})

describe('branches', () => {
  describe('migration', () => {
    it('migrates legacy story with root-level content to branches/main/', async () => {
      // Create legacy story layout
      const storyDir = join(dataDir, 'stories', TEST_STORY_ID)
      await mkdir(join(storyDir, 'fragments'), { recursive: true })
      await writeFile(join(storyDir, 'meta.json'), JSON.stringify(makeStory()))
      await writeFile(join(storyDir, 'prose-chain.json'), JSON.stringify({ entries: [] }))
      await writeFile(join(storyDir, 'associations.json'), JSON.stringify({ tagIndex: {}, refIndex: {} }))
      await writeFile(join(storyDir, 'fragments', 'pr-test01.json'), JSON.stringify(makeFragment('pr-test01')))

      // Trigger migration
      await migrateIfNeeded(storyDir)

      // Verify: content moved to branches/main/
      expect(existsSync(join(storyDir, 'branches', 'main', 'prose-chain.json'))).toBe(true)
      expect(existsSync(join(storyDir, 'branches', 'main', 'fragments', 'pr-test01.json'))).toBe(true)
      expect(existsSync(join(storyDir, 'branches', 'main', 'associations.json'))).toBe(true)

      // Verify: root-level content removed
      expect(existsSync(join(storyDir, 'prose-chain.json'))).toBe(false)
      expect(existsSync(join(storyDir, 'fragments'))).toBe(false)
      expect(existsSync(join(storyDir, 'associations.json'))).toBe(false)

      // Verify: branches.json created
      expect(existsSync(join(storyDir, 'branches.json'))).toBe(true)
      const index = JSON.parse(await readFile(join(storyDir, 'branches.json'), 'utf-8'))
      expect(index.activeBranchId).toBe('main')
      expect(index.branches).toHaveLength(1)
      expect(index.branches[0].id).toBe('main')
    })

    it('handles already-migrated story (no-op)', async () => {
      const storyDir = join(dataDir, 'stories', TEST_STORY_ID)
      await mkdir(join(storyDir, 'branches', 'main', 'fragments'), { recursive: true })
      await writeFile(join(storyDir, 'meta.json'), JSON.stringify(makeStory()))
      await writeFile(join(storyDir, 'branches.json'), JSON.stringify({
        branches: [{ id: 'main', name: 'Main', order: 0, createdAt: new Date().toISOString() }],
        activeBranchId: 'main',
      }))

      // Should not throw
      await migrateIfNeeded(storyDir)

      // Still valid
      expect(existsSync(join(storyDir, 'branches', 'main'))).toBe(true)
    })

    it('handles new story with no content', async () => {
      const storyDir = join(dataDir, 'stories', TEST_STORY_ID)
      await mkdir(storyDir, { recursive: true })
      await writeFile(join(storyDir, 'meta.json'), JSON.stringify(makeStory()))

      await migrateIfNeeded(storyDir)

      expect(existsSync(join(storyDir, 'branches', 'main'))).toBe(true)
      expect(existsSync(join(storyDir, 'branches.json'))).toBe(true)
    })
  })

  describe('content root resolution', () => {
    it('resolves to active branch directory', async () => {
      await createStory(dataDir, makeStory())

      const root = await getContentRoot(dataDir, TEST_STORY_ID)
      expect(root).toContain(join('branches', 'main'))
    })

    it('resolves to specific branch directory', async () => {
      await createStory(dataDir, makeStory())

      const root = await getContentRootForBranch(dataDir, TEST_STORY_ID, 'main')
      expect(root).toContain(join('branches', 'main'))
    })
  })

  describe('new story creation', () => {
    it('creates branches/main/ structure from the start', async () => {
      await createStory(dataDir, makeStory())

      const storyDir = join(dataDir, 'stories', TEST_STORY_ID)
      expect(existsSync(join(storyDir, 'branches', 'main', 'fragments'))).toBe(true)
      expect(existsSync(join(storyDir, 'branches.json'))).toBe(true)
    })

    it('fragment operations work on the active branch', async () => {
      await createStory(dataDir, makeStory())

      // Create a fragment
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-bakite'))

      // It should be in branches/main/fragments/
      const storyDir = join(dataDir, 'stories', TEST_STORY_ID)
      expect(existsSync(join(storyDir, 'branches', 'main', 'fragments', 'pr-bakite.json'))).toBe(true)

      // Get and list should work
      const fragment = await getFragment(dataDir, TEST_STORY_ID, 'pr-bakite')
      expect(fragment).not.toBeNull()
      expect(fragment!.id).toBe('pr-bakite')

      const fragments = await listFragments(dataDir, TEST_STORY_ID)
      expect(fragments).toHaveLength(1)
    })

    it('prose chain operations work on the active branch', async () => {
      await createStory(dataDir, makeStory())
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-bakite'))

      await addProseSection(dataDir, TEST_STORY_ID, 'pr-bakite')

      const chain = await getProseChain(dataDir, TEST_STORY_ID)
      expect(chain).not.toBeNull()
      expect(chain!.entries).toHaveLength(1)
      expect(chain!.entries[0].active).toBe('pr-bakite')
    })
  })

  describe('branch CRUD', () => {
    it('lists branches', async () => {
      await createStory(dataDir, makeStory())

      const index = await getBranchesIndex(dataDir, TEST_STORY_ID)
      expect(index.branches).toHaveLength(1)
      expect(index.branches[0].id).toBe('main')
      expect(index.activeBranchId).toBe('main')
    })

    it('creates a branch by copying parent content', async () => {
      await createStory(dataDir, makeStory())

      // Set up some content in main
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-bakite', 'Hello world'))
      await addProseSection(dataDir, TEST_STORY_ID, 'pr-bakite')

      // Create branch
      const branch = await createBranch(dataDir, TEST_STORY_ID, 'Alt Timeline', 'main')

      expect(branch.id).toMatch(/^br-/)
      expect(branch.name).toBe('Alt Timeline')
      expect(branch.parentBranchId).toBe('main')

      // New branch should be active
      const index = await getBranchesIndex(dataDir, TEST_STORY_ID)
      expect(index.activeBranchId).toBe(branch.id)
      expect(index.branches).toHaveLength(2)

      // Content should be copied
      const fragment = await getFragment(dataDir, TEST_STORY_ID, 'pr-bakite')
      expect(fragment).not.toBeNull()
      expect(fragment!.content).toBe('Hello world')

      const chain = await getProseChain(dataDir, TEST_STORY_ID)
      expect(chain).not.toBeNull()
      expect(chain!.entries).toHaveLength(1)
    })

    it('creates a branch with prose chain truncation', async () => {
      await createStory(dataDir, makeStory())

      // Set up 3 prose sections
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-aaaaaa', 'Section 1'))
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-bbbbbb', 'Section 2'))
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-cccccc', 'Section 3'))
      await addProseSection(dataDir, TEST_STORY_ID, 'pr-aaaaaa')
      await addProseSection(dataDir, TEST_STORY_ID, 'pr-bbbbbb')
      await addProseSection(dataDir, TEST_STORY_ID, 'pr-cccccc')

      // Fork after index 1 (keep sections 0 and 1)
      await createBranch(dataDir, TEST_STORY_ID, 'Fork', 'main', 1)

      // Verify new branch's prose chain is truncated
      const chain = await getProseChain(dataDir, TEST_STORY_ID)
      expect(chain!.entries).toHaveLength(2)
      expect(chain!.entries[0].active).toBe('pr-aaaaaa')
      expect(chain!.entries[1].active).toBe('pr-bbbbbb')

      // Switch back to main and verify it's intact
      await switchActiveBranch(dataDir, TEST_STORY_ID, 'main')
      const mainChain = await getProseChain(dataDir, TEST_STORY_ID)
      expect(mainChain!.entries).toHaveLength(3)
    })

    it('switches active branch', async () => {
      await createStory(dataDir, makeStory())
      const branch = await createBranch(dataDir, TEST_STORY_ID, 'Alt', 'main')

      // Should already be on the new branch
      let index = await getBranchesIndex(dataDir, TEST_STORY_ID)
      expect(index.activeBranchId).toBe(branch.id)

      // Switch to main
      await switchActiveBranch(dataDir, TEST_STORY_ID, 'main')
      index = await getBranchesIndex(dataDir, TEST_STORY_ID)
      expect(index.activeBranchId).toBe('main')
    })

    it('renames a branch', async () => {
      await createStory(dataDir, makeStory())
      const branch = await createBranch(dataDir, TEST_STORY_ID, 'Old Name', 'main')

      const renamed = await renameBranch(dataDir, TEST_STORY_ID, branch.id, 'New Name')
      expect(renamed.name).toBe('New Name')

      const index = await getBranchesIndex(dataDir, TEST_STORY_ID)
      const found = index.branches.find(b => b.id === branch.id)
      expect(found!.name).toBe('New Name')
    })

    it('deletes a branch', async () => {
      await createStory(dataDir, makeStory())
      const branch = await createBranch(dataDir, TEST_STORY_ID, 'To Delete', 'main')

      await deleteBranch(dataDir, TEST_STORY_ID, branch.id)

      const index = await getBranchesIndex(dataDir, TEST_STORY_ID)
      expect(index.branches).toHaveLength(1)
      expect(index.activeBranchId).toBe('main')
    })

    it('cannot delete main branch', async () => {
      await createStory(dataDir, makeStory())

      await expect(deleteBranch(dataDir, TEST_STORY_ID, 'main'))
        .rejects.toThrow("Cannot delete the 'main' branch")
    })

    it('switches to main when deleting active branch', async () => {
      await createStory(dataDir, makeStory())
      const branch = await createBranch(dataDir, TEST_STORY_ID, 'Active', 'main')

      // Branch is already active
      let index = await getBranchesIndex(dataDir, TEST_STORY_ID)
      expect(index.activeBranchId).toBe(branch.id)

      await deleteBranch(dataDir, TEST_STORY_ID, branch.id)

      index = await getBranchesIndex(dataDir, TEST_STORY_ID)
      expect(index.activeBranchId).toBe('main')
    })
  })

  describe('branch isolation', () => {
    it('edits in one branch do not affect another', async () => {
      await createStory(dataDir, makeStory())

      // Create content in main
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-bakite', 'Original'))
      await addProseSection(dataDir, TEST_STORY_ID, 'pr-bakite')

      // Branch from main
      await createBranch(dataDir, TEST_STORY_ID, 'Alt', 'main')

      // Modify fragment in the branch
      const fragment = await getFragment(dataDir, TEST_STORY_ID, 'pr-bakite')
      fragment!.content = 'Modified in branch'
      const { updateFragment } = await import('../../src/server/fragments/storage')
      await updateFragment(dataDir, TEST_STORY_ID, fragment!)

      // Verify branch has modified content
      const branchFragment = await getFragment(dataDir, TEST_STORY_ID, 'pr-bakite')
      expect(branchFragment!.content).toBe('Modified in branch')

      // Switch to main — content should be original
      await switchActiveBranch(dataDir, TEST_STORY_ID, 'main')
      const mainFragment = await getFragment(dataDir, TEST_STORY_ID, 'pr-bakite')
      expect(mainFragment!.content).toBe('Original')
    })

    it('can branch from a branch (unlimited nesting)', async () => {
      await createStory(dataDir, makeStory())
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-bakite'))
      await addProseSection(dataDir, TEST_STORY_ID, 'pr-bakite')

      // Create first-level branch
      const branch1 = await createBranch(dataDir, TEST_STORY_ID, 'Level 1', 'main')

      // Create second-level branch from the first
      const branch2 = await createBranch(dataDir, TEST_STORY_ID, 'Level 2', branch1.id)

      expect(branch2.parentBranchId).toBe(branch1.id)

      const index = await getBranchesIndex(dataDir, TEST_STORY_ID)
      expect(index.branches).toHaveLength(3)
    })

    it('copies librarian state and analyses when branching', async () => {
      await createStory(dataDir, makeStory())
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-bakite', 'Hello'))
      await addProseSection(dataDir, TEST_STORY_ID, 'pr-bakite')

      // Save librarian state on main
      const state: LibrarianState = {
        lastAnalyzedFragmentId: 'pr-bakite',
        summarizedUpTo: 'pr-bakite',
        recentMentions: { 'ch-alice': ['pr-bakite'] },
        timeline: [{ event: 'Alice arrives', fragmentId: 'pr-bakite' }],
      }
      await saveState(dataDir, TEST_STORY_ID, state)

      // Save a librarian analysis on main
      const analysis: LibrarianAnalysis = {
        id: 'analysis-001',
        createdAt: new Date().toISOString(),
        fragmentId: 'pr-bakite',
        summaryUpdate: 'Alice arrived at the castle.',
        mentionedCharacters: ['ch-alice'],
        contradictions: [],
        knowledgeSuggestions: [],
        timelineEvents: [{ event: 'Alice arrives', position: 'during' }],
      }
      await saveAnalysis(dataDir, TEST_STORY_ID, analysis)

      // Save chat history on main
      await saveChatHistory(dataDir, TEST_STORY_ID, [
        { role: 'user', content: 'Who is Alice?' },
        { role: 'assistant', content: 'Alice is the protagonist.' },
      ])

      // Create a branch — should copy all librarian data
      await createBranch(dataDir, TEST_STORY_ID, 'Alt Timeline', 'main')

      // Verify: new branch has librarian state
      const branchState = await getState(dataDir, TEST_STORY_ID)
      expect(branchState.lastAnalyzedFragmentId).toBe('pr-bakite')
      expect(branchState.timeline).toHaveLength(1)
      expect(branchState.recentMentions['ch-alice']).toEqual(['pr-bakite'])

      // Verify: new branch has the analysis
      const branchAnalysis = await getAnalysis(dataDir, TEST_STORY_ID, 'analysis-001')
      expect(branchAnalysis).not.toBeNull()
      expect(branchAnalysis!.summaryUpdate).toBe('Alice arrived at the castle.')

      // Verify: new branch has chat history
      const branchChat = await getChatHistory(dataDir, TEST_STORY_ID)
      expect(branchChat.messages).toHaveLength(2)
      expect(branchChat.messages[0].content).toBe('Who is Alice?')

      // Verify: main branch librarian data is still intact
      await switchActiveBranch(dataDir, TEST_STORY_ID, 'main')
      const mainState = await getState(dataDir, TEST_STORY_ID)
      expect(mainState.lastAnalyzedFragmentId).toBe('pr-bakite')

      const mainAnalysis = await getAnalysis(dataDir, TEST_STORY_ID, 'analysis-001')
      expect(mainAnalysis).not.toBeNull()

      const mainChat = await getChatHistory(dataDir, TEST_STORY_ID)
      expect(mainChat.messages).toHaveLength(2)
    })

    it('withBranch pins getContentRoot to captured branch', async () => {
      await createStory(dataDir, makeStory())

      // Create content in main
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-bakite', 'Main content'))
      await addProseSection(dataDir, TEST_STORY_ID, 'pr-bakite')

      // Create a second branch
      const branch = await createBranch(dataDir, TEST_STORY_ID, 'Alt', 'main')

      // Switch back to main so that's the active branch
      await switchActiveBranch(dataDir, TEST_STORY_ID, 'main')

      // Run a withBranch pinned to main, switch to alt mid-operation
      await withBranch(dataDir, TEST_STORY_ID, async () => {
        // getContentRoot should resolve to main
        const root1 = await getContentRoot(dataDir, TEST_STORY_ID)
        expect(root1).toContain(join('branches', 'main'))

        // Switch active branch to alt DURING the operation
        await switchActiveBranch(dataDir, TEST_STORY_ID, branch.id)

        // getContentRoot should STILL resolve to main (pinned)
        const root2 = await getContentRoot(dataDir, TEST_STORY_ID)
        expect(root2).toContain(join('branches', 'main'))
      })

      // Outside withBranch, getContentRoot should follow the (now switched) active branch
      const rootAfter = await getContentRoot(dataDir, TEST_STORY_ID)
      expect(rootAfter).toContain(join('branches', branch.id))
    })

    it('nested withBranch inherits outer scope', async () => {
      await createStory(dataDir, makeStory())
      const branch = await createBranch(dataDir, TEST_STORY_ID, 'Alt', 'main')

      // Switch back to main
      await switchActiveBranch(dataDir, TEST_STORY_ID, 'main')

      await withBranch(dataDir, TEST_STORY_ID, async () => {
        // Outer scope pinned to main
        const root1 = await getContentRoot(dataDir, TEST_STORY_ID)
        expect(root1).toContain(join('branches', 'main'))

        // Switch active branch mid-operation
        await switchActiveBranch(dataDir, TEST_STORY_ID, branch.id)

        // Nested withBranch should inherit the outer scope (main), not re-resolve
        await withBranch(dataDir, TEST_STORY_ID, async () => {
          const root2 = await getContentRoot(dataDir, TEST_STORY_ID)
          expect(root2).toContain(join('branches', 'main'))
        })
      })
    })

    it('withBranch with explicit branchId uses provided ID', async () => {
      await createStory(dataDir, makeStory())
      await createBranch(dataDir, TEST_STORY_ID, 'Alt', 'main')

      // Active branch is alt (createBranch switches to it), but we pin to main explicitly
      await withBranch(dataDir, TEST_STORY_ID, async () => {
        const root = await getContentRoot(dataDir, TEST_STORY_ID)
        expect(root).toContain(join('branches', 'main'))
      }, 'main')
    })

    it('librarian data is isolated between branches', async () => {
      await createStory(dataDir, makeStory())
      await createFragment(dataDir, TEST_STORY_ID, makeFragment('pr-bakite', 'Hello'))
      await addProseSection(dataDir, TEST_STORY_ID, 'pr-bakite')

      // Save initial librarian state on main
      await saveState(dataDir, TEST_STORY_ID, {
        lastAnalyzedFragmentId: 'pr-bakite',
        summarizedUpTo: null,
        recentMentions: {},
        timeline: [{ event: 'Start', fragmentId: 'pr-bakite' }],
      })

      // Branch from main
      await createBranch(dataDir, TEST_STORY_ID, 'Alt', 'main')

      // Modify librarian state in the branch
      await saveState(dataDir, TEST_STORY_ID, {
        lastAnalyzedFragmentId: 'pr-bakite',
        summarizedUpTo: 'pr-bakite',
        recentMentions: { 'ch-bob': ['pr-bakite'] },
        timeline: [
          { event: 'Start', fragmentId: 'pr-bakite' },
          { event: 'Bob appears', fragmentId: 'pr-bakite' },
        ],
      })

      // Verify branch has modified state
      const branchState = await getState(dataDir, TEST_STORY_ID)
      expect(branchState.timeline).toHaveLength(2)
      expect(branchState.recentMentions['ch-bob']).toEqual(['pr-bakite'])

      // Switch to main — librarian state should be original
      await switchActiveBranch(dataDir, TEST_STORY_ID, 'main')
      const mainState = await getState(dataDir, TEST_STORY_ID)
      expect(mainState.timeline).toHaveLength(1)
      expect(mainState.recentMentions['ch-bob']).toBeUndefined()
    })
  })
})
