import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface FragmentEditorProps {
  storyId: string
  fragment: Fragment | null
  mode: 'view' | 'edit' | 'create'
  createType?: string
  onClose: () => void
  onSaved: () => void
}

export function FragmentEditor({
  storyId,
  fragment,
  mode,
  createType,
  onClose,
  onSaved,
}: FragmentEditorProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState(createType ?? 'prose')

  useEffect(() => {
    if (fragment) {
      setName(fragment.name)
      setDescription(fragment.description)
      setContent(fragment.content)
      setType(fragment.type)
    } else {
      setName('')
      setDescription('')
      setContent('')
      setType(createType ?? 'prose')
    }
  }, [fragment, createType])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
  }

  const createMutation = useMutation({
    mutationFn: (data: { type: string; name: string; description: string; content: string }) =>
      api.fragments.create(storyId, data),
    onSuccess: () => {
      invalidate()
      onSaved()
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string; content: string }) =>
      api.fragments.update(storyId, fragment!.id, data),
    onSuccess: () => {
      invalidate()
      onSaved()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.fragments.delete(storyId, fragment!.id),
    onSuccess: () => {
      invalidate()
      onClose()
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'create') {
      createMutation.mutate({ type, name, description, content })
    } else {
      updateMutation.mutate({ name, description, content })
    }
  }

  const isEditing = mode === 'edit' || mode === 'create'
  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">
            {mode === 'create' ? 'New Fragment' : fragment?.name ?? ''}
          </h2>
          {fragment && (
            <Badge variant="outline">{fragment.id}</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {mode === 'view' && fragment && (
            <>
              <Button size="sm" variant="outline" onClick={() => onClose()}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (confirm('Delete this fragment?')) {
                    deleteMutation.mutate()
                  }
                }}
              >
                Delete
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 p-4 gap-4 overflow-auto">
        {mode === 'create' && (
          <div>
            <label className="text-sm font-medium mb-1 block">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="prose">Prose</option>
              <option value="character">Character</option>
              <option value="guideline">Guideline</option>
              <option value="knowledge">Knowledge</option>
            </select>
          </div>
        )}

        <div>
          <label className="text-sm font-medium mb-1 block">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isEditing}
            required
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
            disabled={!isEditing}
            required
          />
        </div>

        <Separator />

        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block">Content</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={!isEditing}
            className="min-h-[200px] h-full resize-none font-mono text-sm"
            required
          />
        </div>

        {isEditing && (
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}
