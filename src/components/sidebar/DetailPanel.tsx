import { useState, useEffect, useRef } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import type { Fragment, StoryMeta } from '@/lib/api'
import type { SidebarSection } from './StorySidebar'
import { getPluginPanel } from '@/lib/plugin-panels'
import { FragmentList } from '@/components/fragments/FragmentList'
import { ContextOrderPanel } from '@/components/fragments/ContextOrderPanel'
import { BlockEditorPanel } from '@/components/blocks/BlockEditorPanel'
import { StoryInfoPanel } from './StoryInfoPanel'
import { SettingsPanel } from './SettingsPanel'
import { LibrarianPanel } from './LibrarianPanel'
import { ArchivePanel } from './ArchivePanel'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X } from 'lucide-react'
import { componentId } from '@/lib/dom-ids'

interface DetailPanelProps {
  storyId: string
  story: StoryMeta
  section: SidebarSection
  onClose: () => void
  onSelectFragment: (fragment: Fragment) => void
  onCreateFragment: (type: string, prefill?: { name: string; description: string; content: string }) => void
  selectedFragmentId?: string
  onManageProviders: () => void
  onOpenPluginPanel?: (pluginName: string) => void
  onTogglePluginSidebar?: (pluginName: string, visible: boolean) => void
  pluginSidebarVisibility?: Record<string, boolean>
  onLaunchWizard?: () => void
  onImportFragment?: () => void
  onExport?: () => void
  onDownloadStory?: () => void
  onExportProse?: () => void
  enabledPanelPlugins: Array<{
    name: string
    title: string
    mode?: 'react' | 'iframe'
    url?: string
    showInSidebar?: boolean
    icon?: { type: 'lucide'; name: string } | { type: 'svg'; src: string }
  }>
}

const SECTION_TITLES: Record<string, string> = {
  'story-info': 'Story Info',
  characters: 'Characters',
  guidelines: 'Guidelines',
  knowledge: 'Knowledge',
  media: 'Media',
  archive: 'Archive',
  'context-order': 'Fragment Order',
  'block-editor': 'Block Editor',
  settings: 'Settings',
  'agent-activity': 'Librarian',
}

const SECTION_TO_TYPE: Record<string, string> = {
  characters: 'character',
  guidelines: 'guideline',
  knowledge: 'knowledge',
}

const SECTION_LIST_IDS: Record<string, string> = {
  characters: 'character-sidebar-list',
  guidelines: 'guideline-sidebar-list',
  knowledge: 'knowledge-sidebar-list',
}

export function DetailPanel({
  storyId,
  story,
  section,
  onClose,
  onSelectFragment,
  onCreateFragment,
  selectedFragmentId,
  onManageProviders,
  onOpenPluginPanel,
  onTogglePluginSidebar,
  pluginSidebarVisibility,
  onLaunchWizard,
  onImportFragment,
  onExport,
  onDownloadStory,
  onExportProse,
  enabledPanelPlugins,
}: DetailPanelProps) {
  const isMobile = useIsMobile()
  const open = !!section
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep content rendered for the section that's closing
  const [renderedSection, setRenderedSection] = useState(section)
  if (section && section !== renderedSection) {
    setRenderedSection(section)
  }

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Trigger enter animation on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else {
      setVisible(false)
    }
  }, [open])

  const handleTransitionEnd = () => {
    if (!open) {
      setMounted(false)
      setRenderedSection(null)
    }
  }

  if (!mounted) return null

  const activeSection = renderedSection!
  const isPlugin = activeSection?.startsWith('plugin-')
  const pluginName = isPlugin ? activeSection.replace('plugin-', '') : null
  const title = isPlugin
    ? pluginName ?? 'Plugin'
    : SECTION_TITLES[activeSection] ?? activeSection

  const panelWidth = 440

  const panelContent = (
    <>
      {activeSection === 'story-info' && (
        <ScrollArea className="h-full">
          <StoryInfoPanel storyId={storyId} story={story} onLaunchWizard={onLaunchWizard} onExport={onExport} onDownloadStory={onDownloadStory} onExportProse={onExportProse} />
        </ScrollArea>
      )}

      {activeSection === 'settings' && (
        <ScrollArea className="h-full">
          <SettingsPanel
            storyId={storyId}
            story={story}
            onManageProviders={onManageProviders}
            onOpenPluginPanel={onOpenPluginPanel}
            onTogglePluginSidebar={onTogglePluginSidebar}
            pluginSidebarVisibility={pluginSidebarVisibility}
          />
        </ScrollArea>
      )}

      {activeSection === 'block-editor' && (
        <BlockEditorPanel storyId={storyId} />
      )}

      {activeSection === 'context-order' && (
        <ContextOrderPanel storyId={storyId} story={story} />
      )}

      {activeSection === 'agent-activity' && (
        <LibrarianPanel storyId={storyId} />
      )}

      {activeSection === 'archive' && (
        <ArchivePanel storyId={storyId} />
      )}

      {SECTION_TO_TYPE[activeSection] && (
        <FragmentList
          storyId={storyId}
          type={SECTION_TO_TYPE[activeSection]}
          listIdBase={SECTION_LIST_IDS[activeSection] ?? componentId(activeSection, 'sidebar-list')}
          onSelect={onSelectFragment}
          onCreateNew={() => onCreateFragment(SECTION_TO_TYPE[activeSection])}
          onImport={onImportFragment}
          selectedId={selectedFragmentId}
        />
      )}

      {activeSection === 'media' && (
        <FragmentList
          storyId={storyId}
          allowedTypes={['image', 'icon']}
          listIdBase="media-sidebar-list"
          onSelect={onSelectFragment}
          onCreateNew={() => onCreateFragment('image')}
          selectedId={selectedFragmentId}
        />
      )}

      {isPlugin && pluginName && (() => {
        const PanelComponent = getPluginPanel(pluginName)
        const pluginPanel = enabledPanelPlugins.find((plugin) => plugin.name === pluginName)
        return PanelComponent ? (
          <ScrollArea className="h-full">
            <div data-component-id={componentId('plugin', pluginName, 'panel-root')}>
              <PanelComponent storyId={storyId} />
            </div>
          </ScrollArea>
        ) : pluginPanel?.mode === 'iframe' && pluginPanel.url ? (
          <div className="h-full" data-component-id={componentId('plugin', pluginName, 'panel-root')}>
            <iframe
              src={`${pluginPanel.url}?storyId=${encodeURIComponent(storyId)}`}
              title={`${pluginPanel.title} plugin panel`}
              className="h-full w-full border-0 bg-background"
              sandbox="allow-scripts allow-same-origin allow-forms"
              data-component-id={componentId('plugin', pluginName, 'panel-iframe')}
            />
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Plugin panel not found</p>
        )
      })()}
    </>
  )

  // Mobile: full-screen overlay
  if (isMobile) {
    return (
      <div
        ref={containerRef}
        className={`fixed inset-0 z-40 flex flex-col bg-background transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onTransitionEnd={handleTransitionEnd}
        data-component-id="detail-panel-root"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50" data-component-id="detail-panel-header">
          <h2 className="font-display text-lg truncate">{title}</h2>
          <Button size="icon" variant="ghost" className="size-9 text-muted-foreground/50 hover:text-foreground" onClick={onClose} data-component-id="detail-panel-close">
            <X className="size-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-hidden" data-component-id="detail-panel-content">
          {panelContent}
        </div>
      </div>
    )
  }

  // Desktop: inline animated panel
  return (
    <div
      ref={containerRef}
      onTransitionEnd={handleTransitionEnd}
      className="border-r border-border/50 flex flex-col bg-background shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out"
      style={{ width: visible ? panelWidth : 0, opacity: visible ? 1 : 0 }}
      data-component-id="detail-panel-root"
    >
      <div className="flex flex-col h-full" style={{ width: panelWidth, minWidth: panelWidth }} data-component-id={componentId('detail-panel-section', activeSection)}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50" data-component-id="detail-panel-header">
          <h2 className="font-display text-lg truncate">{title}</h2>
          <Button size="icon" variant="ghost" className="size-7 text-muted-foreground/50 hover:text-foreground" onClick={onClose} data-component-id="detail-panel-close">
            <X className="size-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden" data-component-id="detail-panel-content">
          {panelContent}
        </div>
      </div>
    </div>
  )
}
