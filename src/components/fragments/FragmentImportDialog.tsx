import { useState, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  parseErrataExport,
  readFileAsText,
  importFragmentEntry,
  type ErrataExportData,
  type FragmentClipboardData,
  type FragmentBundleData,
  type FragmentExportEntry,
} from '@/lib/fragment-clipboard'
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
import { Clipboard, FileJson, AlertCircle, ImageIcon, Upload, Package } from 'lucide-react'

interface FragmentImportDialogProps {
  storyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: ErrataExportData | null
  onImported?: () => void
}

function isSingleFragment(data: ErrataExportData): data is FragmentClipboardData {
  return data._errata === 'fragment'
}

function isBundle(data: ErrataExportData): data is FragmentBundleData {
  return data._errata === 'fragment-bundle'
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
  const [parsed, setParsed] = useState<ErrataExportData | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [dragOver, setDragOver] = useState(false)

  // Manage dialog state on open/close
  useEffect(() => {
    if (!open) {
      setJsonText('')
      setParsed(null)
      setParseError(null)
      setSelectedIndices(new Set())
      setDragOver(false)
      return
    }
    if (initialData) {
      setParsed(initialData)
      setJsonText(JSON.stringify(initialData, null, 2))
      setParseError(null)
      if (isBundle(initialData)) {
        setSelectedIndices(new Set(initialData.fragments.map((_, i) => i)))
      }
    } else {
      // Try reading clipboard automatically
      navigator.clipboard.readText().then((text) => {
        const result = parseErrataExport(text)
        if (result) {
          setParsed(result)
          setJsonText(text)
          setParseError(null)
          if (isBundle(result)) {
            setSelectedIndices(new Set(result.fragments.map((_, i) => i)))
          }
        }
      }).catch(() => {
        // Clipboard read not available, that's fine
      })
    }
  }, [open, initialData])

  const handleTextChange = (text: string) => {
    setJsonText(text)
    if (!text.trim()) {
      setParsed(null)
      setParseError(null)
      return
    }
    const result = parseErrataExport(text)
    if (result) {
      setParsed(result)
      setParseError(null)
      if (isBundle(result)) {
        setSelectedIndices(new Set(result.fragments.map((_, i) => i)))
      }
    } else {
      setParsed(null)
      setParseError('Not a valid Errata export. Expected JSON with _errata: "fragment" or "fragment-bundle".')
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

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const file = e.dataTransfer.files[0]
    if (!file) return

    try {
      const text = await readFileAsText(file)
      handleTextChange(text)
    } catch {
      setParseError('Could not read file.')
    }
  }, [])

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await readFileAsText(file)
      handleTextChange(text)
    } catch {
      setParseError('Could not read file.')
    }
    e.target.value = ''
  }, [])

  const toggleBundleItem = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const importMutation = useMutation({
    mutationFn: async (data: ErrataExportData) => {
      if (isSingleFragment(data)) {
        // Legacy single-fragment format: merge attachments into entry
        const entry: FragmentExportEntry = {
          ...data.fragment,
          attachments: data.attachments,
        }
        return [await importFragmentEntry(storyId, entry)]
      } else {
        // Bundle format: import selected fragments
        const entries = data.fragments.filter((_, i) => selectedIndices.has(i))
        const results = []
        for (const entry of entries) {
          results.push(await importFragmentEntry(storyId, entry))
        }
        return results
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      onOpenChange(false)
      onImported?.()
    },
  })

  const importCount = parsed
    ? isSingleFragment(parsed) ? 1 : selectedIndices.size
    : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="size-4 text-muted-foreground" />
            Import Fragments
          </DialogTitle>
          <DialogDescription>
            Paste fragment JSON, drop a file, or load from clipboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto min-h-0 flex-1">
          {/* Input area - shown when nothing parsed yet */}
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
                <label className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-border/40 text-xs cursor-pointer transition-colors hover:bg-accent/50">
                  <Upload className="size-3" />
                  Load file
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={handleFileInput}
                  />
                </label>
              </div>

              {/* Drop zone / textarea combo */}
              <div
                className="relative"
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
              >
                <Textarea
                  value={jsonText}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder='Paste JSON or drop a .json file here...'
                  className={`min-h-[140px] resize-none font-mono text-xs bg-transparent transition-colors ${
                    dragOver ? 'border-primary/50 bg-primary/5' : ''
                  }`}
                />
                {dragOver && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-primary/40 bg-primary/5 pointer-events-none">
                    <div className="text-center">
                      <Upload className="size-5 text-primary/50 mx-auto mb-1" />
                      <p className="text-xs text-primary/60">Drop file here</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Error */}
          {parseError && (
            <div className="flex items-start gap-2 text-xs text-destructive/80 bg-destructive/5 rounded-md px-3 py-2">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Single fragment preview */}
          {parsed && isSingleFragment(parsed) && (
            <SingleFragmentPreview data={parsed} onClear={() => { setParsed(null); setJsonText('') }} />
          )}

          {/* Bundle preview */}
          {parsed && isBundle(parsed) && (
            <BundlePreview
              data={parsed}
              selectedIndices={selectedIndices}
              onToggle={toggleBundleItem}
              onSelectAll={() => setSelectedIndices(new Set(parsed.fragments.map((_, i) => i)))}
              onDeselectAll={() => setSelectedIndices(new Set())}
              onClear={() => { setParsed(null); setJsonText(''); setSelectedIndices(new Set()) }}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!parsed || importCount === 0 || importMutation.isPending}
            onClick={() => parsed && importMutation.mutate(parsed)}
          >
            {importMutation.isPending
              ? 'Importing...'
              : `Import${importCount > 1 ? ` ${importCount} fragments` : ''}`
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SingleFragmentPreview({
  data,
  onClear,
}: {
  data: FragmentClipboardData
  onClear: () => void
}) {
  const f = data.fragment
  return (
    <div className="rounded-lg border border-border/50 bg-accent/20 overflow-hidden">
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px] h-4">{f.type}</Badge>
          {f.sticky && <Badge className="text-[10px] h-4">pinned</Badge>}
          {data.source && (
            <span className="text-[9px] font-mono text-muted-foreground/30 ml-auto truncate max-w-24" title={`Source: ${data.source}`}>
              {data.source.slice(0, 8)}
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
        {data.attachments && data.attachments.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
              <ImageIcon className="size-3" />
              {data.attachments.length} attached {data.attachments.length === 1 ? 'image' : 'images'}
            </div>
            <div className="flex gap-1.5">
              {data.attachments.map((att) => {
                const url = att.content.startsWith('data:image/') || att.content.startsWith('http')
                  ? att.content : null
                return url ? (
                  <div key={att.name} className="size-10 rounded border border-border/30 overflow-hidden bg-muted shrink-0">
                    <img src={url} alt={att.name} className="size-full object-cover" />
                  </div>
                ) : (
                  <div key={att.name} className="size-10 rounded border border-border/30 bg-muted flex items-center justify-center shrink-0">
                    <ImageIcon className="size-4 text-muted-foreground/30" />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-border/30 px-4 py-2">
        <button
          onClick={onClear}
          className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          Paste different fragment
        </button>
      </div>
    </div>
  )
}

export function BundlePreview({
  data,
  selectedIndices,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onClear,
}: {
  data: FragmentBundleData
  selectedIndices: Set<number>
  onToggle: (index: number) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onClear: () => void
}) {
  const allSelected = data.fragments.length === selectedIndices.size

  // Group by type for display
  const groupedEntries = data.fragments.reduce<Record<string, Array<{ entry: FragmentExportEntry; index: number }>>>((acc, entry, index) => {
    const type = entry.type
    if (!acc[type]) acc[type] = []
    acc[type].push({ entry, index })
    return acc
  }, {})

  return (
    <div className="rounded-lg border border-border/50 bg-accent/20 overflow-hidden">
      {/* Bundle header */}
      <div className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Package className="size-3.5 text-muted-foreground/50" />
          <span className="text-xs font-medium">Fragment Bundle</span>
          <Badge variant="secondary" className="text-[10px] h-4 tabular-nums">
            {data.fragments.length} fragments
          </Badge>
          {data.storyName && (
            <span className="text-[10px] text-muted-foreground/40 ml-auto truncate max-w-32">
              from {data.storyName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={allSelected ? onDeselectAll : onSelectAll}
            className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-[10px] text-muted-foreground/30">
            {selectedIndices.size} of {data.fragments.length} selected
          </span>
        </div>
      </div>

      {/* Fragment list */}
      <div className="max-h-64 overflow-y-auto">
        {Object.entries(groupedEntries).map(([type, items]) => (
          <div key={type}>
            <div className="px-4 py-1.5 bg-background/30 border-b border-border/20">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">{type}</span>
            </div>
            {items.map(({ entry, index }) => (
              <div
                key={`${entry.type}-${entry.name}-${index}`}
                onClick={() => onToggle(index)}
                className={`flex items-center gap-2.5 w-full px-4 py-2 text-left transition-colors hover:bg-accent/30 cursor-pointer ${
                  selectedIndices.has(index) ? '' : 'opacity-50'
                }`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(index) } }}
              >
                <input
                  type="checkbox"
                  checked={selectedIndices.has(index)}
                  readOnly
                  className="size-3.5 shrink-0 accent-primary"
                  tabIndex={-1}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate leading-tight">{entry.name}</p>
                  {entry.description && (
                    <p className="text-[11px] text-muted-foreground/50 truncate">{entry.description}</p>
                  )}
                </div>
                {entry.sticky && (
                  <Badge variant="secondary" className="text-[9px] h-3.5 px-1 shrink-0">pinned</Badge>
                )}
                {entry.attachments && entry.attachments.length > 0 && (
                  <ImageIcon className="size-3 text-muted-foreground/30 shrink-0" />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Clear */}
      <div className="border-t border-border/30 px-4 py-2">
        <button
          onClick={onClear}
          className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          Load different file
        </button>
      </div>
    </div>
  )
}
