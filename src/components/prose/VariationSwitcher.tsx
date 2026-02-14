import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ProseChainEntry } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { History, Check, ChevronDown } from 'lucide-react'

interface VariationSwitcherProps {
  storyId: string
  sectionIndex: number
  entry: ProseChainEntry
}

export function VariationSwitcher({ storyId, sectionIndex, entry }: VariationSwitcherProps) {
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)

  const switchMutation = useMutation({
    mutationFn: (fragmentId: string) =>
      api.proseChain.switchVariation(storyId, sectionIndex, fragmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
      setIsOpen(false)
    },
  })

  const variationCount = entry.proseFragments.length
  if (variationCount <= 1) return null

  const variationNumber = entry.proseFragments.findIndex(f => f.id === entry.active) + 1

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] gap-1 text-muted-foreground/60 hover:text-muted-foreground"
        >
          <History className="size-3" />
          <span>{variationNumber}/{variationCount}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/50 mb-1">
          Variations
        </div>
        {entry.proseFragments.map((fragment, idx) => {
          const isActive = fragment.id === entry.active
          return (
            <DropdownMenuItem
              key={fragment.id}
              className="flex items-start gap-2 py-2 cursor-pointer"
              onClick={() => !isActive && switchMutation.mutate(fragment.id)}
              disabled={switchMutation.isPending}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground/50">
                    #{idx + 1}
                  </span>
                  {isActive && (
                    <Badge variant="secondary" className="h-4 text-[9px] px-1">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {fragment.description || fragment.name}
                </p>
                <p className="text-[10px] text-muted-foreground/50">
                  {new Date(fragment.createdAt).toLocaleDateString()}
                </p>
              </div>
              {isActive && <Check className="size-3 text-primary" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
