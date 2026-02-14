import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { parseFragmentClipboard, type FragmentClipboardData } from '@/lib/fragment-clipboard'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Clipboard, FileJson, AlertCircle, ImageIcon } from 'lucide-react'

interface FragmentImportDialogProps {
  storyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: FragmentClipboardData | null
  onImported?: () => void
}

export function FragmentImportDialog({
  storyId,
  open,
  onOpenChange,
  initialData,
  onImported,
}: FragmentImportDialogProps) {
  const queryClient = useQueryClient()
  const [jsonText, setJsonText] = useState('')
  const [parsed, setParsed] = useState<FragmentClipboardData | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  // When opened with initial data, populate immediately
  useEffect(() => {
    if (open && initialData) {
      setParsed(initialData)
      setJsonText(JSON.stringify(initialData, null, 2))
      setParseError(null)
    } else if (open && !initialData) {
      // Try reading clipboard automatically
      navigator.clipboard.readText().then((text) => {
        const result = parseFragmentClipboard(text)
        if (result) {
          setParsed(result)
          setJsonText(text)
          setParseError(null)
        }
      }).catch(() => {
        // Clipboard read not available, that's fine
      })
    }
  }, [open, initialData])

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setJsonText('')
      setParsed(null)
      setParseError(null)
    }
  }, [open])

  const handleTextChange = (text: string) => {
    setJsonText(text)
    if (!text.trim()) {
      setParsed(null)
      setParseError(null)
      return
    }
    const result = parseFragmentClipboard(text)
    if (result) {
      setParsed(result)
      setParseError(null)
    } else {
      setParsed(null)
      setParseError('Not a valid Errata fragment. Expected JSON with _errata: "fragment".')
    }
  }

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      handleTextChange(text)
    } catch {
      setParseError('Could not read clipboard. Try pasting manually with Ctrl+V.')
    }
  }

  const importMutation = useMutation({
    mutationFn: async (data: FragmentClipboardData) => {
      // 1. Create attachment image/icon fragments first
      const visualRefs: Array<{ fragmentId: string; kind: 'image' | 'icon'; boundary?: { x: number; y: number; width: number; height: number } }> = []
      if (data.attachments && data.attachments.length > 0) {
        for (const att of data.attachments) {
          const created = await api.fragments.create(storyId, {
            type: att.kind,
            name: att.name,
            description: att.description || '',
            content: att.content,
          })
          visualRefs.push({
            fragmentId: created.id,
            kind: att.kind,
            ...(att.boundary ? { boundary: att.boundary } : {}),
          })
        }
      }

      // 2. Create the main fragment
      const created = await api.fragments.create(storyId, {
        type: data.fragment.type,
        name: data.fragment.name,
        description: data.fragment.description || '',
        content: data.fragment.content,
      })

      // 3. If there are visual refs, update the fragment's meta
      if (visualRefs.length > 0) {
        await api.fragments.update(storyId, created.id, {
          name: created.name,
          description: created.description,
          content: created.content,
          meta: { visualRefs },
        })
      }

      return created
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      onOpenChange(false)
      onImported?.()
    },
  })

  const f = parsed?.fragment

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="size-4 text-muted-foreground" />
            Import Fragment
          </DialogTitle>
          <DialogDescription>
            Paste a fragment JSON copied from Errata, or load one from a file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Paste area */}
          {!parsed && (
            <>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={handlePasteFromClipboard}
                >
                  <Clipboard className="size-3" />
                  Paste from clipboard
                </Button>
              </div>
              <Textarea
                value={jsonText}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder='{"_errata": "fragment", ...}'
                className="min-h-[140px] resize-none font-mono text-xs bg-transparent"
              />
            </>
          )}

          {/* Error */}
          {parseError && (
            <div className="flex items-start gap-2 text-xs text-destructive/80 bg-destructive/5 rounded-md px-3 py-2">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Preview */}
          {parsed && f && (
            <div className="rounded-lg border border-border/50 bg-accent/20 overflow-hidden">
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] h-4">{f.type}</Badge>
                  {f.sticky && <Badge className="text-[10px] h-4">pinned</Badge>}
                  {parsed.source && (
                    <span className="text-[9px] font-mono text-muted-foreground/30 ml-auto truncate max-w-24" title={`Source: ${parsed.source}`}>
                      {parsed.source.slice(0, 8)}
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-display text-base leading-tight">{f.name}</p>
                  {f.description && (
                    <p className="text-xs text-muted-foreground/60 mt-0.5">{f.description}</p>
                  )}
                </div>
                {f.content && (
                  <div className="text-xs text-foreground/70 font-prose leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-background/50 px-3 py-2 border border-border/30">
                    {f.content.length > 500 ? f.content.slice(0, 500) + '\u2026' : f.content}
                  </div>
                )}
                {f.tags && f.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {f.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[9px] h-3.5">{tag}</Badge>
                    ))}
                  </div>
                )}
                {parsed.attachments && parsed.attachments.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                      <ImageIcon className="size-3" />
                      {parsed.attachments.length} attached {parsed.attachments.length === 1 ? 'image' : 'images'}
                    </div>
                    <div className="flex gap-1.5">
                      {parsed.attachments.map((att, i) => {
                        const url = att.content.startsWith('data:image/') || att.content.startsWith('http')
                          ? att.content : null
                        return url ? (
                          <div key={i} className="size-10 rounded border border-border/30 overflow-hidden bg-muted shrink-0">
                            <img src={url} alt={att.name} className="size-full object-cover" />
                          </div>
                        ) : (
                          <div key={i} className="size-10 rounded border border-border/30 bg-muted flex items-center justify-center shrink-0">
                            <ImageIcon className="size-4 text-muted-foreground/30" />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Change / clear */}
              <div className="border-t border-border/30 px-4 py-2">
                <button
                  onClick={() => { setParsed(null); setJsonText('') }}
                  className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  Paste different fragment
                </button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!parsed || importMutation.isPending}
            onClick={() => parsed && importMutation.mutate(parsed)}
          >
            {importMutation.isPending ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
