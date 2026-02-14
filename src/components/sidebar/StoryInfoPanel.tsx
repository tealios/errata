import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface StoryInfoPanelProps {
  storyId: string
  story: StoryMeta
}

export function StoryInfoPanel({ storyId, story }: StoryInfoPanelProps) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(story.name)
  const [description, setDescription] = useState(story.description)

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      api.stories.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
      setEditing(false)
    },
  })

  const handleSave = () => {
    updateMutation.mutate({ name: name.trim(), description: description.trim() })
  }

  const handleCancel = () => {
    setName(story.name)
    setDescription(story.description)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="p-4 space-y-4">
        <div>
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Name</label>
          <p className="text-sm font-display mt-0.5">{story.name}</p>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Description</label>
          <p className="text-sm mt-0.5">{story.description || <span className="text-muted-foreground/40 italic">No description</span>}</p>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Summary</label>
          <p className="text-sm whitespace-pre-wrap mt-0.5">{story.summary || <span className="text-muted-foreground/40 italic">No summary yet</span>}</p>
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground/40">
          <span>Created {new Date(story.createdAt).toLocaleDateString()}</span>
          <span>Updated {new Date(story.updatedAt).toLocaleDateString()}</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent" />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">Description</label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[80px] resize-none text-sm bg-transparent"
        />
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
