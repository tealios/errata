import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api, type Fragment } from '@/lib/api'
import type { FragmentPrefill } from '@/components/fragments/FragmentEditor'
import { Button } from '@/components/ui/button'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { FragmentEditor } from '@/components/fragments/FragmentEditor'
import { DebugPanel } from '@/components/generation/DebugPanel'
import { ProviderPanel } from '@/components/settings/ProviderManager'
import { ProseChainView } from '@/components/prose/ProseChainView'
import { StoryWizard } from '@/components/wizard/StoryWizard'
import { StorySidebar, type SidebarSection } from '@/components/sidebar/StorySidebar'
import { DetailPanel } from '@/components/sidebar/DetailPanel'
import { getPluginPanel } from '@/lib/plugin-panels'
import { componentId } from '@/lib/dom-ids'
import '@/lib/plugin-panel-init'

export const Route = createFileRoute('/story/$storyId')({
  component: StoryEditorPage,
})

function StoryEditorPage() {
  const { storyId } = Route.useParams()
  const [activeSection, setActiveSection] = useState<SidebarSection>(null)
  const [selectedFragment, setSelectedFragment] = useState<Fragment | null>(null)
  const [editorMode, setEditorMode] = useState<'view' | 'edit' | 'create'>('view')
  const [createType, setCreateType] = useState<string>('prose')
  const [createPrefill, setCreatePrefill] = useState<FragmentPrefill | null>(null)
  const [showWizard, setShowWizard] = useState<boolean | null>(null)
  const [debugLogId, setDebugLogId] = useState<string | null>(null)
  const [showProviders, setShowProviders] = useState(false)

  const { data: story, isLoading } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })

  const { data: proseFragments } = useQuery({
    queryKey: ['fragments', storyId, 'prose'],
    queryFn: () => api.fragments.list(storyId, 'prose'),
  })

  const { data: allFragments } = useQuery({
    queryKey: ['fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
  })

  const { data: plugins } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.plugins.list(),
  })

  const enabledPanelPlugins = useMemo(() => {
    if (!plugins || !story) return []
    const enabled = story.settings.enabledPlugins
    return plugins
      .filter((p) => p.panel && enabled.includes(p.name) && getPluginPanel(p.name))
      .map((p) => ({ name: p.name, title: p.panel!.title }))
  }, [plugins, story])

  // Auto-show wizard when story has no fragments
  if (showWizard === null && allFragments !== undefined) {
    if (allFragments.length === 0) {
      setShowWizard(true)
    } else {
      setShowWizard(false)
    }
  }

  const handleSelectFragment = (fragment: Fragment) => {
    setSelectedFragment(fragment)
    setEditorMode('edit')
  }

  const handleCreateFragment = (type: string, prefill?: FragmentPrefill) => {
    setSelectedFragment(null)
    setCreateType(type)
    setCreatePrefill(prefill ?? null)
    setEditorMode('create')
  }

  const handleEditorClose = () => {
    setSelectedFragment(null)
    setCreatePrefill(null)
    setEditorMode('view')
  }

  const handleDebugLog = (logId: string) => {
    setDebugLogId(logId || '__browse__')
    setSelectedFragment(null)
    setEditorMode('view')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground/50 italic">Loading story...</p>
      </div>
    )
  }

  if (!story) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-sm text-muted-foreground/50 italic">Story not found.</p>
        <Link to="/">
          <Button variant="outline" size="sm">Back to stories</Button>
        </Link>
      </div>
    )
  }

  const isEditingFragment = editorMode !== 'view' || selectedFragment

  return (
    <SidebarProvider className="!min-h-svh !max-h-svh overflow-hidden" data-component-id="story-editor-root">
      <StorySidebar
        storyId={storyId}
        story={story}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        enabledPanelPlugins={enabledPanelPlugins}
      />

      {/* Detail Panel */}
      <DetailPanel
        storyId={storyId}
        story={story}
        section={activeSection}
        onClose={() => setActiveSection(null)}
        onSelectFragment={handleSelectFragment}
        onCreateFragment={handleCreateFragment}
        selectedFragmentId={selectedFragment?.id}
        onManageProviders={() => setShowProviders(true)}
      />

      {/* Main Content */}
      <SidebarInset className="overflow-hidden min-h-0 relative" data-component-id="main-prose-pane">
        {/* Prose view — always mounted to preserve scroll position */}
        <ProseChainView
          storyId={storyId}
          fragments={proseFragments ?? []}
          onSelectFragment={handleSelectFragment}
          onDebugLog={handleDebugLog}
        />

        {/* Overlay panels render on top */}
        {showWizard && (
          <div className="absolute inset-0 z-10 bg-background" data-component-id="overlay-story-wizard">
            <StoryWizard storyId={storyId} onComplete={() => setShowWizard(false)} />
          </div>
        )}
        {debugLogId && (
          <div className="absolute inset-0 z-10 bg-background" data-component-id="overlay-debug-panel">
            <DebugPanel
              storyId={storyId}
              fragmentId={debugLogId === '__browse__' ? undefined : debugLogId}
              onClose={() => setDebugLogId(null)}
            />
          </div>
        )}
        {showProviders && (
          <div className="absolute inset-0 z-10 bg-background" data-component-id="overlay-provider-panel">
            <ProviderPanel onClose={() => setShowProviders(false)} />
          </div>
        )}
        {isEditingFragment && (
          <div className="absolute inset-0 z-10 bg-background" data-component-id={componentId('overlay-fragment-editor', editorMode)}>
            <FragmentEditor
              storyId={storyId}
              fragment={selectedFragment}
              mode={editorMode}
              createType={createType}
              prefill={createPrefill}
              onClose={handleEditorClose}
              onSaved={handleEditorClose}
            />
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
