import { useState, useEffect, useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  parseCardJson,
  type ParsedCharacterCard,
  type ImportableItem,
  type ImportableItemType,
} from '@/lib/importers/tavern-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileDropDialog } from '@/components/ui/file-drop-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Check,
  Globe,
  BookOpen,
  User,
  FileText,
  ScrollText,
  Pin,
  ChevronDown,
  Loader2,
  Link as LinkIcon,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────

interface ItemState {
  enabled: boolean
  typeOverride: ImportableItemType | null
}

interface CharacterCardImportDialogProps {
  storyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialCardData?: ParsedCharacterCard | null
  imageDataUrl?: string | null
  onImported?: () => void
}

// ── Constants ──────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ImportableItemType, { label: string; icon: typeof User; className: string }> = {
  character: { label: 'Character', icon: User, className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  knowledge: { label: 'Knowledge', icon: BookOpen, className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  guideline: { label: 'Guideline', icon: ScrollText, className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  prose: { label: 'Prose', icon: FileText, className: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
}

const SOURCE_GROUPS = [
  { key: 'character', label: 'Character', sources: ['main-character'] as const },
  { key: 'extras', label: 'Card Extras', sources: ['scenario', 'first-message', 'system-prompt'] as const },
  { key: 'lorebook', label: 'Lorebook', sources: ['lorebook-entry'] as const },
] as const

// ── Component ──────────────────────────────────────────────────────────

export function CharacterCardImportDialog({
  storyId,
  open,
  onOpenChange,
  initialCardData,
  imageDataUrl,
  onImported,
}: CharacterCardImportDialogProps) {
  const queryClient = useQueryClient()
  const urlInputRef = useRef<HTMLInputElement>(null)

  const [cardData, setCardData] = useState<ParsedCharacterCard | null>(null)
  const [itemStates, setItemStates] = useState<Map<string, ItemState>>(new Map())
  const [parseError, setParseError] = useState<string | null>(null)
  const [urlFetching, setUrlFetching] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)

  // Initialize from props
  useEffect(() => {
    if (!open) {
      setCardData(null)
      setItemStates(new Map())
      setParseError(null)
      setUrlFetching(false)
      setUrlError(null)
      return
    }
    if (initialCardData) {
      loadCard(initialCardData)
    }
  }, [open, initialCardData])

  const loadCard = useCallback((parsed: ParsedCharacterCard) => {
    setCardData(parsed)
    setParseError(null)
    setUrlError(null)
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
      const parsed = parseCardJson(text)
      if (parsed) {
        loadCard(parsed)
      } else {
        setParseError('This file does not contain a recognized character card format.')
      }
    } catch {
      setParseError('Could not read file.')
    }
  }, [loadCard])

  const handleUrlFetch = useCallback(async () => {
    const url = urlInputRef.current?.value?.trim()
    if (!url) return
    setUrlFetching(true)
    setUrlError(null)
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const text = await response.text()
      const parsed = parseCardJson(text)
      if (parsed) {
        loadCard(parsed)
      } else {
        setUrlError('Response is not a recognized character card format.')
      }
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Failed to fetch URL.')
    } finally {
      setUrlFetching(false)
    }
  }, [loadCard])

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleUrlFetch()
    }
  }, [handleUrlFetch])

  // ── Item state management ──────────────────────────────────────────

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
      for (const [key, state] of next) {
        next.set(key, { ...state, enabled: true })
      }
      return next
    })
  }, [])

  const deselectAll = useCallback(() => {
    setItemStates((prev) => {
      const next = new Map(prev)
      for (const [key, state] of next) {
        next.set(key, { ...state, enabled: false })
      }
      return next
    })
  }, [])

  // ── Import mutation ────────────────────────────────────────────────

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

        if (item.finalType === 'prose') {
          await api.proseChain.addSection(storyId, fragment.id)
        }

        results.push(fragment)
      }
      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['prose-chain', storyId] })
      onOpenChange(false)
      onImported?.()
    },
  })

  // ── Derived state ──────────────────────────────────────────────────

  const selectedItems = cardData?.items.filter((item) => {
    const state = itemStates.get(item.key)
    return state?.enabled
  }) ?? []

  const selectedCount = selectedItems.length
  const totalCount = cardData?.items.length ?? 0

  const handleImport = useCallback(() => {
    const toImport = selectedItems.map((item) => {
      const state = itemStates.get(item.key)
      return { ...item, finalType: state?.typeOverride ?? item.suggestedType }
    })
    importMutation.mutate(toImport)
  }, [selectedItems, itemStates, importMutation])

  const hasCard = cardData !== null

  const description = hasCard ? (
    <span className="flex items-center gap-2">
      <span className="font-medium text-foreground/70">{cardData.card.name}</span>
      {cardData.card.spec && (
        <Badge variant="outline" className="text-[0.5625rem] h-4 px-1.5 border-border/40 text-muted-foreground">
          {cardData.card.spec}
        </Badge>
      )}
      {cardData.card.creator && (
        <span className="text-muted-foreground">by {cardData.card.creator}</span>
      )}
      <span className="text-muted-foreground ml-auto tabular-nums">
        {totalCount} {totalCount === 1 ? 'entry' : 'entries'}
      </span>
    </span>
  ) : (
    'JSON character card with optional lorebook entries'
  )

  return (
    <FileDropDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import Character Card"
      description={description}
      contentClassName={`transition-[max-width] duration-300 ${hasCard ? 'max-w-2xl' : 'max-w-[480px]'}`}
    >
      {!hasCard && (
        <>
          <FileDropDialog.Dropzone
            onFiles={handleFiles}
            accept=".json,application/json"
            label="Drop character card JSON"
            hint="V2 or V3 character card .json files"
            icon={<BookOpen className="size-7" aria-hidden="true" />}
          />

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border/30" />
            <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wider">or paste URL</span>
            <div className="h-px flex-1 bg-border/30" />
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                ref={urlInputRef}
                placeholder="https://example.com/card.json"
                className="pl-8 h-9 text-sm bg-muted/20"
                onKeyDown={handleUrlKeyDown}
                disabled={urlFetching}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUrlFetch}
              disabled={urlFetching}
              className="gap-1.5 shrink-0"
            >
              {urlFetching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Globe className="size-3.5" />
              )}
              Fetch
            </Button>
          </div>
        </>
      )}

      {hasCard && (
        <FileDropDialog.Preview>
          {imageDataUrl && (
            <div className="flex items-center gap-3 mb-1">
              <img
                src={imageDataUrl}
                alt=""
                className="size-12 rounded-lg object-cover object-top border border-border/40"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{cardData.card.name}</p>
                {cardData.card.description && (
                  <p className="text-[0.6875rem] text-muted-foreground line-clamp-1">
                    {cardData.card.description}
                  </p>
                )}
              </div>
            </div>
          )}

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
            <div className="space-y-3 pb-1">
              {SOURCE_GROUPS.map((group) => {
                const groupItems = cardData.items.filter((item) =>
                  (group.sources as readonly string[]).includes(item.source),
                )
                if (groupItems.length === 0) return null

                return (
                  <div key={group.key}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                        {group.label}
                      </span>
                      <div className="h-px flex-1 bg-border/20" />
                      {group.key === 'lorebook' && (
                        <span className="text-[0.625rem] text-muted-foreground tabular-nums">
                          {groupItems.length}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {groupItems.map((item) => (
                        <ItemRow
                          key={item.key}
                          item={item}
                          state={itemStates.get(item.key) ?? { enabled: false, typeOverride: null }}
                          onToggle={() => toggleItem(item.key)}
                          onTypeChange={(type) => setItemType(item.key, type)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </FileDropDialog.Preview>
      )}

      <FileDropDialog.Errors>{parseError || urlError}</FileDropDialog.Errors>

      {importMutation.isError && (
        <FileDropDialog.Errors>Import failed. Please try again.</FileDropDialog.Errors>
      )}

      <FileDropDialog.Actions
        meta={hasCard ? `${selectedCount} of ${totalCount} selected` : undefined}
      >
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        {hasCard && (
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

// ── Item row component ────────────────────────────────────────────────

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
        state.enabled
          ? 'bg-muted/40 hover:bg-muted/60'
          : 'opacity-50 hover:opacity-70'
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
          <span className="text-sm font-medium truncate leading-tight">
            {item.name}
          </span>
          {item.sticky && (
            <Pin className="size-3 text-muted-foreground shrink-0" />
          )}
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
              <span className="text-[0.5625rem] text-muted-foreground">
                +{item.tags.length - 4}
              </span>
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
