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
  Settings,
  ChevronRight,
  Sparkles,
  Activity,
} from 'lucide-react'

export type SidebarSection =
  | 'story-info'
  | 'characters'
  | 'guidelines'
  | 'knowledge'
  | 'settings'
  | 'agent-activity'
  | `plugin-${string}`
  | null

interface StorySidebarProps {
  storyId: string
  story: StoryMeta | undefined
  activeSection: SidebarSection
  onSectionChange: (section: SidebarSection) => void
  enabledPanelPlugins: Array<{ name: string; title: string }>
}

const FRAGMENT_SECTIONS = [
  { id: 'characters' as const, label: 'Characters', icon: Users },
  { id: 'guidelines' as const, label: 'Guidelines', icon: BookOpen },
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
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="font-display text-base italic truncate group-data-[collapsible=icon]:hidden">
            {story?.name ?? 'Errata'}
          </span>
          <SidebarTrigger />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Navigation */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Home">
                  <Link to="/">
                    <Home className="size-4" />
                    <span>Home</span>
                  </Link>
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
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === 'story-info'}
                  onClick={() => handleToggle('story-info')}
                  tooltip="Story Info"
                >
                  <Info className="size-4" />
                  <span>Story Info</span>
                  <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40" />
                </SidebarMenuButton>
              </SidebarMenuItem>

              {FRAGMENT_SECTIONS.map((section) => (
                <SidebarMenuItem key={section.id}>
                  <SidebarMenuButton
                    isActive={activeSection === section.id}
                    onClick={() => handleToggle(section.id)}
                    tooltip={section.label}
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
            Agent
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeSection === 'agent-activity'}
                  onClick={() => handleToggle('agent-activity')}
                  tooltip="Agent Activity"
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
