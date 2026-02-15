import { useEffect, useState } from 'react'
import type { PluginPanelProps } from '@/lib/plugin-panels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ACTION_LABELS,
  DEFAULT_BINDINGS,
  eventCombo,
  loadBindingsForStory,
  saveBindingsForStory,
  storageKeyForStory,
  type ActionId,
  type Bindings,
} from './shared'

export function KeybindsPanel({ storyId }: PluginPanelProps) {
  const [bindings, setBindings] = useState<Bindings>(() => loadBindingsForStory(storyId))
  const [captureAction, setCaptureAction] = useState<ActionId | null>(null)

  useEffect(() => {
    setBindings(loadBindingsForStory(storyId))
  }, [storyId])

  useEffect(() => {
    saveBindingsForStory(storyId, bindings)
  }, [bindings, storyId])

  return (
    <div className="p-3 space-y-3 text-xs">
      <p className="text-muted-foreground/70">
        Configure shortcuts for this story. They work globally while this story page is open.
      </p>

      {(Object.keys(ACTION_LABELS) as ActionId[]).map((action) => (
        <div key={action} className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground/80">{ACTION_LABELS[action]}</label>
          <div className="flex gap-1.5">
            <Input
              value={captureAction === action ? 'Press keys...' : bindings[action]}
              readOnly
              className="h-7 text-xs font-mono bg-transparent"
              onFocus={() => setCaptureAction(action)}
              onBlur={() => setCaptureAction((a) => (a === action ? null : a))}
              onKeyDown={(e) => {
                e.preventDefault()
                const combo = eventCombo(e.nativeEvent)
                if (!combo) return
                setBindings((prev) => ({ ...prev, [action]: combo }))
                setCaptureAction(null)
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => setBindings((prev) => ({ ...prev, [action]: DEFAULT_BINDINGS[action] }))}
            >
              Reset
            </Button>
          </div>
        </div>
      ))}

      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => setBindings(DEFAULT_BINDINGS)}
        >
          Reset all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px]"
          onClick={() => {
            localStorage.removeItem(storageKeyForStory(storyId))
            setBindings(DEFAULT_BINDINGS)
          }}
        >
          Clear saved
        </Button>
      </div>
    </div>
  )
}
