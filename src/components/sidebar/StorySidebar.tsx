import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api, type StoryMeta } from '@/lib/api'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import {
  Info,
  Users,
  BookOpen,
  Database,
  Image,
  Settings,
  ChevronRight,
  Sparkles,
  ArrowUpDown,
  Layers,
  Archive,
  Keyboard,
  Wrench,
  Book,
  Hash,
  PenLine,
  Home,
  CircleHelp,
  GitBranch,
} from 'lucide-react'
import { useHelp } from '@/hooks/use-help'
import { componentId } from '@/lib/dom-ids'

export type SidebarSection =
  | 'story-info'
  | 'characters'
  | 'guidelines'
  | 'knowledge'
  | 'media'
  | 'archive'
  | 'branches'
  | 'context-order'
  | 'agent-context'
  | 'settings'
  | 'agent-activity'
  | `plugin-${string}`
  | null

interface StorySidebarProps {
  storyId: string
  story: StoryMeta | undefined
  activeSection: SidebarSection
  onSectionChange: (section: SidebarSection) => void
  enabledPanelPlugins: Array<{
    name: string
    title: string
    mode?: 'react' | 'iframe'
    url?: string
    showInSidebar?: boolean
    icon?: { type: 'lucide'; name: string } | { type: 'svg'; src: string }
  }>
}

const LUCIDE_ICON_MAP = {
  Sparkles,
  Keyboard,
  Wrench,
  Book,
  Hash,
} as const

function PluginIcon({ icon }: { icon?: { type: 'lucide'; name: string } | { type: 'svg'; src: string } }) {
  if (icon?.type === 'svg' && icon.src) {
    return <img src={icon.src} alt="" className="size-4 object-contain" />
  }
  if (icon?.type === 'lucide' && icon.name) {
    const Lucide = LUCIDE_ICON_MAP[icon.name as keyof typeof LUCIDE_ICON_MAP]
    if (Lucide) {
      return <Lucide className="size-4" />
    }
  }
  return <Sparkles className="size-4" />
}

const FRAGMENT_SECTIONS = [
  { id: 'guidelines' as const, label: 'Guidelines', icon: BookOpen },
  { id: 'characters' as const, label: 'Characters', icon: Users },
  { id: 'knowledge' as const, label: 'Knowledge', icon: Database },
]

export function StorySidebar({
  storyId,
  story,
  activeSection,
  onSectionChange,
  enabledPanelPlugins,
}: StorySidebarProps) {
  const { openHelp } = useHelp()
  const queryClient = useQueryClient()
  const [isDragOverArchive, setIsDragOverArchive] = useState(false)

  const archiveMutation = useMutation({
    mutationFn: (fragmentId: string) => api.fragments.archive(storyId, fragmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['fragments-archived', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    },
  })

  const handleToggle = (section: SidebarSection) => {
    onSectionChange(activeSection === section ? null : section)
  }

  return (
    <Sidebar collapsible="icon" data-component-id="story-sidebar">
      <SidebarHeader>
        <div className="flex items-center justify-between px-2 py-1.5" data-component-id="story-sidebar-header">
          <Link to="/" className="flex items-center gap-1.5 truncate hover:opacity-80 transition-opacity" title="Back to stories">
            <Home className="size-4 shrink-0 opacity-60" />
            <span className="font-display text-base italic truncate group-data-[collapsible=icon]:hidden">
              {story?.name ?? 'Errata'}
            </span>
          </Link>
          <SidebarTrigger
            className="group-data-[collapsible=icon]:-ml-[0.4em]"
            data-component-id="sidebar-collapse-trigger"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Navigation */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === null}
                  onClick={() => onSectionChange(null)}
                  tooltip="Story"
                  data-component-id="sidebar-story-link"
                >
                  <PenLine className="size-4" />
                  <span>Story</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === 'story-info'}
                  onClick={() => handleToggle('story-info')}
                  tooltip="Info"
                  data-component-id="sidebar-section-story-info"
                >
                  <Info className="size-4" />
                  <span>Info</span>
                  <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === 'agent-activity'}
                  onClick={() => handleToggle('agent-activity')}
                  tooltip="Librarian"
                  data-component-id="sidebar-section-agent-activity"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" stroke="url(#librarian-grad)" />
                    <path d="m9 9.5 2 2 4-4" stroke="url(#librarian-grad2)" />
                    <defs>
                      <linearGradient id="librarian-grad" x1="4" y1="2" x2="20" y2="22">
                        <stop offset="0%" stopColor="#f59e0b" />
                        <stop offset="100%" stopColor="#8b5cf6" />
                      </linearGradient>
                      <linearGradient id="librarian-grad2" x1="9" y1="7.5" x2="15" y2="11.5">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#ec4899" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <span>Librarian</span>
                  <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Fragments */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[0.625rem] uppercase tracking-widest text-muted-foreground font-medium">
            Fragments
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {FRAGMENT_SECTIONS.map((section) => (
                <SidebarMenuItem key={section.id}>
                  <SidebarMenuButton
                    isActive={activeSection === section.id}
                    onClick={() => handleToggle(section.id)}
                    tooltip={section.label}
                    data-component-id={componentId('sidebar-section', section.id)}
                  >
                    <section.icon className="size-4" />
                    <span>{section.label}</span>
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel className="text-[0.625rem] uppercase tracking-widest text-muted-foreground font-medium">
            Management
          </SidebarGroupLabel>
          <SidebarGroupContent>
              <SidebarMenu>
              {story?.settings.contextOrderMode === 'advanced' && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeSection === 'agent-context'}
                      onClick={() => handleToggle('agent-context')}
                      tooltip="Agents"
                      data-component-id="sidebar-section-agent-context"
                    >
                      <Layers className="size-4" />
                      <span>Agents</span>
                      <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeSection === 'context-order'}
                      onClick={() => handleToggle('context-order')}
                      tooltip="Fragment Order"
                      data-component-id="sidebar-section-context-order"
                    >
                      <ArrowUpDown className="size-4" />
                      <span>Fragment Order</span>
                      <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}

                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={activeSection === 'branches'}
                    onClick={() => handleToggle('branches')}
                    tooltip="Timelines"
                    data-component-id="sidebar-section-branches"
                  >
                    <GitBranch className="size-4" />
                    <span>Timelines</span>
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem key={"media"}>
                  <SidebarMenuButton
                    isActive={activeSection === 'media'}
                    onClick={() => handleToggle('media')}
                    tooltip="Media"
                    data-component-id="sidebar-section-media"
                  >
                    <Image className="size-4" />
                    <span>Media</span>
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                  </SidebarMenuButton>
                </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === 'archive'}
                  onClick={() => handleToggle('archive')}
                  tooltip="Archive"
                  data-component-id="sidebar-section-archive"
                  className={isDragOverArchive ? 'ring-1 ring-primary/50 bg-accent' : undefined}
                  onDragOver={(e: React.DragEvent) => {
                    if (e.dataTransfer.types.includes('application/x-errata-fragment-id')) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }
                  }}
                  onDragEnter={(e: React.DragEvent) => {
                    if (e.dataTransfer.types.includes('application/x-errata-fragment-id')) {
                      setIsDragOverArchive(true)
                    }
                  }}
                  onDragLeave={(e: React.DragEvent) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setIsDragOverArchive(false)
                    }
                  }}
                  onDrop={(e: React.DragEvent) => {
                    e.preventDefault()
                    setIsDragOverArchive(false)
                    const fragmentId = e.dataTransfer.getData('application/x-errata-fragment-id')
                    if (fragmentId) archiveMutation.mutate(fragmentId)
                  }}
                >
                  <Archive className="size-4" />
                  <span>Archive</span>
                  <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Plugins */}
        {enabledPanelPlugins.length > 0 && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel className="text-[0.625rem] uppercase tracking-widest text-muted-foreground font-medium">
                Plugins
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {enabledPanelPlugins.map((plugin) => (
                    <SidebarMenuItem key={plugin.name}>
                      <SidebarMenuButton
                        isActive={activeSection === `plugin-${plugin.name}`}
                        onClick={() => handleToggle(`plugin-${plugin.name}`)}
                        tooltip={plugin.title}
                        data-component-id={componentId('sidebar-plugin', plugin.name)}
                      >
                        <PluginIcon icon={plugin.icon} />
                        <span>{plugin.title}</span>
                        <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}

      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => openHelp()}
              tooltip="Help"
              data-component-id="sidebar-help-button"
            >
              <CircleHelp className="size-4" />
              <span>Help</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeSection === 'settings'}
              onClick={() => handleToggle('settings')}
              tooltip="Settings"
              data-component-id="sidebar-section-settings"
            >
              <Settings className="size-4" />
              <span>Settings</span>
              <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
