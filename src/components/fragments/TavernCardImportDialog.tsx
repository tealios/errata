import { useState, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { importTavernCard, isTavernCardPng, parseCardJson, type ImportedCharacter, type ParsedCharacterCard } from '@/lib/importers/tavern-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileDropDialog, FileDropzone } from '@/components/ui/file-drop-dialog'
import { Check, Plus } from 'lucide-react'

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
  const [cards, setCards] = useState<ParsedCard[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [parseError, setParseError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setCards([])
      setSelected(new Set())
      setParseError(null)
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

  const handleFiles = useCallback(async (files: File[]) => {
    // Check if any file is JSON — route to CharacterCardImportDialog
    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
        try {
          const text = await file.text()
          const parsed = parseCardJson(text)
          if (parsed && onJsonCardDetected) {
            onJsonCardDetected(parsed)
            return
          }
        } catch { /* not a valid JSON card */ }
      }
    }

    const buffers: ArrayBuffer[] = []
    for (const file of files) {
      try {
        buffers.push(await file.arrayBuffer())
      } catch { /* skip unreadable */ }
    }
    if (buffers.length > 0) parseBuffers(buffers)
  }, [parseBuffers, onJsonCardDetected])

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
    <FileDropDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Import Character Card${hasCards && cards.length > 1 ? 's' : ''}`}
      description="TavernAI & SillyTavern character card PNGs"
      contentClassName={`transition-[max-width] duration-300 ${hasCards ? 'max-w-2xl' : 'max-w-[440px]'}`}
    >
      {!hasCards && (
        <FileDropDialog.Dropzone
          onFiles={handleFiles}
          accept="image/png,.png,.json,application/json"
          multiple
          label="Drop character cards here"
          hint="one or multiple .png files"
          icon={
            <svg viewBox="0 0 48 56" className="w-12 h-14" aria-hidden="true">
              <circle cx="24" cy="16" r="8" fill="currentColor" />
              <ellipse cx="24" cy="48" rx="16" ry="14" fill="currentColor" />
            </svg>
          }
        />
      )}

      {hasCards && (
        <FileDropDialog.Preview>
          <div className={`grid gap-3 ${cards.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
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

            <FileDropzone
              onFiles={handleFiles}
              accept="image/png,.png,.json,application/json"
              multiple
              className={`min-h-40 ${cards.length === 1 ? 'col-span-1' : ''}`}
            >
              <div className="flex flex-col items-center justify-center gap-2 py-4 text-muted-foreground">
                <Plus className="size-5" aria-hidden="true" />
                <p className="text-[0.6875rem]">Add more cards</p>
              </div>
            </FileDropzone>
          </div>
        </FileDropDialog.Preview>
      )}

      <FileDropDialog.Errors>{parseError}</FileDropDialog.Errors>

      <FileDropDialog.Actions
        meta={hasCards ? `${selected.size} of ${cards.length} selected` : undefined}
      >
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onOpenChange(false)}>
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
      </FileDropDialog.Actions>
    </FileDropDialog>
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
          className="absolute top-2.5 right-2.5 size-5 rounded-md bg-background/60 backdrop-blur-sm border border-border/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground hover:bg-background/80"
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
            <p className="text-[0.625rem] text-muted-foreground mt-0.5 truncate">
              by {card.character.meta.tavernCreator}
            </p>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3.5 py-2.5 space-y-1.5">
        {card.character.description && (
          <p className={`text-muted-foreground leading-relaxed ${large ? 'text-[0.8125rem] line-clamp-3' : 'text-[0.6875rem] line-clamp-2'}`}>
            {card.character.description}
          </p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[0.5625rem] h-4 px-1.5">
            {card.character.meta.tavernSpec || 'character'}
          </Badge>
          {card.character.tags.slice(0, large ? 6 : 3).map((tag) => (
            <Badge key={tag} variant="outline" className="text-[0.5625rem] h-4 px-1.5 border-border/40 text-muted-foreground">
              {tag}
            </Badge>
          ))}
          {card.character.tags.length > (large ? 6 : 3) && (
            <span className="text-[0.5625rem] text-muted-foreground">
              +{card.character.tags.length - (large ? 6 : 3)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
