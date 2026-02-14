import type { Fragment, StoryMeta } from '@/lib/api'
import type { SidebarSection } from './StorySidebar'
import { getPluginPanel } from '@/lib/plugin-panels'
import { FragmentList } from '@/components/fragments/FragmentList'
import { StoryInfoPanel } from './StoryInfoPanel'
import { SettingsPanel } from './SettingsPanel'
import { LibrarianPanel } from './LibrarianPanel'
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
}

const SECTION_TITLES: Record<string, string> = {
  'story-info': 'Story Info',
  characters: 'Characters',
  guidelines: 'Guidelines',
  knowledge: 'Knowledge Base',
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
}: DetailPanelProps) {
  if (!section) return null

  const isPlugin = section?.startsWith('plugin-')
  const pluginName = isPlugin ? section.replace('plugin-', '') : null
  const title = isPlugin
    ? pluginName ?? 'Plugin'
    : SECTION_TITLES[section] ?? section

  return (
    <div className="w-[300px] border-r flex flex-col bg-background shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button size="icon" variant="ghost" className="size-6" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {section === 'story-info' && (
          <ScrollArea className="h-full">
            <StoryInfoPanel storyId={storyId} story={story} />
          </ScrollArea>
        )}

        {section === 'settings' && (
          <ScrollArea className="h-full">
            <SettingsPanel storyId={storyId} story={story} />
          </ScrollArea>
        )}

        {section === 'agent-activity' && (
          <LibrarianPanel
            storyId={storyId}
            onCreateFragment={(type, prefill) => {
              onCreateFragment(type, prefill)
            }}
          />
        )}

        {SECTION_TO_TYPE[section] && (
          <FragmentList
            storyId={storyId}
            type={SECTION_TO_TYPE[section]}
            onSelect={onSelectFragment}
            onCreateNew={() => onCreateFragment(SECTION_TO_TYPE[section])}
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
  )
}
