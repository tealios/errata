import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
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
import { Plus, Trash2, Sparkles } from 'lucide-react'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'

export const Route = createFileRoute('/')({ component: StoryListPage })

function StoryListPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { data: stories, isLoading } = useQuery({
    queryKey: ['stories'],
    queryFn: api.stories.list,
  })

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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-8 py-6">
          <div>
            <h1 className="font-display text-3xl italic tracking-tight">Errata</h1>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5" variant={'ghost'}>
                <Plus className="size-3.5" />
                New Story
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Create a new story</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  createMutation.mutate({ name, description })
                }}
                className="space-y-4 mt-2"
              >
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">Title</label>
                  <Input
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
                    placeholder="A brief description of your story..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="resize-none min-h-[80px]"
                    required
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Creating...' : 'Create'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
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

        <div className="space-y-2">
          {stories?.map((story) => (
            <Link
              key={story.id}
              to="/story/$storyId"
              params={{ storyId: story.id }}
              className="group block"
            >
              <div className="flex items-start justify-between rounded-lg border border-transparent hover:border-border/50 hover:bg-card/50 px-5 py-4 transition-all duration-150">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg leading-tight group-hover:text-primary transition-colors">
                    {story.name}
                  </h2>
                  {story.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {story.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground/60 mt-2">
                    {new Date(story.updatedAt).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0 ml-4"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (confirm(`Delete "${story.name}"?`)) {
                      deleteMutation.mutate(story.id)
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Link>
          ))}
        </div>
      </main>

      {/* Re-run onboarding */}
      <button
        onClick={() => setManualWizard(true)}
        className="fixed bottom-4 left-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
      >
        <Sparkles className="size-3" />
        Setup wizard
      </button>
    </div>
  )
}
