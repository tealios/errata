import { useState, useEffect, useRef } from 'react'
import type { Fragment, StoryMeta } from '@/lib/api'
import type { SidebarSection } from './StorySidebar'
import { getPluginPanel } from '@/lib/plugin-panels'
import { FragmentList } from '@/components/fragments/FragmentList'
import { ContextOrderPanel } from '@/components/fragments/ContextOrderPanel'
import { StoryInfoPanel } from './StoryInfoPanel'
import { SettingsPanel } from './SettingsPanel'
import { LibrarianPanel } from './LibrarianPanel'
import { ArchivePanel } from './ArchivePanel'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X } from 'lucide-react'

interface DetailPanelProps {
  storyId: string
  story: StoryMeta
  section: SidebarSection
  onClose: () => void
  onSelectFragment: (fragment: Fragment) => void
  onCreateFragment: (type: string, prefill?: { name: string; description: string; content: string }) => void
  selectedFragmentId?: string
  onManageProviders: () => void
}

const SECTION_TITLES: Record<string, string> = {
  'story-info': 'Story Info',
  characters: 'Characters',
  guidelines: 'Guidelines',
  knowledge: 'Knowledge',
  media: 'Media',
  archive: 'Archive',
  'context-order': 'Context Order',
  settings: 'Settings',
  'agent-activity': 'Agent Activity',
}

const SECTION_TO_TYPE: Record<string, string> = {
  characters: 'character',
  guidelines: 'guideline',
  knowledge: 'knowledge',
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
}: DetailPanelProps) {
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

  const panelWidth = activeSection === 'agent-activity' ? 400 : activeSection === 'story-info' ? 440 : activeSection === 'settings' ? 400 : activeSection === 'context-order' ? 380 : activeSection === 'archive' ? 340 : 340

  return (
    <div
      ref={containerRef}
      onTransitionEnd={handleTransitionEnd}
      className="border-r border-border/50 flex flex-col bg-background shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out"
      style={{ width: visible ? panelWidth : 0, opacity: visible ? 1 : 0 }}
    >
      <div className="flex flex-col h-full" style={{ width: panelWidth, minWidth: panelWidth }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{title}</h3>
          <Button size="icon" variant="ghost" className="size-6 text-muted-foreground/50 hover:text-foreground" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeSection === 'story-info' && (
            <ScrollArea className="h-full">
              <StoryInfoPanel storyId={storyId} story={story} />
            </ScrollArea>
          )}

          {activeSection === 'settings' && (
            <ScrollArea className="h-full">
              <SettingsPanel storyId={storyId} story={story} onManageProviders={onManageProviders} />
            </ScrollArea>
          )}

          {activeSection === 'context-order' && (
            <ContextOrderPanel storyId={storyId} story={story} />
          )}

          {activeSection === 'agent-activity' && (
            <LibrarianPanel
              storyId={storyId}
              onCreateFragment={(type, prefill) => {
                onCreateFragment(type, prefill)
              }}
            />
          )}

          {activeSection === 'archive' && (
            <ArchivePanel storyId={storyId} />
          )}

          {SECTION_TO_TYPE[activeSection] && (
            <FragmentList
              storyId={storyId}
              type={SECTION_TO_TYPE[activeSection]}
              onSelect={onSelectFragment}
              onCreateNew={() => onCreateFragment(SECTION_TO_TYPE[activeSection])}
              selectedId={selectedFragmentId}
            />
          )}

          {activeSection === 'media' && (
            <FragmentList
              storyId={storyId}
              allowedTypes={['image', 'icon']}
              onSelect={onSelectFragment}
              onCreateNew={() => onCreateFragment('image')}
              selectedId={selectedFragmentId}
            />
          )}

          {isPlugin && pluginName && (() => {
            const PanelComponent = getPluginPanel(pluginName)
            return PanelComponent ? (
              <ScrollArea className="h-full">
                <PanelComponent storyId={storyId} />
              </ScrollArea>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Plugin panel not found</p>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
