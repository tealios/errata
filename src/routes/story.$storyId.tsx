import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { api, type Fragment } from '@/lib/api'
import type { FragmentPrefill } from '@/components/fragments/FragmentEditor'
import { Button } from '@/components/ui/button'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { FragmentEditor } from '@/components/fragments/FragmentEditor'
import { FragmentExportPanel } from '@/components/fragments/FragmentExportPanel'
import { DebugPanel } from '@/components/generation/DebugPanel'
import { ProviderPanel } from '@/components/settings/ProviderManager'
import { ProseChainView } from '@/components/prose/ProseChainView'
import { StoryWizard } from '@/components/wizard/StoryWizard'
import { StorySidebar, type SidebarSection } from '@/components/sidebar/StorySidebar'
import { DetailPanel } from '@/components/sidebar/DetailPanel'
import { componentId } from '@/lib/dom-ids'
import { FragmentImportDialog } from '@/components/fragments/FragmentImportDialog'
import {
  parseErrataExport,
  readFileAsText,
  type ErrataExportData,
} from '@/lib/fragment-clipboard'
import { Upload } from 'lucide-react'
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
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importInitialData, setImportInitialData] = useState<ErrataExportData | null>(null)
  const [showExportPanel, setShowExportPanel] = useState(false)
  const [fileDragOver, setFileDragOver] = useState(false)
  const dragCounter = useRef(0)

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
      .filter((p) => p.panel && enabled.includes(p.name))
      .map((p) => ({
        name: p.name,
        title: p.panel!.title,
        mode: p.panel?.mode,
        url: p.panel?.url,
      }))
  }, [plugins, story])

  useEffect(() => {
    localStorage.setItem(`errata:last-accessed:${storyId}`, new Date().toISOString())
  }, [storyId])

  useEffect(() => {
    if (!story?.name) return
    const previousTitle = document.title
    document.title = story.name
    return () => {
      document.title = previousTitle
    }
  }, [story?.name])

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

  const handleOpenImport = useCallback(() => {
    setImportInitialData(null)
    setShowImportDialog(true)
  }, [])

  // Listen for paste events — if errata data is on clipboard, offer to import
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept paste inside inputs/textareas/contenteditable
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      const text = e.clipboardData?.getData('text/plain')
      if (!text) return

      const parsed = parseErrataExport(text)
      if (parsed) {
        e.preventDefault()
        setImportInitialData(parsed)
        setShowImportDialog(true)
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // Global drag-and-drop for .json file import
  useEffect(() => {
    const hasJsonFile = (e: DragEvent) => {
      if (!e.dataTransfer) return false
      // Check types for files
      for (let i = 0; i < e.dataTransfer.types.length; i++) {
        if (e.dataTransfer.types[i] === 'Files') return true
      }
      return false
    }

    const handleDragEnter = (e: DragEvent) => {
      if (!hasJsonFile(e)) return
      e.preventDefault()
      dragCounter.current++
      if (dragCounter.current === 1) {
        setFileDragOver(true)
      }
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!hasJsonFile(e)) return
      e.preventDefault()
      dragCounter.current--
      if (dragCounter.current === 0) {
        setFileDragOver(false)
      }
    }

    const handleDragOver = (e: DragEvent) => {
      if (!hasJsonFile(e)) return
      e.preventDefault()
    }

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setFileDragOver(false)

      const file = e.dataTransfer?.files[0]
      if (!file) return

      try {
        const text = await readFileAsText(file)
        const parsed = parseErrataExport(text)
        if (parsed) {
          setImportInitialData(parsed)
          setShowImportDialog(true)
        }
      } catch {
        // Not a valid file, ignore
      }
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])

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
        onLaunchWizard={() => setShowWizard(true)}
        onImportFragment={handleOpenImport}
        onExport={() => setShowExportPanel(true)}
        onDownloadStory={() => api.stories.exportAsZip(storyId)}
        enabledPanelPlugins={enabledPanelPlugins}
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
          <div className="absolute inset-0 z-30 bg-background" data-component-id="overlay-story-wizard">
            <StoryWizard storyId={storyId} onComplete={() => setShowWizard(false)} />
          </div>
        )}
        {debugLogId && (
          <div className="absolute inset-0 z-30 bg-background" data-component-id="overlay-debug-panel">
            <DebugPanel
              storyId={storyId}
              fragmentId={debugLogId === '__browse__' ? undefined : debugLogId}
              onClose={() => setDebugLogId(null)}
            />
          </div>
        )}
        {showProviders && (
          <div className="absolute inset-0 z-30 bg-background" data-component-id="overlay-provider-panel">
            <ProviderPanel onClose={() => setShowProviders(false)} />
          </div>
        )}
        {showExportPanel && (
          <div className="absolute inset-0 z-30 bg-background" data-component-id="overlay-export-panel">
            <FragmentExportPanel
              storyId={storyId}
              storyName={story.name}
              onClose={() => setShowExportPanel(false)}
            />
          </div>
        )}
        {isEditingFragment && (
          <div className="absolute inset-0 z-30 bg-background" data-component-id={componentId('overlay-fragment-editor', editorMode)}>
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

      {/* Global file drag-drop overlay */}
      {fileDragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 px-16 py-12">
            <Upload className="size-8 text-primary/50" />
            <p className="text-sm font-medium text-primary/70">Drop .json file to import</p>
            <p className="text-xs text-muted-foreground/50">Errata fragment or bundle</p>
          </div>
        </div>
      )}

      <FragmentImportDialog
        storyId={storyId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        initialData={importInitialData}
      />
    </SidebarProvider>
  )
}
