import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api, type StoryMeta } from '@/lib/api'
import {
  parseErrataExport,
  readFileAsText,
  importFragmentEntry,
  type ErrataExportData,
  type FragmentExportEntry,
  type FragmentClipboardData,
  type FragmentBundleData,
} from '@/lib/fragment-clipboard'
import { SingleFragmentPreview, BundlePreview } from '@/components/fragments/FragmentImportDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2, Sparkles, BookOpen, Users, Scroll, Globe, Upload, ChevronRight, FileJson, AlertCircle, Clipboard } from 'lucide-react'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { ErrataLogo } from '@/components/ErrataLogo'
import { ImportDialog } from '@/components/ImportDialog'
import {
  isTavernCardPng,
  extractParsedCard,
  parseCardJson,
} from '@/lib/importers/tavern-card'

export const Route = createFileRoute('/')({ component: StoryListPage })

function StoryListPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [fileDragOver, setFileDragOver] = useState(false)
  const dragCounter = useRef(0)

  // Options section state
  const [showOptions, setShowOptions] = useState(false)
  const [autoApplyLibrarian, setAutoApplyLibrarian] = useState(false)
  const [parsed, setParsed] = useState<ErrataExportData | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [dragOver, setDragOver] = useState(false)

  const { data: stories, isLoading } = useQuery({
    queryKey: ['stories'],
    queryFn: api.stories.list,
  })

  const sortedStories = useMemo(() => {
    if (!stories) return []

    const withAccess = stories.map((story) => {
      const raw = typeof window !== 'undefined'
        ? localStorage.getItem(`errata:last-accessed:${story.id}`)
        : null
      const lastAccessed = raw ? Date.parse(raw) : Number.NaN
      return {
        story,
        lastAccessed: Number.isFinite(lastAccessed) ? lastAccessed : null,
      }
    })

    return withAccess
      .sort((a, b) => {
        if (a.lastAccessed !== null && b.lastAccessed !== null) {
          return b.lastAccessed - a.lastAccessed
        }
        if (a.lastAccessed !== null) return -1
        if (b.lastAccessed !== null) return 1
        return Date.parse(b.story.updatedAt) - Date.parse(a.story.updatedAt)
      })
      .map((entry) => entry.story)
  }, [stories])

  const isSingleFragment = (data: ErrataExportData) => data._errata === 'fragment'
  const isBundle = (data: ErrataExportData) => data._errata === 'fragment-bundle'

  const handleImportTextChange = useCallback((text: string) => {
    if (!text.trim()) {
      setParsed(null)
      setParseError(null)
      return
    }
    const result = parseErrataExport(text)
    if (result) {
      setParsed(result)
      setParseError(null)
      if (result._errata === 'fragment-bundle') {
        setSelectedIndices(new Set(result.fragments.map((_, i) => i)))
      }
    } else {
      setParsed(null)
      setParseError('Not a valid Errata export. Expected JSON with _errata: "fragment" or "fragment-bundle".')
    }
  }, [])

  const handleImportFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    try {
      const text = await readFileAsText(file)
      handleImportTextChange(text)
    } catch {
      setParseError('Could not read file.')
    }
  }, [handleImportTextChange])

  const handleImportFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await readFileAsText(file)
      handleImportTextChange(text)
    } catch {
      setParseError('Could not read file.')
    }
    e.target.value = ''
  }, [handleImportTextChange])

  const handleImportPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      handleImportTextChange(text)
    } catch {
      setParseError('Could not read clipboard. Try pasting manually with Ctrl+V.')
    }
  }, [handleImportTextChange])

  const toggleBundleItem = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const resetDialog = () => {
    setName('')
    setDescription('')
    setShowOptions(false)
    setAutoApplyLibrarian(false)
    setParsed(null)
    setParseError(null)
    setSelectedIndices(new Set())
    setDragOver(false)
  }

  const createMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      // 1. Create the story
      const newStory = await api.stories.create({ name, description })

      // 2. Update settings if auto-apply is toggled
      if (autoApplyLibrarian) {
        await api.settings.update(newStory.id, { autoApplyLibrarianSuggestions: true })
      }

      // 3. Import fragments if any are selected
      if (parsed) {
        const entries: FragmentExportEntry[] = parsed._errata === 'fragment'
          ? [{ ...(parsed as FragmentClipboardData).fragment, attachments: (parsed as FragmentClipboardData).attachments }]
          : (parsed as FragmentBundleData).fragments.filter((_, i) => selectedIndices.has(i))

        for (const entry of entries) {
          await importFragmentEntry(newStory.id, entry)
        }
      }

      return newStory
    },
    onSuccess: (newStory) => {
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      setOpen(false)
      resetDialog()
      navigate({ to: '/story/$storyId', params: { storyId: newStory.id } })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.stories.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] })
    },
  })

  // Onboarding: show wizard when no providers are configured
  const { data: globalConfig, isLoading: configLoading } = useQuery({
    queryKey: ['global-config'],
    queryFn: api.config.getProviders,
  })
  const [manualWizard, setManualWizard] = useState(false)
  const showOnboarding = manualWizard || (!configLoading && globalConfig && globalConfig.providers.length === 0)

  // Global drag-and-drop for story archives (ZIP) and character card files (JSON + PNG)
  useEffect(() => {
    const hasFiles = (e: DragEvent) => {
      if (!e.dataTransfer) return false
      for (let i = 0; i < e.dataTransfer.types.length; i++) {
        if (e.dataTransfer.types[i] === 'Files') return true
      }
      return false
    }

    const handleDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragCounter.current++
      if (dragCounter.current === 1) setFileDragOver(true)
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragCounter.current--
      if (dragCounter.current === 0) setFileDragOver(false)
    }

    const handleDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
    }

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setFileDragOver(false)

      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      // Try PNG character cards first
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
          try {
            const buffer = await file.arrayBuffer()
            if (isTavernCardPng(buffer)) {
              const parsed = extractParsedCard(buffer)
              if (parsed) {
                // Store image data URL for the dialog
                const bytes = new Uint8Array(buffer)
                let binary = ''
                for (let j = 0; j < bytes.length; j++) {
                  binary += String.fromCharCode(bytes[j])
                }
                const imageDataUrl = `data:image/png;base64,${btoa(binary)}`

                // Create story and navigate
                const newStory = await api.stories.create({
                  name: parsed.card.name,
                  description: parsed.card.description.slice(0, 250) || 'Imported from character card',
                })
                sessionStorage.setItem('errata:pending-card-import', JSON.stringify({
                  type: 'png',
                  imageDataUrl,
                  cardJson: JSON.stringify({
                    data: {
                      name: parsed.card.name,
                      description: parsed.card.description,
                      personality: parsed.card.personality,
                      first_mes: parsed.card.firstMessage,
                      mes_example: parsed.card.messageExamples,
                      scenario: parsed.card.scenario,
                      creator_notes: parsed.card.creatorNotes,
                      system_prompt: parsed.card.systemPrompt,
                      post_history_instructions: parsed.card.postHistoryInstructions,
                      alternate_greetings: parsed.card.alternateGreetings,
                      tags: parsed.card.tags,
                      creator: parsed.card.creator,
                      character_version: parsed.card.characterVersion,
                      character_book: parsed.book ? { name: parsed.book.name, entries: parsed.book.entries.map(e => ({
                        keys: e.keys, secondary_keys: e.secondaryKeys, content: e.content,
                        comment: e.comment, name: e.name, enabled: e.enabled, constant: e.constant,
                        selective: e.selective, insertion_order: e.insertionOrder,
                        position: e.position, priority: e.priority, id: e.id,
                      })) } : undefined,
                    },
                    spec: parsed.card.spec,
                    spec_version: parsed.card.specVersion,
                  }),
                }))
                await queryClient.invalidateQueries({ queryKey: ['stories'] })
                navigate({ to: '/story/$storyId', params: { storyId: newStory.id } })
                return
              }
            }
          } catch {
            // Not a valid tavern card PNG
          }
        }
      }

      // Try JSON character card
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
          try {
            const text = await file.text()
            const parsed = parseCardJson(text)
            if (parsed) {
              const newStory = await api.stories.create({
                name: parsed.card.name,
                description: parsed.card.description.slice(0, 250) || 'Imported from character card',
              })
              sessionStorage.setItem('errata:pending-card-import', JSON.stringify({
                type: 'json',
                cardJson: text,
              }))
              await queryClient.invalidateQueries({ queryKey: ['stories'] })
              navigate({ to: '/story/$storyId', params: { storyId: newStory.id } })
              return
            }
          } catch {
            // Not a valid JSON card
          }
        }
      }

      // Try ZIP story import
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
          try {
            const newStory = await api.stories.importFromZip(file)
            await queryClient.invalidateQueries({ queryKey: ['stories'] })
            navigate({ to: '/story/$storyId', params: { storyId: newStory.id } })
            return
          } catch {
            // Not a valid story archive
          }
        }
      }
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
    }
  }, [navigate, queryClient])

  if (showOnboarding) {
    return (
      <OnboardingWizard
        onComplete={() => {
          setManualWizard(false)
          queryClient.invalidateQueries({ queryKey: ['global-config'] })
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background" data-component-id="stories-page">
      {/* Header */}
      <header className="border-b border-border/50" data-component-id="stories-header">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6">
          <div>
            <h1><ErrataLogo variant="full" size={28} /></h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => setShowImportDialog(true)}
              data-component-id="story-import-button"
            >
              <Upload className="size-3.5" />
              Import
            </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetDialog() }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5" variant={'ghost'} data-component-id="story-create-open">
                <Plus className="size-3.5" />
                New Story
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Create a new story</DialogTitle>
              </DialogHeader>
              <form
                data-component-id="story-create-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  createMutation.mutate({ name, description })
                }}
                className="space-y-4 mt-2 overflow-y-auto min-h-0 flex-1"
              >
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">Title</label>
                  <Input
                    data-component-id="story-create-title-input"
                    placeholder="Untitled Story"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="font-display text-lg"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">Description</label>
                  <Textarea
                    data-component-id="story-create-description-input"
                    placeholder="A brief description of your story..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="resize-none min-h-[80px]"
                    required
                  />
                </div>

                {/* Collapsible Options */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowOptions(!showOptions)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    <ChevronRight className={`size-3 transition-transform ${showOptions ? 'rotate-90' : ''}`} />
                    Options
                  </button>

                  {showOptions && (
                    <div className="mt-3 space-y-4 pl-0.5">
                      {/* Import Fragments */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                          <FileJson className="size-3" />
                          Import Fragments
                        </label>

                        {!parsed && (
                          <>
                            <div className="flex gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1.5"
                                onClick={handleImportPaste}
                              >
                                <Clipboard className="size-3" />
                                Paste from clipboard
                              </Button>
                              <label className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-border/40 text-xs cursor-pointer transition-colors hover:bg-accent/50">
                                <Upload className="size-3" />
                                Load file
                                <input
                                  type="file"
                                  accept=".json,application/json"
                                  className="hidden"
                                  onChange={handleImportFileInput}
                                />
                              </label>
                            </div>

                            <div
                              className="relative"
                              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                              onDragLeave={() => setDragOver(false)}
                              onDrop={handleImportFileDrop}
                            >
                              <Textarea
                                value=""
                                onChange={(e) => handleImportTextChange(e.target.value)}
                                placeholder='Paste JSON or drop a .json file here...'
                                className={`min-h-[80px] resize-none font-mono text-xs bg-transparent transition-colors ${
                                  dragOver ? 'border-primary/50 bg-primary/5' : ''
                                }`}
                              />
                              {dragOver && (
                                <div className="absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-primary/40 bg-primary/5 pointer-events-none">
                                  <div className="text-center">
                                    <Upload className="size-5 text-primary/50 mx-auto mb-1" />
                                    <p className="text-xs text-primary/60">Drop file here</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {parseError && (
                          <div className="flex items-start gap-2 text-xs text-destructive/80 bg-destructive/5 rounded-md px-3 py-2">
                            <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                            <span>{parseError}</span>
                          </div>
                        )}

                        {parsed && isSingleFragment(parsed) && (
                          <SingleFragmentPreview data={parsed as FragmentClipboardData} onClear={() => { setParsed(null); setParseError(null) }} />
                        )}

                        {parsed && isBundle(parsed) && (
                          <BundlePreview
                            data={parsed as FragmentBundleData}
                            selectedIndices={selectedIndices}
                            onToggle={toggleBundleItem}
                            onSelectAll={() => setSelectedIndices(new Set((parsed as FragmentBundleData).fragments.map((_, i) => i)))}
                            onDeselectAll={() => setSelectedIndices(new Set())}
                            onClear={() => { setParsed(null); setParseError(null); setSelectedIndices(new Set()) }}
                          />
                        )}
                      </div>

                      {/* Librarian Settings */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Librarian</label>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground/70">Auto-apply suggestions</span>
                          <button
                            type="button"
                            onClick={() => setAutoApplyLibrarian(!autoApplyLibrarian)}
                            className={`relative shrink-0 h-[14px] w-[26px] rounded-full transition-colors ${
                              autoApplyLibrarian ? 'bg-foreground' : 'bg-muted-foreground/20'
                            }`}
                            aria-label="Toggle auto-apply librarian suggestions"
                          >
                            <span
                              className={`absolute top-[2px] h-[10px] w-[10px] rounded-full bg-background transition-[left] duration-150 ${
                                autoApplyLibrarian ? 'left-[14px]' : 'left-[2px]'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={createMutation.isPending} data-component-id="story-create-submit">
                    {createMutation.isPending ? 'Creating...' : 'Create'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        {isLoading && (
          <p className="text-muted-foreground text-sm">Loading stories...</p>
        )}

        {stories && stories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="font-display text-2xl italic text-muted-foreground/60 mb-2">
              Begin something new.
            </p>
            <p className="text-sm text-muted-foreground mb-8 max-w-xs">
              Every great story starts with a blank page. Create your first story to get started.
            </p>
            <Button onClick={() => setOpen(true)} className="gap-1.5">
              <Plus className="size-3.5" />
              Create your first story
            </Button>
          </div>
        )}

        <div className="space-y-2" data-component-id="story-list">
          {sortedStories.map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              onDelete={() => {
                if (confirm(`Delete "${story.name}"?`)) {
                  deleteMutation.mutate(story.id)
                }
              }}
            />
          ))}
        </div>
      </main>

      {/* Global file drag-drop overlay */}
      {fileDragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 px-16 py-12">
            <Upload className="size-8 text-primary/50" />
            <p className="text-sm font-medium text-primary/70">Drop to import</p>
            <p className="text-xs text-muted-foreground/50">Story archive (.zip), character card (.json / .png)</p>
          </div>
        </div>
      )}

      <ImportDialog open={showImportDialog} onOpenChange={setShowImportDialog} />

      {/* Re-run onboarding */}
      <button
        data-component-id="onboarding-launch-button"
        onClick={() => setManualWizard(true)}
        className="fixed bottom-4 left-4 sm:bottom-4 sm:left-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors safe-area-bottom"
      >
        <Sparkles className="size-3" />
        Setup wizard
      </button>
    </div>
  )
}

// ── Story Card ──────────────────────────────────────────

function StoryCard({ story, onDelete }: { story: StoryMeta; onDelete: () => void }) {
  const { data: fragments } = useQuery({
    queryKey: ['fragments', story.id],
    queryFn: () => api.fragments.list(story.id),
    staleTime: 30_000,
  })

  const { data: proseChain } = useQuery({
    queryKey: ['proseChain', story.id],
    queryFn: () => api.proseChain.get(story.id),
    staleTime: 30_000,
  })

  // Compute stats from fragments
  const stats = fragments ? {
    prose: proseChain?.entries.length ?? 0,
    characters: fragments.filter(f => f.type === 'character').length,
    knowledge: fragments.filter(f => f.type === 'knowledge').length,
    guidelines: fragments.filter(f => f.type === 'guideline').length,
  } : null

  const hasStats = stats && (stats.prose + stats.characters + stats.knowledge + stats.guidelines) > 0

  return (
    <Link
      to="/story/$storyId"
      params={{ storyId: story.id }}
      className="group block"
      onClick={() => {
        localStorage.setItem(`errata:last-accessed:${story.id}`, new Date().toISOString())
      }}
    >
      <div
        className="flex items-start justify-between rounded-lg border border-transparent hover:border-border/50 hover:bg-card/50 px-5 py-4 transition-all duration-150"
        data-component-id={`story-${story.id}-card`}
      >
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg leading-tight group-hover:text-primary transition-colors">
            {story.name}
          </h2>
          {story.description && (
            <p className="text-sm text-muted-foreground/70 mt-1 line-clamp-2 font-prose">
              {story.description}
            </p>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-4 mt-2.5">
            {hasStats ? (
              <>
                {stats.prose > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground/45" title={`${stats.prose} passage${stats.prose !== 1 ? 's' : ''}`}>
                    <BookOpen className="size-3" />
                    {stats.prose}
                  </span>
                )}
                {stats.characters > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground/45" title={`${stats.characters} character${stats.characters !== 1 ? 's' : ''}`}>
                    <Users className="size-3" />
                    {stats.characters}
                  </span>
                )}
                {stats.knowledge > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground/45" title={`${stats.knowledge} knowledge`}>
                    <Globe className="size-3" />
                    {stats.knowledge}
                  </span>
                )}
                {stats.guidelines > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground/45" title={`${stats.guidelines} guideline${stats.guidelines !== 1 ? 's' : ''}`}>
                    <Scroll className="size-3" />
                    {stats.guidelines}
                  </span>
                )}
                <span className="text-muted-foreground/20">·</span>
              </>
            ) : null}
            <span className="text-[11px] text-muted-foreground/35">
              {new Date(story.updatedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
        </div>
        <Button
          data-component-id={`story-${story.id}-delete-button`}
          variant="ghost"
          size="icon"
          className="size-8 sm:opacity-0 sm:group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0 ml-4"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </Link>
  )
}
