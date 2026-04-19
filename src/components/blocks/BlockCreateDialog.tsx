import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Code2, FileText, Monitor, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { componentId } from '@/lib/dom-ids'

interface BlockCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: {
    name: string
    role: 'system' | 'user'
    type: 'simple' | 'script'
    content: string
  }) => void
}

export function BlockCreateDialog({ open, onOpenChange, onSubmit }: BlockCreateDialogProps) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<'system' | 'user'>('user')
  const [type, setType] = useState<'simple' | 'script'>('simple')
  const [content, setContent] = useState('')

  const handleSubmit = () => {
    if (!name.trim() || !content.trim()) return
    onSubmit({ name: name.trim(), role, type, content })
    setName('')
    setRole('user')
    setType('simple')
    setContent('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[85vh] flex flex-col overflow-hidden" data-component-id="block-create-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">New Custom Block</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 py-1 pr-1">
          {/* Name */}
          <div>
            <h4 className="text-[0.5625rem] text-muted-foreground uppercase tracking-[0.15em] font-medium mb-2">
              Name
            </h4>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. World Rules, Tone Guide..."
              autoFocus
              className="h-9"
              data-component-id="block-create-name"
            />
          </div>

          {/* Role + Type selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-[0.5625rem] text-muted-foreground uppercase tracking-[0.15em] font-medium mb-2">
                Role
              </h4>
              <div className="flex rounded-lg bg-muted/25 p-[3px] gap-[3px]">
                {([
                  { value: 'system' as const, label: 'System', Icon: Monitor },
                  { value: 'user' as const, label: 'User', Icon: User },
                ]).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 px-2 py-[6px] rounded-md text-[0.6875rem] font-medium transition-all duration-150',
                    role === value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-muted-foreground',
                  )}
                  onClick={() => setRole(value)}
                  data-component-id={componentId('block-create-role', value)}
                >
                  <Icon className="size-3" />
                  {label}
                </button>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-[0.5625rem] text-muted-foreground uppercase tracking-[0.15em] font-medium mb-2">
                Type
              </h4>
              <div className="flex rounded-lg bg-muted/25 p-[3px] gap-[3px]">
                {([
                  { value: 'simple' as const, label: 'Text', Icon: FileText },
                  { value: 'script' as const, label: 'Script', Icon: Code2 },
                ]).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 px-2 py-[6px] rounded-md text-[0.6875rem] font-medium transition-all duration-150',
                    type === value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-muted-foreground',
                  )}
                  onClick={() => setType(value)}
                  data-component-id={componentId('block-create-type', value)}
                >
                  <Icon className="size-3" />
                  {label}
                </button>
                ))}
              </div>
            </div>
          </div>

          {/* Content */}
          <div>
            <h4 className="text-[0.5625rem] text-muted-foreground uppercase tracking-[0.15em] font-medium mb-2">
              Content
            </h4>

            {type === 'script' && (
              <div className="mb-2.5 rounded-md bg-amber-500/5 border border-amber-500/10 px-3 py-2">
                <p className="text-[0.625rem] text-amber-600/70 dark:text-amber-400/70 leading-relaxed">
                  Write a JS function body that returns a string. Access story data via <code className="font-mono bg-amber-500/10 px-1 rounded text-[0.625rem]">ctx</code>: ctx.story, ctx.proseFragments, ctx.authorInput, etc.
                </p>
              </div>
            )}

            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                type === 'script'
                  ? 'return `Word count: ${ctx.proseFragments.reduce((n, f) => n + f.content.split(" ").length, 0)}`'
                  : 'Block content...'
              }
              rows={6}
              className={cn('text-xs resize-y min-h-32 max-h-[40vh] overflow-y-auto', type === 'script' && 'font-mono bg-muted/15')}
              data-component-id="block-create-content"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-3 border-t border-border/30">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-xs" data-component-id="block-create-cancel">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || !content.trim()} className="text-xs gap-1.5" data-component-id="block-create-submit">
            Create Block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
