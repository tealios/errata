import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { api, type Fragment } from '@/lib/api'
import type { FragmentPrefill } from '@/components/fragments/FragmentEditor'
import { Button } from '@/components/ui/button'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { FragmentEditor } from '@/components/fragments/FragmentEditor'
import { FragmentExportPanel } from '@/components/fragments/FragmentExportPanel'
import { DebugPanel } from '@/components/generation/DebugPanel'
import { ProviderPanel } from '@/components/settings/ProviderManager'
import { ProseChainView } from '@/components/prose/ProseChainView'
import { StoryWizard } from '@/components/wizard/StoryWizard'
import { StorySidebar, type SidebarSection } from '@/components/sidebar/StorySidebar'
import { DetailPanel } from '@/components/sidebar/DetailPanel'
import { componentId } from '@/lib/dom-ids'
import {
  deactivateAllClientPluginRuntimes,
  syncClientPluginRuntimes,
  notifyPluginPanelOpen,
  notifyPluginPanelClose,
} from '@/lib/plugin-panels'
import { FragmentImportDialog } from '@/components/fragments/FragmentImportDialog'
import {
  parseErrataExport,
  readFileAsText,
  downloadTextFile,
  type ErrataExportData,
} from '@/lib/fragment-clipboard'
import { Upload } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { TimelineTabs } from '@/components/prose/TimelineTabs'
import { useTimelineBar } from '@/lib/theme'
import '@/lib/plugin-panel-init'

export const Route = createFileRoute('/story/$storyId')({
  component: StoryEditorPage,
})

function StoryEditorPage() {
  const { storyId } = Route.useParams()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const pluginSidebarPrefsKey = `errata:plugin-sidebar:${storyId}`
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
  const [pluginSidebarVisibility, setPluginSidebarVisibility] = useState<Record<string, boolean>>({})
  const [pluginCloseReturnSection, setPluginCloseReturnSection] = useState<SidebarSection>(null)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [timelineBarVisible, setTimelineBarVisible] = useTimelineBar()
  const dragCounter = useRef(0)

  const { data: story, isLoading } = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => api.stories.get(storyId),
  })

  const { data: allFragments } = useQuery({
    queryKey: ['fragments', storyId],
    queryFn: () => api.fragments.list(storyId),
  })

  const { data: plugins } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.plugins.list(),
  })

  const { data: branchesIndex } = useQuery({
    queryKey: ['branches', storyId],
    queryFn: () => api.branches.list(storyId),
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(pluginSidebarPrefsKey)
      setPluginSidebarVisibility(raw ? JSON.parse(raw) : {})
    } catch {
      setPluginSidebarVisibility({})
    }
  }, [pluginSidebarPrefsKey])

  const setPluginSidebarVisible = useCallback((pluginName: string, visible: boolean) => {
    setPluginSidebarVisibility((prev) => {
      const next = { ...prev, [pluginName]: visible }
      localStorage.setItem(pluginSidebarPrefsKey, JSON.stringify(next))
      return next
    })
  }, [pluginSidebarPrefsKey])

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
        showInSidebar: pluginSidebarVisibility[p.name] ?? (p.panel?.showInSidebar !== false),
        icon: p.panel?.icon,
      }))
  }, [plugins, story, pluginSidebarVisibility])

  const sidebarPanelPlugins = useMemo(
    () => enabledPanelPlugins.filter((plugin) => plugin.showInSidebar !== false),
    [enabledPanelPlugins],
  )

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

  useEffect(() => {
    if (!story) return
    syncClientPluginRuntimes(story.settings.enabledPlugins ?? [], { storyId })
  }, [story?.settings.enabledPlugins, storyId])

  useEffect(() => {
    return () => {
      deactivateAllClientPluginRuntimes()
    }
  }, [])

  // Generic plugin query invalidation — plugins dispatch this event to
  // invalidate TanStack Query caches without needing React context.
  // Also broadcasts to plugin iframes so they can re-fetch their own data.
  useEffect(() => {
    const handler = (e: Event) => {
      const { queryKeys } = (e as CustomEvent).detail
      for (const key of queryKeys) {
        queryClient.invalidateQueries({ queryKey: key })
      }
      const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe[data-component-id*="panel-iframe"]')
      for (const iframe of iframes) {
        iframe.contentWindow?.postMessage({ type: 'errata:data-changed', queryKeys }, '*')
      }
    }
    window.addEventListener('errata:plugin:invalidate', handler)
    return () => window.removeEventListener('errata:plugin:invalidate', handler)
  }, [queryClient])

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
    if (isMobile) setActiveSection(null) // Close detail panel on mobile so editor is visible
    notifyPluginPanelOpen({ panel: 'fragment-editor', fragment, mode: 'edit' }, { storyId })
  }

  const handleCreateFragment = (type: string, prefill?: FragmentPrefill) => {
    setSelectedFragment(null)
    setCreateType(type)
    setCreatePrefill(prefill ?? null)
    setEditorMode('create')
    if (isMobile) setActiveSection(null)
    notifyPluginPanelOpen({ panel: 'fragment-editor', mode: 'create' }, { storyId })
  }

  const handleEditorClose = () => {
    setSelectedFragment(null)
    setCreatePrefill(null)
    setEditorMode('view')
    notifyPluginPanelClose({ panel: 'fragment-editor' }, { storyId })
  }

  const handleDebugLog = (logId: string) => {
    setDebugLogId(logId || '__browse__')
    setSelectedFragment(null)
    setEditorMode('view')
    notifyPluginPanelOpen({ panel: 'debug' }, { storyId })
  }

  const handleSectionChange = useCallback((section: SidebarSection) => {
    setPluginCloseReturnSection(null)
    setActiveSection(section)
    if (section === null) {
      setSelectedFragment((prev) => {
        if (prev || editorMode !== 'view') {
          notifyPluginPanelClose({ panel: 'fragment-editor' }, { storyId })
        }
        return null
      })
      setCreatePrefill(null)
      setEditorMode('view')
      setDebugLogId((prev) => {
        if (prev) notifyPluginPanelClose({ panel: 'debug' }, { storyId })
        return null
      })
    }
  }, [editorMode, storyId])

  const handleOpenPluginPanelFromSettings = useCallback((pluginName: string) => {
    setPluginCloseReturnSection('settings')
    setActiveSection(`plugin-${pluginName}`)
  }, [])

  const handleDetailPanelClose = useCallback(() => {
    if (activeSection?.startsWith('plugin-') && pluginCloseReturnSection) {
      setActiveSection(pluginCloseReturnSection)
    } else {
      setActiveSection(null)
    }
    setPluginCloseReturnSection(null)
  }, [activeSection, pluginCloseReturnSection])

  const handleOpenImport = useCallback(() => {
    setImportInitialData(null)
    setShowImportDialog(true)
  }, [])

  const handleExportProse = useCallback(async () => {
    const [chain, fragments] = await Promise.all([
      api.proseChain.get(storyId),
      api.fragments.list(storyId, 'prose'),
    ])
    const fragmentById = new Map(fragments.map(f => [f.id, f]))
    const activeIds = chain.entries.map(e => e.active)
    const contents = activeIds
      .map(id => fragmentById.get(id)?.content)
      .filter((c): c is string => !!c)
    const text = contents.join('\n\n')
    const safeName = (story?.name ?? 'story').replace(/[^a-zA-Z0-9_-]/g, '_')
    downloadTextFile(text, `${safeName}.txt`)
  }, [storyId, story?.name])

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
        onSectionChange={handleSectionChange}
        enabledPanelPlugins={sidebarPanelPlugins}
      />

      {/* Detail Panel */}
      <DetailPanel
        storyId={storyId}
        story={story}
        section={activeSection}
        onClose={handleDetailPanelClose}
        onSelectFragment={handleSelectFragment}
        onCreateFragment={handleCreateFragment}
        selectedFragmentId={selectedFragment?.id}
        onManageProviders={() => {
          setShowProviders(true)
          notifyPluginPanelOpen({ panel: 'providers' }, { storyId })
        }}
        onOpenPluginPanel={handleOpenPluginPanelFromSettings}
        onTogglePluginSidebar={setPluginSidebarVisible}
        pluginSidebarVisibility={pluginSidebarVisibility}
        onLaunchWizard={() => {
          setShowWizard(true)
          notifyPluginPanelOpen({ panel: 'wizard' }, { storyId })
        }}
        onImportFragment={handleOpenImport}
        onExport={() => {
          setShowExportPanel(true)
          notifyPluginPanelOpen({ panel: 'export' }, { storyId })
        }}
        onDownloadStory={() => api.stories.exportAsZip(storyId)}
        onExportProse={handleExportProse}
        enabledPanelPlugins={enabledPanelPlugins}
      />

      {/* Main Content */}
      <SidebarInset className="overflow-hidden min-h-0 relative" data-component-id="main-prose-pane">
        {/* Mobile sidebar trigger — visible only below md breakpoint */}
        <div className="md:hidden absolute top-3 left-3 z-20">
          <SidebarTrigger className="size-9 bg-background/80 backdrop-blur-sm border border-border/40 shadow-sm" />
        </div>

        {/* Timeline tabs — shown when multiple timelines exist and bar is visible */}
        {timelineBarVisible && branchesIndex && branchesIndex.branches.length > 1 && (
          <TimelineTabs
            storyId={storyId}
            branches={branchesIndex.branches}
            activeBranchId={branchesIndex.activeBranchId}
            onHide={() => setTimelineBarVisible(false)}
          />
        )}

        {/* Prose view — always mounted to preserve scroll position */}
        <ProseChainView
          storyId={storyId}
          onSelectFragment={handleSelectFragment}
          onDebugLog={handleDebugLog}
          onLaunchWizard={() => {
            setShowWizard(true)
            notifyPluginPanelOpen({ panel: 'wizard' }, { storyId })
          }}
          onAskLibrarian={(fragmentId) => {
            setActiveSection('agent-activity')
            window.dispatchEvent(new CustomEvent('errata:librarian:ask', { detail: { fragmentId } }))
          }}
        />

        {/* Overlay panels render on top */}
        {showWizard && (
          <div className="absolute inset-0 z-30 bg-background" data-component-id="overlay-story-wizard">
            <StoryWizard storyId={storyId} onComplete={() => {
              setShowWizard(false)
              notifyPluginPanelClose({ panel: 'wizard' }, { storyId })
            }} />
          </div>
        )}
        {debugLogId && (
          <div className="absolute inset-0 z-30 bg-background" data-component-id="overlay-debug-panel">
            <DebugPanel
              storyId={storyId}
              fragmentId={debugLogId === '__browse__' ? undefined : debugLogId}
              onClose={() => {
                setDebugLogId(null)
                notifyPluginPanelClose({ panel: 'debug' }, { storyId })
              }}
            />
          </div>
        )}
        {showProviders && (
          <div className="absolute inset-0 z-30 bg-background" data-component-id="overlay-provider-panel">
            <ProviderPanel onClose={() => {
              setShowProviders(false)
              notifyPluginPanelClose({ panel: 'providers' }, { storyId })
            }} />
          </div>
        )}
        {showExportPanel && (
          <div className="absolute inset-0 z-30 bg-background" data-component-id="overlay-export-panel">
            <FragmentExportPanel
              storyId={storyId}
              storyName={story.name}
              onClose={() => {
                setShowExportPanel(false)
                notifyPluginPanelClose({ panel: 'export' }, { storyId })
              }}
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
              onSaved={(created) => {
                if (created) {
                  setSelectedFragment(created)
                  setCreatePrefill(null)
                  setEditorMode('edit')
                  notifyPluginPanelOpen({ panel: 'fragment-editor', fragment: created, mode: 'edit' }, { storyId })
                }
              }}
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
