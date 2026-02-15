import { Link } from '@tanstack/react-router'
import type { StoryMeta } from '@/lib/api'
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
  Activity,
  ArrowUpDown,
  Archive,
  Keyboard,
  Wrench,
  Book,
  Hash,
  PenLine,
  Home,
} from 'lucide-react'
import { componentId } from '@/lib/dom-ids'

export type SidebarSection =
  | 'story-info'
  | 'characters'
  | 'guidelines'
  | 'knowledge'
  | 'media'
  | 'archive'
  | 'context-order'
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
  story,
  activeSection,
  onSectionChange,
  enabledPanelPlugins,
}: StorySidebarProps) {
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
          <SidebarTrigger data-component-id="sidebar-collapse-trigger" />
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
                  <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Fragments */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium">
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
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium">
            Management
          </SidebarGroupLabel>
          <SidebarGroupContent>
              <SidebarMenu>
              {story?.settings.contextOrderMode === 'advanced' && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={activeSection === 'context-order'}
                    onClick={() => handleToggle('context-order')}
                    tooltip="Context Order"
                    data-component-id="sidebar-section-context-order"
                  >
                    <ArrowUpDown className="size-4" />
                    <span>Context Order</span>
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

                <SidebarMenuItem key={"media"}>
                  <SidebarMenuButton
                    isActive={activeSection === 'media'}
                    onClick={() => handleToggle('media')}
                    tooltip="Media"
                    data-component-id="sidebar-section-media"
                  >
                    <Image className="size-4" />
                    <span>Media</span>
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40" />
                  </SidebarMenuButton>
                </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === 'archive'}
                  onClick={() => handleToggle('archive')}
                  tooltip="Archive"
                  data-component-id="sidebar-section-archive"
                >
                  <Archive className="size-4" />
                  <span>Archive</span>
                  <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40" />
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
              <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium">
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
                        <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40" />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}

        <SidebarSeparator />

        {/* Agent Activity */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium">
            Helpers
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === 'agent-activity'}
                  onClick={() => handleToggle('agent-activity')}
                  tooltip="Agent Activity"
                  data-component-id="sidebar-section-agent-activity"
                >
                  <Activity className="size-4" />
                  <span>Librarian</span>
                  <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeSection === 'settings'}
              onClick={() => handleToggle('settings')}
              tooltip="Settings"
              data-component-id="sidebar-section-settings"
            >
              <Settings className="size-4" />
              <span>Settings</span>
              <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
