import { useState, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  parseSillyTavernLorebook,
  type ParsedLorebook,
  type ImportableItem,
  type ImportableItemType,
} from '@/lib/importers/tavern-card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileDropDialog } from '@/components/ui/file-drop-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Check, BookOpen, User, FileText, ScrollText, Pin, ChevronDown, Loader2 } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────

interface ItemState {
  enabled: boolean
  typeOverride: ImportableItemType | null
}

interface LorebookImportDialogProps {
  storyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: ParsedLorebook | null
  onImported?: () => void
}

// ── Constants ──────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ImportableItemType, { label: string; icon: typeof User; className: string }> = {
  character: { label: 'Character', icon: User, className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  knowledge: { label: 'Knowledge', icon: BookOpen, className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  guideline: { label: 'Guideline', icon: ScrollText, className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  prose: { label: 'Prose', icon: FileText, className: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
}

// ── Component ──────────────────────────────────────────────────────────

export function LorebookImportDialog({
  storyId,
  open,
  onOpenChange,
  initialData,
  onImported,
}: LorebookImportDialogProps) {
  const queryClient = useQueryClient()

  const [lorebookData, setLorebookData] = useState<ParsedLorebook | null>(null)
  const [itemStates, setItemStates] = useState<Map<string, ItemState>>(new Map())
  const [parseError, setParseError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setLorebookData(null)
      setItemStates(new Map())
      setParseError(null)
      return
    }
    if (initialData) {
      loadLorebook(initialData)
    }
  }, [open, initialData])

  const loadLorebook = useCallback((parsed: ParsedLorebook) => {
    setLorebookData(parsed)
    setParseError(null)
    const states = new Map<string, ItemState>()
    for (const item of parsed.items) {
      states.set(item.key, { enabled: item.enabled, typeOverride: null })
    }
    setItemStates(states)
  }, [])

  const handleFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseSillyTavernLorebook(text)
      if (parsed) {
        loadLorebook(parsed)
      } else {
        setParseError('This file does not contain a recognized SillyTavern lorebook format.')
      }
    } catch {
      setParseError('Could not read file.')
    }
  }, [loadLorebook])

  const toggleItem = useCallback((key: string) => {
    setItemStates((prev) => {
      const next = new Map(prev)
      const state = next.get(key)
      if (state) next.set(key, { ...state, enabled: !state.enabled })
      return next
    })
  }, [])

  const setItemType = useCallback((key: string, type: ImportableItemType) => {
    setItemStates((prev) => {
      const next = new Map(prev)
      const state = next.get(key)
      if (state) next.set(key, { ...state, typeOverride: type })
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setItemStates((prev) => {
      const next = new Map(prev)
      for (const [key, state] of next) next.set(key, { ...state, enabled: true })
      return next
    })
  }, [])

  const deselectAll = useCallback(() => {
    setItemStates((prev) => {
      const next = new Map(prev)
      for (const [key, state] of next) next.set(key, { ...state, enabled: false })
      return next
    })
  }, [])

  const importMutation = useMutation({
    mutationFn: async (items: Array<ImportableItem & { finalType: ImportableItemType }>) => {
      const results = []
      for (const item of items) {
        const fragment = await api.fragments.create(storyId, {
          type: item.finalType,
          name: item.name,
          description: item.description,
          content: item.content,
          tags: item.tags,
          meta: item.meta,
        })

        if (item.sticky) {
          await api.fragments.toggleSticky(storyId, fragment.id, true)
        }

        if (item.placement === 'system') {
          await api.fragments.setPlacement(storyId, fragment.id, 'system')
        }

        results.push(fragment)
      }
      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      onOpenChange(false)
      onImported?.()
    },
  })

  const selectedItems = lorebookData?.items.filter((item) => itemStates.get(item.key)?.enabled) ?? []
  const selectedCount = selectedItems.length
  const totalCount = lorebookData?.items.length ?? 0

  const handleImport = useCallback(() => {
    const toImport = selectedItems.map((item) => {
      const state = itemStates.get(item.key)
      return { ...item, finalType: state?.typeOverride ?? item.suggestedType }
    })
    importMutation.mutate(toImport)
  }, [selectedItems, itemStates, importMutation])

  const hasData = lorebookData !== null

  return (
    <FileDropDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import Lorebook"
      description={hasData
        ? `${lorebookData.book.name || 'Untitled lorebook'} — ${totalCount} ${totalCount === 1 ? 'entry' : 'entries'}`
        : 'SillyTavern lorebook JSON file'
      }
      contentClassName={`transition-[max-width] duration-300 ${hasData ? 'max-w-2xl' : 'max-w-[480px]'}`}
    >
      {!hasData && (
        <FileDropDialog.Dropzone
          onFiles={handleFiles}
          accept=".json,application/json"
          label="Drop lorebook JSON"
          hint="SillyTavern world info / lorebook .json files"
          icon={<BookOpen className="size-7" aria-hidden="true" />}
        />
      )}

      {hasData && (
        <FileDropDialog.Preview>
          <div className="flex items-center gap-3 text-[0.6875rem]">
            <button
              onClick={selectAll}
              className="text-primary/60 hover:text-primary transition-colors"
            >
              Select all
            </button>
            <span className="text-border/60">/</span>
            <button
              onClick={deselectAll}
              className="text-muted-foreground hover:text-muted-foreground transition-colors"
            >
              Deselect all
            </button>
            <span className="ml-auto text-muted-foreground tabular-nums">
              {selectedCount} selected
            </span>
          </div>

          <ScrollArea className="flex-1 min-h-0 -mx-1 px-1">
            <div className="space-y-1 pb-1">
              {lorebookData.items.map((item) => (
                <ItemRow
                  key={item.key}
                  item={item}
                  state={itemStates.get(item.key) ?? { enabled: false, typeOverride: null }}
                  onToggle={() => toggleItem(item.key)}
                  onTypeChange={(type) => setItemType(item.key, type)}
                />
              ))}
            </div>
          </ScrollArea>
        </FileDropDialog.Preview>
      )}

      <FileDropDialog.Errors>{parseError}</FileDropDialog.Errors>

      {importMutation.isError && (
        <FileDropDialog.Errors>Import failed. Please try again.</FileDropDialog.Errors>
      )}

      <FileDropDialog.Actions
        meta={hasData ? `${selectedCount} of ${totalCount} selected` : undefined}
      >
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        {hasData && (
          <Button
            size="sm"
            disabled={selectedCount === 0 || importMutation.isPending}
            onClick={handleImport}
            className="gap-1.5"
          >
            {importMutation.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                Import {selectedCount} {selectedCount === 1 ? 'Entry' : 'Entries'}
              </>
            )}
          </Button>
        )}
      </FileDropDialog.Actions>
    </FileDropDialog>
  )
}

// ── Item row ──────────────────────────────────────────────────────────

function ItemRow({
  item,
  state,
  onToggle,
  onTypeChange,
}: {
  item: ImportableItem
  state: ItemState
  onToggle: () => void
  onTypeChange: (type: ImportableItemType) => void
}) {
  const activeType = state.typeOverride ?? item.suggestedType
  const config = TYPE_CONFIG[activeType]
  const Icon = config.icon

  return (
    <div
      className={`group relative flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-all duration-150 cursor-pointer ${
        state.enabled ? 'bg-muted/40 hover:bg-muted/60' : 'opacity-50 hover:opacity-70'
      }`}
      onClick={onToggle}
    >
      <Checkbox
        checked={state.enabled}
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={() => onToggle()}
        className="mt-0.5 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium truncate leading-tight">{item.name}</span>
          {item.sticky && <Pin className="size-3 text-muted-foreground shrink-0" />}
        </div>

        <p className="text-[0.6875rem] text-muted-foreground line-clamp-1 leading-relaxed">
          {item.content.slice(0, 120)}
        </p>

        {item.tags.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {item.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[0.5625rem] px-1.5 py-0.5 rounded-md bg-muted-foreground/[0.06] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {item.tags.length > 4 && (
              <span className="text-[0.5625rem] text-muted-foreground">+{item.tags.length - 4}</span>
            )}
          </div>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className={`shrink-0 flex items-center gap-1 text-[0.625rem] h-5 px-1.5 rounded-md border transition-colors ${config.className} hover:opacity-80`}
          >
            <Icon className="size-3" />
            <span>{config.label}</span>
            <ChevronDown className="size-2.5 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[140px]">
          {(Object.entries(TYPE_CONFIG) as Array<[ImportableItemType, typeof TYPE_CONFIG.character]>).map(
            ([type, cfg]) => {
              const TypeIcon = cfg.icon
              return (
                <DropdownMenuItem
                  key={type}
                  onClick={(e) => { e.stopPropagation(); onTypeChange(type) }}
                  className="gap-2 text-xs"
                >
                  <TypeIcon className="size-3.5" />
                  {cfg.label}
                  {type === activeType && <Check className="size-3 ml-auto text-primary" />}
                </DropdownMenuItem>
              )
            },
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
