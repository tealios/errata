import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Fragment } from '@/lib/api'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { FragmentList } from '@/components/fragments/FragmentList'
import { FragmentEditor } from '@/components/fragments/FragmentEditor'
import { GenerationPanel } from '@/components/generation/GenerationPanel'
import { ProseChainView } from '@/components/prose/ProseChainView'

export const Route = createFileRoute('/story/$storyId')({
  component: StoryEditorPage,
})

const FRAGMENT_TABS = [
  { value: 'prose', label: 'Prose' },
  { value: 'character', label: 'Characters' },
  { value: 'guideline', label: 'Guidelines' },
  { value: 'knowledge', label: 'Knowledge' },
] as const

function StoryEditorPage() {
  const { storyId } = Route.useParams()
  const [activeTab, setActiveTab] = useState<string>('prose')
  const [selectedFragment, setSelectedFragment] = useState<Fragment | null>(null)
  const [editorMode, setEditorMode] = useState<'view' | 'edit' | 'create'>('view')
  const [createType, setCreateType] = useState<string>('prose')
  const [showGenerate, setShowGenerate] = useState(false)

  const { data: story, isLoading } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })

  const { data: proseFragments } = useQuery({
    queryKey: ['fragments', storyId, 'prose'],
    queryFn: () => api.fragments.list(storyId, 'prose'),
  })

  const handleSelectFragment = (fragment: Fragment) => {
    setSelectedFragment(fragment)
    setEditorMode('edit')
    setShowGenerate(false)
  }

  const handleCreateNew = (type?: string) => {
    setSelectedFragment(null)
    setCreateType(type ?? activeTab)
    setEditorMode('create')
    setShowGenerate(false)
  }

  const handleEditorClose = () => {
    setSelectedFragment(null)
    setEditorMode('view')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading story...</p>
      </div>
    )
  }

  if (!story) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-muted-foreground">Story not found.</p>
        <Link to="/">
          <Button variant="outline">Back to stories</Button>
        </Link>
      </div>
    )
  }

  const isEditingFragment = editorMode !== 'view' || selectedFragment

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-72 border-r flex flex-col bg-muted/30">
        <div className="p-4 border-b">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; Stories
          </Link>
          <h2 className="text-lg font-semibold mt-1 truncate">{story.name}</h2>
          <p className="text-xs text-muted-foreground truncate">{story.description}</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="mx-2 mt-2 grid grid-cols-4">
            {FRAGMENT_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="text-xs px-1">
                {tab.label.slice(0, 4)}
              </TabsTrigger>
            ))}
          </TabsList>
          {FRAGMENT_TABS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="flex-1 overflow-hidden m-0">
              <FragmentList
                storyId={storyId}
                type={tab.value}
                onSelect={handleSelectFragment}
                onCreateNew={() => handleCreateNew(tab.value)}
                selectedId={selectedFragment?.id}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {isEditingFragment ? (
          <FragmentEditor
            storyId={storyId}
            fragment={selectedFragment}
            mode={editorMode}
            createType={createType}
            onClose={handleEditorClose}
            onSaved={handleEditorClose}
          />
        ) : showGenerate ? (
          <GenerationPanel storyId={storyId} onBack={() => setShowGenerate(false)} />
        ) : (
          <ProseChainView
            storyId={storyId}
            fragments={proseFragments ?? []}
            onSelectFragment={handleSelectFragment}
            onGenerate={() => setShowGenerate(true)}
            onCreateNew={() => handleCreateNew('prose')}
          />
        )}
      </div>
    </div>
  )
}
