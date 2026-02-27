import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SlidersHorizontal, Radio } from 'lucide-react'
import { AgentConfigurePanel } from './AgentConfigurePanel'
import { AgentActivityPanel } from './AgentActivityPanel'

interface AgentsPanelProps {
  storyId: string
}

export function AgentsPanel({ storyId }: AgentsPanelProps) {
  const [tab, setTab] = useState<'activity' | 'configure'>('configure')

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as 'activity' | 'configure')}
      className="h-full flex flex-col gap-0"
    >
      <div className="shrink-0 px-4 pt-3">
        <TabsList variant="line" className="w-full h-8 gap-0">
          <TabsTrigger value="configure" className="text-[0.6875rem] gap-1.5 flex-1 px-1">
            <SlidersHorizontal className="size-3" />
            Configure
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-[0.6875rem] gap-1.5 flex-1 px-1">
            <Radio className="size-3" />
            Activity
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="activity" className="flex-1 min-h-0 mt-0">
        <AgentActivityPanel storyId={storyId} />
      </TabsContent>

      <TabsContent value="configure" className="flex-1 min-h-0 mt-0">
        <AgentConfigurePanel storyId={storyId} />
      </TabsContent>
    </Tabs>
  )
}
