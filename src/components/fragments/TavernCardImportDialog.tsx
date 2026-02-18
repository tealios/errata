import { useState, useEffect, useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { importTavernCard, isTavernCardPng, parseCardJson, type ImportedCharacter, type ParsedCharacterCard } from '@/lib/importers/tavern-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { AlertCircle, Check, Plus } from 'lucide-react'

function arrayBufferToDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return `data:image/png;base64,${btoa(binary)}`
}

interface ParsedCard {
  character: ImportedCharacter
  imageDataUrl: string
}

interface TavernCardImportDialogProps {
  storyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-loaded PNG buffers (e.g. from drag-and-drop). */
  initialBuffers?: ArrayBuffer[]
  onImported?: () => void
  /** Called when a JSON character card file is detected, so the parent can route to CharacterCardImportDialog. */
  onJsonCardDetected?: (data: ParsedCharacterCard) => void
}

export function TavernCardImportDialog({
  storyId,
  open,
  onOpenChange,
  initialBuffers,
  onImported,
  onJsonCardDetected,
}: TavernCardImportDialogProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [cards, setCards] = useState<ParsedCard[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    if (!open) {
      setCards([])
      setSelected(new Set())
      setParseError(null)
      setDragOver(false)
      return
    }
    if (initialBuffers && initialBuffers.length > 0) {
      parseBuffers(initialBuffers)
    }
  }, [open, initialBuffers])

  const parseBuffers = useCallback((buffers: ArrayBuffer[]) => {
    const parsed: ParsedCard[] = []
    let skipped = 0
    for (const buffer of buffers) {
      try {
        if (!isTavernCardPng(buffer)) {
          skipped++
          continue
        }
        const character = importTavernCard(buffer)
        const imageDataUrl = arrayBufferToDataUrl(buffer)
        parsed.push({ character, imageDataUrl })
      } catch {
        skipped++
      }
    }
    if (parsed.length === 0) {
      setParseError(
        buffers.length === 1
          ? 'This PNG does not contain TavernAI character card data.'
          : `None of the ${buffers.length} PNGs contained character card data.`,
      )
      return
    }
    setCards((prev) => {
      const next = [...prev, ...parsed]
      // Auto-select newly added cards
      setSelected((prevSel) => {
        const s = new Set(prevSel)
        for (let i = prev.length; i < next.length; i++) s.add(i)
        return s
      })
      return next
    })
    setParseError(
      skipped > 0
        ? `${skipped} file${skipped > 1 ? 's' : ''} skipped (no card data found).`
        : null,
    )
  }, [])

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    // Check if any file is JSON — route to CharacterCardImportDialog
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
        try {
          const text = await file.text()
          const parsed = parseCardJson(text)
          if (parsed && onJsonCardDetected) {
            e.target.value = ''
            onJsonCardDetected(parsed)
            return
          }
        } catch { /* not a valid JSON card */ }
      }
    }

    const buffers: ArrayBuffer[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        buffers.push(await files[i].arrayBuffer())
      } catch { /* skip unreadable */ }
    }
    if (buffers.length > 0) parseBuffers(buffers)
    e.target.value = ''
  }, [parseBuffers, onJsonCardDetected])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return
    const buffers: ArrayBuffer[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        buffers.push(await files[i].arrayBuffer())
      } catch { /* skip */ }
    }
    if (buffers.length > 0) parseBuffers(buffers)
  }, [parseBuffers])

  const toggleCard = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const removeCard = useCallback((index: number) => {
    setCards((prev) => {
      const next = prev.filter((_, i) => i !== index)
      setSelected((prevSel) => {
        const s = new Set<number>()
        for (const i of prevSel) {
          if (i < index) s.add(i)
          else if (i > index) s.add(i - 1)
        }
        return s
      })
      return next
    })
  }, [])

  const importMutation = useMutation({
    mutationFn: async (toImport: ParsedCard[]) => {
      const results = []
      for (const { character, imageDataUrl } of toImport) {
        const imageFragment = await api.fragments.create(storyId, {
          type: 'image',
          name: `${character.name} (card image)`,
          description: `Character card image for ${character.name}`.slice(0, 250),
          content: imageDataUrl,
        })
        const charFragment = await api.fragments.create(storyId, {
          type: character.type,
          name: character.name,
          description: character.description,
          content: character.content,
          tags: character.tags,
          meta: {
            ...character.meta,
            visualRefs: [{ fragmentId: imageFragment.id, kind: 'image' }],
          },
        })
        results.push(charFragment)
      }
      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      onOpenChange(false)
      onImported?.()
    },
  })

  const selectedCards = cards.filter((_, i) => selected.has(i))
  const hasCards = cards.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={`max-h-[85vh] flex flex-col overflow-hidden p-0 gap-0 border-border/60 bg-card transition-[max-width] duration-300 ${
          hasCards ? 'max-w-2xl' : 'max-w-[440px]'
        }`}
      >
        {/* ── Header ── */}
        <div className="px-6 pt-6 pb-4">
          <p className="font-display text-xl tracking-tight">
            Import Character Card{hasCards && cards.length > 1 ? 's' : ''}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            TavernAI &amp; SillyTavern character card PNGs
          </p>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5 pb-4 space-y-3">
          {/* ── Drop zone — always visible when no cards, compact "add more" when cards exist ── */}
          {!hasCards && (
            <div
              className={`relative group rounded-xl overflow-hidden cursor-pointer transition-all duration-300 ${
                dragOver ? 'scale-[0.98]' : 'hover:scale-[0.995]'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {/* Animated dashed border */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                <rect
                  x="1" y="1"
                  width="calc(100% - 2px)" height="calc(100% - 2px)"
                  rx="11" ry="11"
                  fill="none"
                  className={`transition-all duration-300 ${
                    dragOver ? 'stroke-primary/50' : 'stroke-border/60 group-hover:stroke-border'
                  }`}
                  strokeWidth="1.5"
                  strokeDasharray="6 6"
                  style={{ animation: 'tavern-dropzone-dash 1.5s linear infinite' }}
                />
              </svg>

              <div className={`relative flex flex-col items-center justify-center py-14 px-8 transition-colors duration-300 ${
                dragOver ? 'bg-primary/[0.04]' : 'bg-muted/30'
              }`}>
                <div className={`relative mb-5 transition-all duration-300 ${
                  dragOver ? 'scale-110' : 'group-hover:scale-105'
                }`}>
                  <div className="w-16 h-20 rounded-lg bg-gradient-to-b from-muted-foreground/[0.07] to-muted-foreground/[0.03] flex items-end justify-center overflow-hidden">
                    <svg viewBox="0 0 48 56" className={`w-12 h-14 transition-colors duration-300 ${
                      dragOver ? 'text-primary/30' : 'text-muted-foreground/15 group-hover:text-muted-foreground/20'
                    }`}>
                      <circle cx="24" cy="16" r="8" fill="currentColor" />
                      <ellipse cx="24" cy="48" rx="16" ry="14" fill="currentColor" />
                    </svg>
                  </div>
                  {dragOver && (
                    <div
                      className="absolute -inset-3 rounded-2xl bg-primary/10 blur-lg"
                      style={{ animation: 'tavern-dropzone-glow 2s ease-in-out infinite' }}
                    />
                  )}
                </div>

                <p className={`font-display text-base tracking-tight transition-colors duration-200 ${
                  dragOver ? 'text-primary' : 'text-foreground/70 group-hover:text-foreground/80'
                }`}>
                  Drop character cards here
                </p>
                <p className="text-[11px] text-muted-foreground/40 mt-1.5">
                  one or multiple .png files
                </p>
              </div>
            </div>
          )}

          {/* ── Card grid ── */}
          {hasCards && (
            <div
              className={`grid gap-3 ${cards.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {cards.map((card, index) => (
                <div
                  key={`${card.character.name}-${index}`}
                  className="animate-tavern-card-reveal"
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  <CharacterCard
                    card={card}
                    selected={selected.has(index)}
                    onToggle={() => toggleCard(index)}
                    onRemove={() => removeCard(index)}
                    large={cards.length === 1}
                  />
                </div>
              ))}

              {/* Add more zone */}
              <div
                className={`relative group rounded-xl overflow-hidden cursor-pointer transition-all duration-200 min-h-40 ${
                  dragOver ? 'scale-[0.97]' : 'hover:scale-[0.99]'
                } ${cards.length === 1 ? 'col-span-1' : ''}`}
                onClick={() => fileInputRef.current?.click()}
              >
                <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                  <rect
                    x="1" y="1"
                    width="calc(100% - 2px)" height="calc(100% - 2px)"
                    rx="11" ry="11"
                    fill="none"
                    className={`transition-all duration-300 ${
                      dragOver ? 'stroke-primary/40' : 'stroke-border/40 group-hover:stroke-border/60'
                    }`}
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    style={{ animation: 'tavern-dropzone-dash 1.5s linear infinite' }}
                  />
                </svg>
                <div className={`h-full flex flex-col items-center justify-center gap-2 py-8 transition-colors ${
                  dragOver ? 'bg-primary/[0.04]' : 'bg-muted/20'
                }`}>
                  <Plus className={`size-5 transition-colors ${
                    dragOver ? 'text-primary/40' : 'text-muted-foreground/20 group-hover:text-muted-foreground/30'
                  }`} />
                  <p className="text-[11px] text-muted-foreground/40 group-hover:text-muted-foreground/50 transition-colors">
                    Add more cards
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Hidden file input — always present */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,.png,.json,application/json"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />

          {/* Error / warning */}
          {parseError && (
            <div className="flex items-start gap-2 text-xs text-destructive/80 bg-destructive/5 rounded-lg px-3 py-2.5">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}
        </div>

        {/* ── Ornamental divider ── */}
        <div className="px-6">
          <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
        </div>

        {/* ── Footer ── */}
        <DialogFooter className="px-5 py-3.5 flex-row items-center">
          {hasCards && (
            <span className="text-[11px] text-muted-foreground/40 mr-auto tabular-nums">
              {selected.size} of {cards.length} selected
            </span>
          )}
          <Button variant="ghost" size="sm" className="text-muted-foreground/60" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {hasCards && (
            <Button
              size="sm"
              disabled={selected.size === 0 || importMutation.isPending}
              onClick={() => importMutation.mutate(selectedCards)}
              className="gap-1.5"
            >
              {importMutation.isPending ? (
                'Importing\u2026'
              ) : (
                <>
                  <Check className="size-3.5" />
                  Import{selected.size > 1 ? ` ${selected.size} Characters` : ' Character'}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Individual character card ── */

function CharacterCard({
  card,
  selected,
  onToggle,
  onRemove,
  large,
}: {
  card: ParsedCard
  selected: boolean
  onToggle: () => void
  onRemove: () => void
  large: boolean
}) {
  return (
    <div
      className={`relative rounded-xl overflow-hidden border transition-all duration-200 cursor-pointer group ${
        selected
          ? 'border-primary/40 ring-1 ring-primary/20 bg-card'
          : 'border-border/40 bg-card/60 opacity-60 hover:opacity-80'
      }`}
      onClick={onToggle}
    >
      {/* Portrait */}
      <div className={`relative overflow-hidden bg-muted ${large ? 'aspect-[16/9] max-h-56' : 'aspect-[4/3]'}`}>
        <img
          src={card.imageDataUrl}
          alt=""
          className="w-full h-full object-cover object-top"
        />
        {/* Vignette */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-card via-card/60 to-transparent" />

        {/* Selection indicator */}
        <div className={`absolute top-2.5 left-2.5 size-5 rounded-md border-2 flex items-center justify-center transition-all duration-150 ${
          selected
            ? 'bg-primary border-primary'
            : 'bg-background/60 border-border/60 backdrop-blur-sm'
        }`}>
          {selected && <Check className="size-3 text-primary-foreground" />}
        </div>

        {/* Remove button */}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="absolute top-2.5 right-2.5 size-5 rounded-md bg-background/60 backdrop-blur-sm border border-border/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-foreground hover:bg-background/80"
          title="Remove from list"
        >
          <span className="text-xs leading-none">&times;</span>
        </button>

        {/* Name overlay */}
        <div className="absolute inset-x-0 bottom-0 px-3.5 pb-2.5">
          <p className={`font-display leading-tight tracking-tight truncate ${large ? 'text-2xl' : 'text-base'}`}>
            {card.character.name}
          </p>
          {card.character.meta.tavernCreator && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">
              by {card.character.meta.tavernCreator}
            </p>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3.5 py-2.5 space-y-1.5">
        {card.character.description && (
          <p className={`text-muted-foreground/60 leading-relaxed ${large ? 'text-[13px] line-clamp-3' : 'text-[11px] line-clamp-2'}`}>
            {card.character.description}
          </p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
            {card.character.meta.tavernSpec || 'character'}
          </Badge>
          {card.character.tags.slice(0, large ? 6 : 3).map((tag) => (
            <Badge key={tag} variant="outline" className="text-[9px] h-4 px-1.5 border-border/40 text-muted-foreground/50">
              {tag}
            </Badge>
          ))}
          {card.character.tags.length > (large ? 6 : 3) && (
            <span className="text-[9px] text-muted-foreground/30">
              +{card.character.tags.length - (large ? 6 : 3)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
