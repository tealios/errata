import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { X, RotateCcw, Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { Hint } from '@/components/ui/prose-text'
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelHeaderText,
  PanelTitle,
} from '@/components/ui/panel'
import { useWritingTransforms, type WritingTransform } from '@/lib/theme'

interface CustomTransformsPanelProps {
  onClose: () => void
}

function generateId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function CustomTransformsPanel({ onClose }: CustomTransformsPanelProps) {
  const [transforms, setTransforms, resetToDefaults] = useWritingTransforms()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)

  const handleDragStart = useCallback((index: number) => {
    dragItem.current = index
    setDragIndex(index)
  }, [])

  const handleDragEnter = useCallback((index: number) => {
    dragOverItem.current = index
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) {
      setDragIndex(null)
      return
    }
    const reordered = [...transforms]
    const [removed] = reordered.splice(dragItem.current, 1)
    reordered.splice(dragOverItem.current, 0, removed)
    setTransforms(reordered)
    dragItem.current = null
    dragOverItem.current = null
    setDragIndex(null)
  }, [transforms, setTransforms])

  const toggleEnabled = (id: string) => {
    setTransforms(transforms.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t))
  }

  const updateLabel = (id: string, label: string) => {
    setTransforms(transforms.map(t => t.id === id ? { ...t, label } : t))
  }

  const updateInstruction = (id: string, instruction: string) => {
    setTransforms(transforms.map(t => t.id === id ? { ...t, instruction } : t))
  }

  const removeTransform = (id: string) => {
    setTransforms(transforms.filter(t => t.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  const addTransform = () => {
    const newTransform: WritingTransform = {
      id: generateId(),
      label: 'New transform',
      instruction: '',
      enabled: true,
    }
    setTransforms([...transforms, newTransform])
    setExpandedId(newTransform.id)
  }

  return (
    <Panel data-component-id="custom-transforms-panel-root">
      <PanelHeader>
        <PanelHeaderText className="flex-row items-center gap-2">
          <PanelTitle>Selection Transforms</PanelTitle>
          <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wider">Writing</span>
        </PanelHeaderText>
        <PanelActions>
          <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </PanelActions>
      </PanelHeader>

      <PanelBody className="px-6 py-6">
        <div className="max-w-3xl w-full mx-auto space-y-4">
          <Hint size="sm">
            Custom transforms appear in the floating toolbar when you select text in the writing panel. Drag to reorder, toggle to show/hide.
          </Hint>

          <div className="space-y-1">
            {transforms.map((t, index) => {
              const isExpanded = expandedId === t.id
              return (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragEnter={() => handleDragEnter(index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                  className={`group rounded-lg border border-border/30 bg-background cursor-grab select-none transition-all duration-150 ${dragIndex === index ? 'opacity-40 scale-[0.97]' : ''}`}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    {/* Drag handle */}
                    <div className="shrink-0 opacity-0 group-hover:opacity-50 transition-opacity duration-150 -ml-0.5">
                      <GripVertical className="size-3.5 text-muted-foreground" />
                    </div>

                    {/* Expand/collapse + label */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : t.id)}
                      className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer"
                    >
                      {isExpanded
                        ? <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                        : <ChevronRight className="size-3 text-muted-foreground shrink-0" />}
                      <span className={`text-[0.75rem] truncate ${t.enabled ? 'text-foreground/80' : 'text-muted-foreground line-through'}`}>
                        {t.label}
                      </span>
                    </button>

                    {/* Toggle */}
                    <button
                      type="button"
                      onClick={() => toggleEnabled(t.id)}
                      className={`relative shrink-0 h-[16px] w-[28px] rounded-full transition-colors cursor-pointer ${t.enabled ? 'bg-foreground' : 'bg-muted-foreground/20'}`}
                      aria-label={`Toggle ${t.label}`}
                    >
                      <span
                        className={`absolute top-[2px] h-[12px] w-[12px] rounded-full bg-background transition-[left] duration-150 ${t.enabled ? 'left-[14px]' : 'left-[2px]'}`}
                      />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => removeTransform(t.id)}
                      className="text-muted-foreground hover:text-destructive/70 transition-colors shrink-0 cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-border/20 pt-2">
                      <div>
                        <label className="text-[0.625rem] text-muted-foreground uppercase tracking-wider mb-1 block">Label</label>
                        <input
                          type="text"
                          value={t.label}
                          onChange={(e) => updateLabel(t.id, e.target.value)}
                          draggable={false}
                          className="w-full h-8 px-2.5 text-[0.75rem] bg-muted/30 border border-border/40 rounded-md focus:border-foreground/20 focus:outline-none cursor-text"
                          placeholder="Transform name"
                        />
                      </div>
                      <div>
                        <label className="text-[0.625rem] text-muted-foreground uppercase tracking-wider mb-1 block">Instruction</label>
                        <textarea
                          value={t.instruction}
                          onChange={(e) => updateInstruction(t.id, e.target.value)}
                          draggable={false}
                          className="w-full min-h-[80px] px-2.5 py-2 text-[0.75rem] bg-muted/30 border border-border/40 rounded-md focus:border-foreground/20 focus:outline-none resize-y cursor-text"
                          placeholder="Describe what this transform should do to the selected text..."
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={resetToDefaults}>
              <RotateCcw className="size-3.5 mr-1.5" />
              Reset defaults
            </Button>
            <Button variant="outline" size="sm" onClick={addTransform}>
              <Plus className="size-3.5 mr-1.5" />
              Add transform
            </Button>
          </div>
        </div>
      </PanelBody>
    </Panel>
  )
}
