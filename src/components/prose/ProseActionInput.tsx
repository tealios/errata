import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ProseActionInputProps {
  storyId: string
  fragmentId: string
  mode: 'regenerate' | 'refine'
  onComplete: () => void
  onCancel: () => void
}

export function ProseActionInput({
  storyId,
  fragmentId,
  mode,
  onComplete,
  onCancel,
}: ProseActionInputProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      const stream = mode === 'regenerate'
        ? await api.generation.regenerate(storyId, fragmentId, input)
        : await api.generation.refine(storyId, fragmentId, input)

      // Consume the stream
      const reader = stream.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, storyId, fragmentId, mode, queryClient, onComplete])

  const placeholder = mode === 'regenerate'
    ? 'New direction...'
    : 'How to refine...'

  return (
    <div className="mt-2 rounded-md border border-accent bg-accent/10 p-3">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        className="min-h-[60px] max-h-[120px] resize-none text-sm border-muted"
        disabled={isLoading}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onCancel()
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            handleSubmit()
          }
        }}
      />
      {error && (
        <p className="text-sm text-destructive mt-1">{error}</p>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-muted-foreground">
          Esc to cancel, Ctrl+Enter to submit
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!input.trim() || isLoading}>
            {isLoading ? (mode === 'regenerate' ? 'Regenerating...' : 'Refining...') : (mode === 'regenerate' ? 'Regenerate' : 'Refine')}
          </Button>
        </div>
      </div>
    </div>
  )
}
