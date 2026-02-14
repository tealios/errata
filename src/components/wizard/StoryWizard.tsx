import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
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
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Story Setup</h2>
          <Button variant="ghost" size="sm" onClick={onComplete}>
            Skip wizard
          </Button>
        </div>
        <div className="flex gap-2">
          {STEPS.map((s, i) => (
            <Badge
              key={s.key}
              variant={i === step ? 'default' : i < step ? 'secondary' : 'outline'}
              className="text-xs"
            >
              {i + 1}. {s.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-lg mx-auto space-y-6">
          <div>
            <h3 className="text-base font-semibold">{current.label}</h3>
            <p className="text-sm text-muted-foreground mt-1">{current.description}</p>
          </div>

          {/* Previously added entries for this step */}
          {entries.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-medium">Added:</span>
              {entries.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-sm bg-muted rounded-md px-3 py-2">
                  <Badge variant="outline" className="text-[10px] shrink-0">{current.type}</Badge>
                  <span className="font-medium">{entry.name}</span>
                  <span className="text-muted-foreground truncate">{entry.description}</span>
                </div>
              ))}
              <Separator />
            </div>
          )}

          {/* Add form */}
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  current.type === 'guideline' ? 'e.g. Writing Style' :
                  current.type === 'character' ? 'e.g. Alice' :
                  current.type === 'knowledge' ? 'e.g. The Kingdom of Eldor' :
                  'e.g. Chapter 1 - Opening'
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Description <span className="text-muted-foreground">(max 50 chars)</span>
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={50}
                placeholder="Brief description for context lists"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Content</label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[150px] font-mono text-sm"
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
              disabled={!name.trim() || !content.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Adding...' : `Add ${current.label.replace(/s$/, '')}`}
            </Button>
          </div>
        </div>
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between p-4 border-t">
        <div className="text-sm text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </div>
        <div className="flex gap-2">
          {step > 0 && (
            <Button
              variant="ghost"
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
          <Button variant="outline" onClick={handleSkip}>
            {entries.length > 0 ? 'Next' : 'Skip'}
          </Button>
          {step === STEPS.length - 1 && entries.length > 0 && (
            <Button onClick={onComplete}>
              Finish
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
