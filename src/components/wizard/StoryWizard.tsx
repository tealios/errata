import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

interface StoryWizardProps {
  storyId: string
  onComplete: () => void
}

const STEPS = [
  { key: 'guidelines', label: 'Guidelines', type: 'guideline', description: 'Set the tone, style, and rules for your story.' },
  { key: 'characters', label: 'Characters', type: 'character', description: 'Define the main characters in your story.' },
  { key: 'knowledge', label: 'Knowledge', type: 'knowledge', description: 'Add world-building details, settings, and lore.' },
  { key: 'prose', label: 'First Prose', type: 'prose', description: 'Write or paste the opening of your story.' },
] as const

export function StoryWizard({ storyId, onComplete }: StoryWizardProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [entries, setEntries] = useState<Array<{ name: string; description: string; content: string }>>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')

  const current = STEPS[step]

  const createMutation = useMutation({
    mutationFn: (data: { type: string; name: string; description: string; content: string }) =>
      api.fragments.create(storyId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      await queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    },
  })

  const handleAdd = async () => {
    if (!name.trim() || !content.trim()) return
    await createMutation.mutateAsync({
      type: current.type,
      name: name.trim(),
      description: description.trim() || name.trim().slice(0, 50),
      content: content.trim(),
    })
    setEntries([...entries, { name, description, content }])
    setName('')
    setDescription('')
    setContent('')
  }

  const handleNext = () => {
    setEntries([])
    setName('')
    setDescription('')
    setContent('')
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      onComplete()
    }
  }

  const handleSkip = () => {
    handleNext()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with step indicator */}
      <div className="px-6 py-5 border-b border-border/50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl italic">Story Setup</h2>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground/50" onClick={onComplete}>
            Skip wizard
          </Button>
        </div>
        <div className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i === step ? 'bg-primary' : i < step ? 'bg-primary/40' : 'bg-border/50'
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground/50 mt-2">
          Step {step + 1} of {STEPS.length}
        </p>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="max-w-lg mx-auto space-y-6">
          <div>
            <h3 className="font-display text-lg">{current.label}</h3>
            <p className="text-sm text-muted-foreground/70 mt-1">{current.description}</p>
          </div>

          {/* Previously added entries for this step */}
          {entries.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Added:</span>
              {entries.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-sm bg-card/50 rounded-md px-3 py-2">
                  <Badge variant="outline" className="text-[10px] shrink-0">{current.type}</Badge>
                  <span className="font-medium truncate">{entry.name}</span>
                </div>
              ))}
              <div className="h-px bg-border/30 mt-3" />
            </div>
          )}

          {/* Add form */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-transparent"
                placeholder={
                  current.type === 'guideline' ? 'e.g. Writing Style' :
                  current.type === 'character' ? 'e.g. Alice' :
                  current.type === 'knowledge' ? 'e.g. The Kingdom of Eldor' :
                  'e.g. Chapter 1 - Opening'
                }
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
                Description <span className="normal-case tracking-normal text-muted-foreground/50">(max 50 chars)</span>
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={50}
                className="bg-transparent"
                placeholder="Brief description for context lists"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">Content</label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[150px] font-mono text-sm bg-transparent"
                placeholder={
                  current.type === 'guideline' ? 'Write in a dark, atmospheric tone...' :
                  current.type === 'character' ? 'Alice is a 28-year-old detective who...' :
                  current.type === 'knowledge' ? 'The Kingdom of Eldor is located in the northern...' :
                  'The rain fell in sheets against the windowpane...'
                }
              />
            </div>
            <Button
              onClick={handleAdd}
              size="sm"
              disabled={!name.trim() || !content.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Adding...' : `Add ${current.label.replace(/s$/, '')}`}
            </Button>
          </div>
        </div>
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border/50">
        <div className="text-xs text-muted-foreground/40">
          {current.label}
        </div>
        <div className="flex gap-1.5">
          {step > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                setEntries([])
                setName('')
                setDescription('')
                setContent('')
                setStep(step - 1)
              }}
            >
              Back
            </Button>
          )}
          <Button variant="outline" size="sm" className="text-xs" onClick={handleSkip}>
            {entries.length > 0 ? 'Next' : 'Skip'}
          </Button>
          {step === STEPS.length - 1 && entries.length > 0 && (
            <Button size="sm" className="text-xs" onClick={onComplete}>
              Finish
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
