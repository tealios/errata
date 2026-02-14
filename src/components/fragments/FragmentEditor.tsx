import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export interface FragmentPrefill {
  name: string
  description: string
  content: string
}

interface FragmentEditorProps {
  storyId: string
  fragment: Fragment | null
  mode: 'view' | 'edit' | 'create'
  createType?: string
  prefill?: FragmentPrefill | null
  onClose: () => void
  onSaved: () => void
}

export function FragmentEditor({
  storyId,
  fragment,
  mode,
  createType,
  prefill,
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
      setName(prefill?.name ?? '')
      setDescription(prefill?.description ?? '')
      setContent(prefill?.content ?? '')
      setType(createType ?? 'prose')
    }
  }, [fragment, createType, prefill])

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

  const stickyMutation = useMutation({
    mutationFn: (sticky: boolean) =>
      api.fragments.toggleSticky(storyId, fragment!.id, sticky),
    onSuccess: () => {
      invalidate()
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
            <>
              <Badge variant="outline">{fragment.id}</Badge>
              <Badge variant="secondary" className="text-[10px]">{fragment.type}</Badge>
              {fragment.sticky && (
                <Badge className="text-[10px]">sticky</Badge>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2">
          {fragment && (
            <Button
              size="sm"
              variant={fragment.sticky ? 'default' : 'outline'}
              onClick={() => stickyMutation.mutate(!fragment.sticky)}
              disabled={stickyMutation.isPending}
            >
              {fragment.sticky ? 'Unpin' : 'Pin'}
            </Button>
          )}
          {mode === 'view' && fragment && (
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
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-auto">
        <div className="p-4 space-y-4">
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
        </div>

        <Separator />

        <div className="flex-1 p-4">
          <label className="text-sm font-medium mb-1 block">Content</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={!isEditing}
            className="min-h-[200px] h-full resize-none font-mono text-sm"
            required
          />
        </div>

        {/* Tags & Refs section */}
        {fragment && (
          <>
            <Separator />
            <div className="p-4 space-y-4">
              <TagsSection storyId={storyId} fragmentId={fragment.id} />
              <RefsSection storyId={storyId} fragmentId={fragment.id} />
            </div>
          </>
        )}

        {isEditing && (
          <div className="flex gap-2 p-4 pt-2 border-t">
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

// --- Tags sub-component ---

function TagsSection({ storyId, fragmentId }: { storyId: string; fragmentId: string }) {
  const queryClient = useQueryClient()
  const [newTag, setNewTag] = useState('')

  const { data } = useQuery({
    queryKey: ['tags', storyId, fragmentId],
    queryFn: () => api.fragments.getTags(storyId, fragmentId),
  })

  const addMutation = useMutation({
    mutationFn: (tag: string) => api.fragments.addTag(storyId, fragmentId, tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags', storyId, fragmentId] })
      setNewTag('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (tag: string) => api.fragments.removeTag(storyId, fragmentId, tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags', storyId, fragmentId] })
    },
  })

  const handleAddTag = () => {
    const tag = newTag.trim().toLowerCase()
    if (tag && !data?.tags.includes(tag)) {
      addMutation.mutate(tag)
    }
  }

  return (
    <div>
      <label className="text-sm font-medium mb-1 block">Tags</label>
      <div className="flex flex-wrap gap-1 mb-2">
        {data?.tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs gap-1">
            {tag}
            <button
              type="button"
              onClick={() => removeMutation.mutate(tag)}
              className="ml-1 hover:text-destructive"
            >
              x
            </button>
          </Badge>
        ))}
        {(!data?.tags || data.tags.length === 0) && (
          <span className="text-xs text-muted-foreground">No tags</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder="Add tag..."
          className="h-7 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddTag()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={handleAddTag}
          disabled={!newTag.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

// --- Refs sub-component ---

function RefsSection({ storyId, fragmentId }: { storyId: string; fragmentId: string }) {
  const queryClient = useQueryClient()
  const [newRefId, setNewRefId] = useState('')

  const { data } = useQuery({
    queryKey: ['refs', storyId, fragmentId],
    queryFn: () => api.fragments.getRefs(storyId, fragmentId),
  })

  const addMutation = useMutation({
    mutationFn: (targetId: string) => api.fragments.addRef(storyId, fragmentId, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['refs', storyId, fragmentId] })
      setNewRefId('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (targetId: string) => api.fragments.removeRef(storyId, fragmentId, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['refs', storyId, fragmentId] })
    },
  })

  const handleAddRef = () => {
    const id = newRefId.trim()
    if (id && !data?.refs.includes(id)) {
      addMutation.mutate(id)
    }
  }

  return (
    <div>
      <label className="text-sm font-medium mb-1 block">References</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {data?.refs.map((refId) => (
          <Badge key={refId} variant="outline" className="text-xs gap-1">
            {refId}
            <button
              type="button"
              onClick={() => removeMutation.mutate(refId)}
              className="ml-1 hover:text-destructive"
            >
              x
            </button>
          </Badge>
        ))}
        {(!data?.refs || data.refs.length === 0) && (
          <span className="text-xs text-muted-foreground">No refs</span>
        )}
      </div>
      {data?.backRefs && data.backRefs.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          <span className="text-xs text-muted-foreground">Referenced by:</span>
          {data.backRefs.map((refId) => (
            <Badge key={refId} variant="secondary" className="text-[10px]">
              {refId}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <Input
          value={newRefId}
          onChange={(e) => setNewRefId(e.target.value)}
          placeholder="Fragment ID (e.g. ch-a1b2)"
          className="h-7 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddRef()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={handleAddRef}
          disabled={!newRefId.trim()}
        >
          Link
        </Button>
      </div>
    </div>
  )
}
