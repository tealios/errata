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
  Home,
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
} from 'lucide-react'
import { componentId } from '@/lib/dom-ids'
import { ErrataMark } from '@/components/ErrataLogo'

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
  enabledPanelPlugins: Array<{ name: string; title: string; mode?: 'react' | 'iframe'; url?: string }>
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
          <span className="flex items-center gap-1.5 truncate">
            <ErrataMark size={16} className="shrink-0 opacity-60" />
            <span className="font-display text-base italic truncate group-data-[collapsible=icon]:hidden">
              {story?.name ?? 'Errata'}
            </span>
          </span>
          <SidebarTrigger data-component-id="sidebar-collapse-trigger" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Navigation */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Home" data-component-id="sidebar-home-link">
                  <Link to="/">
                    <Home className="size-4" />
                    <span>Home</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === 'story-info'}
                  onClick={() => handleToggle('story-info')}
                  tooltip="Story Info"
                  data-component-id="sidebar-section-story-info"
                >
                  <Info className="size-4" />
                  <span>Story Info</span>
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
                        <Sparkles className="size-4" />
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
