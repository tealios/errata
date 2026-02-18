import { useState, useRef, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  isTavernCardPng,
  extractParsedCard,
  parseCardJson,
  type ParsedCharacterCard,
} from '@/lib/importers/tavern-card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Upload,
  Link as LinkIcon,
  FileArchive,
  FileJson,
  Image,
  Loader2,
  AlertCircle,
} from 'lucide-react'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ImportStatus =
  | { type: 'idle' }
  | { type: 'processing'; message: string }
  | { type: 'error'; message: string }

export function ImportDialog({ open, onOpenChange }: ImportDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<ImportStatus>({ type: 'idle' })

  const reset = useCallback(() => {
    setUrl('')
    setStatus({ type: 'idle' })
    setDragOver(false)
  }, [])

  const handleOpenChange = useCallback((v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }, [onOpenChange, reset])

  /** Store parsed card data in sessionStorage and navigate to the new story */
  const importCharacterCard = useCallback(async (
    parsed: ParsedCharacterCard,
    imageDataUrl?: string | null,
  ) => {
    const newStory = await api.stories.create({
      name: parsed.card.name,
      description: parsed.card.description.slice(0, 250) || 'Imported from character card',
    })

    // Rebuild raw card JSON for the story page to re-parse
    const cardJson = JSON.stringify({
      data: {
        name: parsed.card.name,
        description: parsed.card.description,
        personality: parsed.card.personality,
        first_mes: parsed.card.firstMessage,
        mes_example: parsed.card.messageExamples,
        scenario: parsed.card.scenario,
        creator_notes: parsed.card.creatorNotes,
        system_prompt: parsed.card.systemPrompt,
        post_history_instructions: parsed.card.postHistoryInstructions,
        alternate_greetings: parsed.card.alternateGreetings,
        tags: parsed.card.tags,
        creator: parsed.card.creator,
        character_version: parsed.card.characterVersion,
        character_book: parsed.book ? {
          name: parsed.book.name,
          entries: parsed.book.entries.map(e => ({
            keys: e.keys, secondary_keys: e.secondaryKeys, content: e.content,
            comment: e.comment, name: e.name, enabled: e.enabled, constant: e.constant,
            selective: e.selective, insertion_order: e.insertionOrder,
            position: e.position, priority: e.priority, id: e.id,
          })),
        } : undefined,
      },
      spec: parsed.card.spec,
      spec_version: parsed.card.specVersion,
    })

    sessionStorage.setItem('errata:pending-card-import', JSON.stringify({
      type: imageDataUrl ? 'png' : 'json',
      imageDataUrl: imageDataUrl ?? undefined,
      cardJson,
    }))

    await queryClient.invalidateQueries({ queryKey: ['stories'] })
    handleOpenChange(false)
    navigate({ to: '/story/$storyId', params: { storyId: newStory.id } })
  }, [navigate, queryClient, handleOpenChange])

  /** Process a single file based on its type */
  const processFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase()

    // ZIP → story import
    if (name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      setStatus({ type: 'processing', message: 'Importing story archive...' })
      try {
        const newStory = await api.stories.importFromZip(file)
        await queryClient.invalidateQueries({ queryKey: ['stories'] })
        handleOpenChange(false)
        navigate({ to: '/story/$storyId', params: { storyId: newStory.id } })
      } catch (err) {
        setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to import story archive.' })
      }
      return
    }

    // PNG → character card
    if (name.endsWith('.png') || file.type === 'image/png') {
      setStatus({ type: 'processing', message: 'Reading character card image...' })
      try {
        const buffer = await file.arrayBuffer()
        if (!isTavernCardPng(buffer)) {
          setStatus({ type: 'error', message: 'This PNG does not contain an embedded character card.' })
          return
        }
        const parsed = extractParsedCard(buffer)
        if (!parsed) {
          setStatus({ type: 'error', message: 'Could not parse the character card data from this PNG.' })
          return
        }
        // Build image data URL for the import dialog
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let j = 0; j < bytes.length; j++) {
          binary += String.fromCharCode(bytes[j])
        }
        const imageDataUrl = `data:image/png;base64,${btoa(binary)}`
        await importCharacterCard(parsed, imageDataUrl)
      } catch (err) {
        setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to read PNG file.' })
      }
      return
    }

    // JSON → try character card first, then fail
    if (name.endsWith('.json') || file.type === 'application/json') {
      setStatus({ type: 'processing', message: 'Parsing JSON file...' })
      try {
        const text = await file.text()
        const parsed = parseCardJson(text)
        if (parsed) {
          await importCharacterCard(parsed)
          return
        }
        setStatus({ type: 'error', message: 'This JSON file is not a recognized character card format (V2/V3).' })
      } catch (err) {
        setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to read JSON file.' })
      }
      return
    }

    setStatus({ type: 'error', message: `Unsupported file type. Accepted: .zip, .json, .png` })
  }, [importCharacterCard, navigate, queryClient, handleOpenChange])

  /** Fetch from URL */
  const handleUrlFetch = useCallback(async () => {
    const trimmed = url.trim()
    if (!trimmed) return

    setStatus({ type: 'processing', message: 'Fetching from URL...' })
    try {
      const res = await fetch(trimmed)
      if (!res.ok) {
        setStatus({ type: 'error', message: `Fetch failed: ${res.status} ${res.statusText}` })
        return
      }

      const contentType = res.headers.get('content-type') ?? ''
      const text = await res.text()

      // Try as character card JSON
      const parsed = parseCardJson(text)
      if (parsed) {
        await importCharacterCard(parsed)
        return
      }

      // If content-type suggests JSON but it's not a card
      if (contentType.includes('json') || trimmed.endsWith('.json')) {
        setStatus({ type: 'error', message: 'The fetched JSON is not a recognized character card format (V2/V3).' })
        return
      }

      setStatus({ type: 'error', message: 'Could not recognize the fetched content as a character card.' })
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Network error while fetching URL.' })
    }
  }, [url, importCharacterCard])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) await processFile(file)
  }, [processFile])

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await processFile(file)
    e.target.value = ''
  }, [processFile])

  const isProcessing = status.type === 'processing'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Import</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); if (!isProcessing) setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            className={`
              relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed
              px-6 py-8 cursor-pointer transition-all duration-150
              ${dragOver
                ? 'border-primary/50 bg-primary/5'
                : 'border-border/40 hover:border-border/70 hover:bg-muted/30'
              }
              ${isProcessing ? 'pointer-events-none opacity-60' : ''}
            `}
          >
            {isProcessing ? (
              <>
                <Loader2 className="size-6 text-muted-foreground/50 animate-spin" />
                <p className="text-sm text-muted-foreground/70">{status.message}</p>
              </>
            ) : (
              <>
                <Upload className="size-6 text-muted-foreground/40" />
                <div className="text-center">
                  <p className="text-sm text-muted-foreground/70">
                    Drop a file or <span className="text-foreground/70 underline underline-offset-2">browse</span>
                  </p>
                  <div className="flex items-center justify-center gap-3 mt-2">
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground/40">
                      <FileArchive className="size-3" />.zip
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground/40">
                      <FileJson className="size-3" />.json
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground/40">
                      <Image className="size-3" />.png
                    </span>
                  </div>
                </div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.json,.png,image/png,application/json,application/zip"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>

          {/* URL input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              Or import from URL
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/30" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlFetch() } }}
                  placeholder="https://..."
                  className="pl-8 text-sm h-9"
                  disabled={isProcessing}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-3"
                disabled={isProcessing || !url.trim()}
                onClick={handleUrlFetch}
              >
                {isProcessing ? <Loader2 className="size-3.5 animate-spin" /> : 'Fetch'}
              </Button>
            </div>
          </div>

          {/* Error message */}
          {status.type === 'error' && (
            <div className="flex items-start gap-2 text-xs text-destructive/80 bg-destructive/5 rounded-md px-3 py-2.5">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <span>{status.message}</span>
            </div>
          )}

          {/* Help text */}
          <p className="text-[11px] text-muted-foreground/35 leading-relaxed">
            <strong className="text-muted-foreground/50">.zip</strong> — Errata story export
            {' · '}
            <strong className="text-muted-foreground/50">.json</strong> — SillyTavern / TavernAI character card (V2/V3)
            {' · '}
            <strong className="text-muted-foreground/50">.png</strong> — Character card with embedded data
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
