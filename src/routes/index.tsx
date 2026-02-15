import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api, type StoryMeta } from '@/lib/api'
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
import { Plus, Trash2, Sparkles, BookOpen, Users, Scroll, Globe, Upload } from 'lucide-react'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { ErrataLogo } from '@/components/ErrataLogo'

export const Route = createFileRoute('/')({ component: StoryListPage })

function StoryListPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

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

  const createMutation = useMutation({
    mutationFn: api.stories.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      setOpen(false)
      setName('')
      setDescription('')
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
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('errata-onboarding-dismissed') === 'true'
  )
  const [manualWizard, setManualWizard] = useState(false)
  const showOnboarding = manualWizard || (!configLoading && globalConfig && globalConfig.providers.length === 0 && !onboardingDismissed)

  const handleImportStory = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const newStory = await api.stories.importFromZip(file)
      await queryClient.invalidateQueries({ queryKey: ['stories'] })
      navigate({ to: '/story/$storyId', params: { storyId: newStory.id } })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      // Reset input so same file can be re-selected
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  if (showOnboarding) {
    return (
      <OnboardingWizard
        onComplete={() => {
          setOnboardingDismissed(true)
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
        <div className="max-w-4xl mx-auto flex items-center justify-between px-8 py-6">
          <div>
            <h1><ErrataLogo variant="full" size={28} /></h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              disabled={importing}
              onClick={() => importInputRef.current?.click()}
              data-component-id="story-import-button"
            >
              <Upload className="size-3.5" />
              {importing ? 'Importing...' : 'Import Story'}
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleImportStory}
            />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5" variant={'ghost'} data-component-id="story-create-open">
                <Plus className="size-3.5" />
                New Story
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Create a new story</DialogTitle>
              </DialogHeader>
              <form
                data-component-id="story-create-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  createMutation.mutate({ name, description })
                }}
                className="space-y-4 mt-2"
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
      <main className="max-w-4xl mx-auto px-8 py-10">
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

      {/* Re-run onboarding */}
      <button
        data-component-id="onboarding-launch-button"
        onClick={() => setManualWizard(true)}
        className="fixed bottom-4 left-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
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
          className="size-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0 ml-4"
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
