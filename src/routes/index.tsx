import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <h1 className="text-2xl font-bold tracking-tight">Errata</h1>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>New Story</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Story</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  createMutation.mutate({ name, description })
                }}
                className="space-y-4"
              >
                <Input
                  placeholder="Story name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <Textarea
                  placeholder="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {isLoading && <p className="text-muted-foreground">Loading stories...</p>}
        {stories && stories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-lg text-muted-foreground mb-4">No stories yet.</p>
            <Button onClick={() => setOpen(true)}>Create your first story</Button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stories?.map((story) => (
            <Card key={story.id} className="group relative">
              <Link
                to="/story/$storyId"
                params={{ storyId: story.id }}
                className="block"
              >
                <CardHeader>
                  <CardTitle className="text-lg">{story.name}</CardTitle>
                  <CardDescription>{story.description}</CardDescription>
                  <p className="text-xs text-muted-foreground mt-2">
                    Updated {new Date(story.updatedAt).toLocaleDateString()}
                  </p>
                </CardHeader>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-destructive"
                onClick={(e) => {
                  e.preventDefault()
                  if (confirm(`Delete "${story.name}"?`)) {
                    deleteMutation.mutate(story.id)
                  }
                }}
              >
                Delete
              </Button>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}
