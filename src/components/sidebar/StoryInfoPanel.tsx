import { useState, useRef, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type StoryMeta, type Fragment } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface StoryInfoPanelProps {
  storyId: string
  story: StoryMeta
}

interface ExportData {
  exportedAt: string
  storyName: string
  fragments: Array<{
    type: string
    name: string
    description: string
    content: string
    tags: string[]
    sticky: boolean
    meta: Record<string, unknown>
  }>
}

const EXPORT_TYPES = [
  { type: 'character', label: 'Characters', defaultChecked: true },
  { type: 'guideline', label: 'Guidelines', defaultChecked: true },
  { type: 'knowledge', label: 'Knowledge', defaultChecked: true },
  { type: 'prose', label: 'Prose', defaultChecked: false },
] as const

export function StoryInfoPanel({ storyId, story }: StoryInfoPanelProps) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(story.name)
  const [description, setDescription] = useState(story.description)
  const [summary, setSummary] = useState(story.summary ?? '')

  // Export state
  const [exportOpen, setExportOpen] = useState(false)
  const [exportTypes, setExportTypes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EXPORT_TYPES.map(t => [t.type, t.defaultChecked]))
  )
  const [exporting, setExporting] = useState(false)

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importData, setImportData] = useState<ExportData | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // Fetch available fragment types for dynamic type support
  const typesQuery = useQuery({
    queryKey: ['fragment-types', storyId],
    queryFn: () => api.fragments.types(storyId),
  })

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      api.stories.update(storyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] })
      setEditing(false)
    },
  })

  const handleSave = () => {
    updateMutation.mutate({ name: name.trim(), description: description.trim(), summary: summary.trim() })
  }

  const handleCancel = () => {
    setName(story.name)
    setDescription(story.description)
    setSummary(story.summary ?? '')
    setEditing(false)
  }

  // --- Export ---

  const handleExport = async () => {
    setExporting(true)
    try {
      const selectedTypes = Object.entries(exportTypes)
        .filter(([, checked]) => checked)
        .map(([type]) => type)

      const allFragments: Fragment[] = []
      for (const type of selectedTypes) {
        const fragments = await api.fragments.list(storyId, type)
        allFragments.push(...fragments)
      }

      const exportData: ExportData = {
        exportedAt: new Date().toISOString(),
        storyName: story.name,
        fragments: allFragments.map(f => ({
          type: f.type,
          name: f.name,
          description: f.description,
          content: f.content,
          tags: f.tags,
          sticky: f.sticky,
          meta: f.meta,
        })),
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${story.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-fragments.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExportOpen(false)
    } finally {
      setExporting(false)
    }
  }

  const handleExportToggle = (type: string, checked: boolean) => {
    setExportTypes(prev => ({ ...prev, [type]: checked }))
  }

  const selectedExportCount = Object.values(exportTypes).filter(Boolean).length

  // --- Import ---

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset for next pick
    e.target.value = ''

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as ExportData
        if (!data.fragments || !Array.isArray(data.fragments)) {
          setImportError('Invalid export file: missing fragments array')
          return
        }
        for (const f of data.fragments) {
          if (!f.type || !f.name || typeof f.content !== 'string') {
            setImportError('Invalid export file: fragments must have type, name, and content')
            return
          }
        }
        setImportError(null)
        setImportData(data)
        setImportOpen(true)
      } catch {
        setImportError('Failed to parse JSON file')
      }
    }
    reader.readAsText(file)
  }, [])

  const handleImportConfirm = async () => {
    if (!importData) return
    setImporting(true)
    try {
      for (const f of importData.fragments) {
        await api.fragments.create(storyId, {
          type: f.type,
          name: f.name,
          description: f.description || '',
          content: f.content,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      setImportOpen(false)
      setImportData(null)
    } finally {
      setImporting(false)
    }
  }

  const importCounts = importData
    ? importData.fragments.reduce<Record<string, number>>((acc, f) => {
        acc[f.type] = (acc[f.type] || 0) + 1
        return acc
      }, {})
    : {}

  // Build export type list: use known types from server if available, fall back to defaults
  const exportTypeList = typesQuery.data
    ? typesQuery.data.map(t => ({
        type: t.type,
        label: t.type.charAt(0).toUpperCase() + t.type.slice(1) + 's',
        defaultChecked: t.type !== 'prose',
      }))
    : [...EXPORT_TYPES]

  if (!editing) {
    return (
      <div className="p-4 space-y-4">
        <div>
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Name</label>
          <p className="text-sm font-display mt-0.5">{story.name}</p>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Description</label>
          <p className="text-sm mt-0.5">{story.description || <span className="text-muted-foreground/40 italic">No description</span>}</p>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Summary</label>
          <p className="text-sm whitespace-pre-wrap mt-0.5">{story.summary || <span className="text-muted-foreground/40 italic">No summary yet</span>}</p>
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground/40">
          <span>Created {new Date(story.createdAt).toLocaleDateString()}</span>
          <span>Updated {new Date(story.updatedAt).toLocaleDateString()}</span>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
            setExportTypes(Object.fromEntries(exportTypeList.map(t => [t.type, t.defaultChecked])))
            setExportOpen(true)
          }}>
            Export
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInputRef.current?.click()}>
            Import
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileSelect}
        />

        {importError && (
          <p className="text-xs text-destructive">{importError}</p>
        )}

        {/* Export Dialog */}
        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Export Fragments</DialogTitle>
              <DialogDescription>
                Select which fragment types to include in the export.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {exportTypeList.map(t => (
                <label key={t.type} className="flex items-center gap-2.5 cursor-pointer">
                  <Checkbox
                    checked={exportTypes[t.type] ?? t.defaultChecked}
                    onCheckedChange={(checked) => handleExportToggle(t.type, checked === true)}
                  />
                  <span className="text-sm">{t.label}</span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setExportOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleExport}
                disabled={exporting || selectedExportCount === 0}
              >
                {exporting ? 'Exporting...' : 'Export'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import Confirmation Dialog */}
        <Dialog open={importOpen} onOpenChange={(open) => {
          if (!open) {
            setImportOpen(false)
            setImportData(null)
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import Fragments</DialogTitle>
              <DialogDescription>
                {importData?.storyName && (
                  <>Exported from "{importData.storyName}". </>
                )}
                The following fragments will be created:
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2">
              {Object.entries(importCounts).map(([type, count]) => (
                <div key={type} className="flex justify-between text-sm">
                  <span className="capitalize">{type}s</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-medium pt-1.5 border-t">
                <span>Total</span>
                <span>{importData?.fragments.length ?? 0}</span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => {
                setImportOpen(false)
                setImportData(null)
              }}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleImportConfirm}
                disabled={importing}
              >
                {importing ? 'Importing...' : 'Import'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent" />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">Description</label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[80px] resize-none text-sm bg-transparent"
        />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5 block">Summary</label>
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="min-h-[120px] resize-none text-sm bg-transparent"
          placeholder="Story summary..."
        />
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
