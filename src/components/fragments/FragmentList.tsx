import { useState, useMemo, useRef, useCallback, memo, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api, type Fragment, type Folder } from '@/lib/api'
import { componentId, fragmentComponentId } from '@/lib/dom-ids'
import { resolveFragmentVisual, generateBubbles, hexagonPoints, diamondPoints, type Bubble } from '@/lib/fragment-visuals'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, Pin, GripVertical, FileDown, UserPlus, Archive, FolderPlus, ChevronRight, MoreHorizontal, Pencil, Trash2, FolderOpen } from 'lucide-react'

interface FragmentListProps {
  storyId: string
  type?: string
  allowedTypes?: string[]
  listIdBase?: string
  onSelect: (fragment: Fragment) => void
  onCreateNew: () => void
  onImport?: () => void
  onImportCard?: () => void
  selectedId?: string
}

function BubbleSvgShape({ b }: { b: Bubble; i: number }) {
  const transform = b.shape !== 'circle' ? `rotate(${b.rotation} ${b.cx} ${b.cy})` : undefined
  switch (b.shape) {
    case 'rounded-rect':
      return <rect key={`${b.cx}-${b.cy}`} x={b.cx - b.r * 0.8} y={b.cy - b.r * 0.6} width={b.r * 1.6} height={b.r * 1.2} rx={b.r * 0.2} fill={b.color} opacity={b.opacity} transform={transform} />
    case 'hexagon':
      return <polygon key={`${b.cx}-${b.cy}`} points={hexagonPoints(b.cx, b.cy, b.r)} fill={b.color} opacity={b.opacity} transform={transform} />
    case 'ellipse':
      return <ellipse key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} rx={b.r * 1.2} ry={b.r * 0.7} fill={b.color} opacity={b.opacity} transform={transform} />
    case 'diamond':
      return <polygon key={`${b.cx}-${b.cy}`} points={diamondPoints(b.cx, b.cy, b.r)} fill={b.color} opacity={b.opacity} transform={transform} />
    default:
      return <circle key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} r={b.r} fill={b.color} opacity={b.opacity} />
  }
}

// --- Memoized fragment row ---

interface FragmentRowProps {
  fragment: Fragment
  index: number
  selected: boolean
  isDragging: boolean
  canDrag: boolean
  showType: boolean
  mediaById: Map<string, Fragment>
  onSelect: (fragment: Fragment) => void
  onPin: (fragment: Fragment) => void
  pinPending: boolean
  onDragStart: (index: number, e: React.DragEvent) => void
  onDragEnter: (index: number) => void
  onDragEnd: () => void
}

const FragmentRow = memo(function FragmentRow({
  fragment,
  index,
  selected,
  isDragging,
  canDrag,
  showType,
  mediaById,
  onSelect,
  onPin,
  pinPending,
  onDragStart,
  onDragEnter,
  onDragEnd,
}: FragmentRowProps) {
  const visual = useMemo(() => resolveFragmentVisual(fragment, mediaById), [fragment, mediaById])
  const bubbleSet = useMemo(
    () => (!visual.imageUrl ? generateBubbles(fragment.id, fragment.type) : null),
    [fragment.id, fragment.type, visual.imageUrl],
  )

  const boundary = visual.boundary

  return (
    <div
      data-component-id={fragmentComponentId(fragment, 'list-item')}
      draggable={canDrag}
      onDragStart={(e) => onDragStart(index, e)}
      onDragEnter={() => onDragEnter(index)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      className={`group flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-sm transition-all duration-150 hover:bg-accent/50 ${
        selected ? 'bg-accent' : ''
      } ${isDragging ? 'opacity-40 scale-[0.97]' : ''}`}
    >
      {/* Drag handle */}
      {canDrag && (
        <div
          role="presentation"
          className="shrink-0 pt-0.5 cursor-grab opacity-0 group-hover:opacity-50 transition-opacity duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-3.5 text-muted-foreground" data-component-id={fragmentComponentId(fragment, 'drag-handle')} />
        </div>
      )}

      {visual.imageUrl ? (
        boundary && boundary.width < 1 && boundary.height < 1 ? (
          <div
            className="size-9 shrink-0 rounded-lg overflow-hidden border border-border/40 bg-muted bg-no-repeat"
            style={{
              backgroundImage: `url("${visual.imageUrl}")`,
              backgroundSize: `${100 / boundary.width}% ${100 / boundary.height}%`,
              backgroundPosition: `${boundary.width < 1 ? (boundary.x / (1 - boundary.width)) * 100 : 50}% ${boundary.height < 1 ? (boundary.y / (1 - boundary.height)) * 100 : 50}%`,
            }}
          />
        ) : (
          <div className="size-9 shrink-0 rounded-lg overflow-hidden border border-border/40 bg-muted">
            <img src={visual.imageUrl} alt="" className="size-full object-cover" />
          </div>
        )
      ) : bubbleSet ? (
        <div className="size-9 shrink-0 rounded-lg overflow-hidden">
          <svg viewBox="0 0 36 36" className="size-full" aria-hidden>
            <rect width="36" height="36" fill={bubbleSet.bg} />
            {bubbleSet.bubbles.map((b, i) => (
              <BubbleSvgShape key={`${b.cx}-${b.cy}`} b={b} i={i} />
            ))}
          </svg>
        </div>
      ) : null}

      <button
        onClick={() => onSelect(fragment)}
        className="flex-grow w-0 text-left overflow-hidden"
        data-component-id={fragmentComponentId(fragment, 'select')}
      >
        <p className="font-medium text-sm truncate leading-tight">{fragment.name}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[0.625rem] font-mono text-muted-foreground">
            {fragment.id}
          </span>
          {fragment.sticky && (
            <Badge variant="secondary" className="text-[0.5625rem] h-3.5 px-1">
              pinned
            </Badge>
          )}
          {fragment.sticky && fragment.placement === 'system' && (
            <Badge variant="outline" className="text-[0.5625rem] h-3.5 px-1">
              sys
            </Badge>
          )}
          {showType && (
            <Badge variant="outline" className="text-[0.5625rem] h-3.5 px-1">
              {fragment.type}
            </Badge>
          )}
        </div>
        {fragment.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {fragment.description}
          </p>
        )}
      </button>

      {/* Pin button */}
      <Button
        size="icon"
        variant="ghost"
        data-component-id={fragmentComponentId(fragment, 'pin-toggle')}
        className={`size-6 shrink-0 transition-opacity ${
          fragment.sticky
            ? 'opacity-100 text-primary'
            : 'opacity-0 group-hover:opacity-50 hover:opacity-100 hover:text-foreground'
        }`}
        onClick={(e) => {
          e.stopPropagation()
          onPin(fragment)
        }}
        disabled={pinPending}
        title={fragment.sticky ? 'Unpin' : 'Pin to context'}
      >
        <Pin className={`size-3.5 ${fragment.sticky ? 'fill-current' : ''}`} />
      </Button>
    </div>
  )
})

// --- Folder header ---

interface FolderHeaderProps {
  folder: Folder
  count: number
  collapsed: boolean
  isDropTarget: boolean
  isDraggingFolder: boolean
  isFolderDragOver: boolean
  renamingId: string | null
  renameValue: string
  onToggle: () => void
  onRename: (folderId: string) => void
  onRenameChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onDelete: (folderId: string) => void
  onFolderDragStart: (folderId: string, e: React.DragEvent) => void
  onFolderDragEnter: (folderId: string) => void
  onFolderDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragEnter: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

const FolderHeader = memo(function FolderHeader({
  folder,
  count,
  collapsed,
  isDropTarget,
  isDraggingFolder,
  isFolderDragOver,
  renamingId,
  renameValue,
  onToggle,
  onRename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onDelete,
  onFolderDragStart,
  onFolderDragEnter,
  onFolderDragEnd,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}: FolderHeaderProps) {
  const isRenaming = renamingId === folder.id
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  return (
    <div
      draggable={!isRenaming}
      onDragStart={(e) => onFolderDragStart(folder.id, e)}
      onDragEnd={onFolderDragEnd}
      onDragOver={(e) => {
        onDragOver(e)
        // Also handle folder reorder drag-over
        e.preventDefault()
      }}
      onDragEnter={(e) => {
        onDragEnter(e)
        onFolderDragEnter(folder.id)
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group/folder flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors select-none ${
        isDropTarget
          ? 'bg-primary/15 ring-1 ring-primary/30'
          : isFolderDragOver
            ? 'bg-accent/40 ring-1 ring-accent/50'
            : 'hover:bg-accent/30'
      } ${isDraggingFolder ? 'opacity-40 scale-[0.97]' : ''}`}
    >
      {/* Drag handle + Collapse chevron */}
      <div className="shrink-0 flex items-center">
        <div className="cursor-grab opacity-0 group-hover/folder:opacity-40 transition-opacity -mr-0.5">
          <GripVertical className="size-2.5 text-muted-foreground" />
        </div>
        <button
          onClick={onToggle}
          className="p-0.5 rounded hover:bg-accent/50 transition-colors"
        >
          <ChevronRight
            className={`size-3 text-muted-foreground transition-transform duration-150 ${
              !collapsed ? 'rotate-90' : ''
            }`}
          />
        </button>
      </div>

      {/* Folder icon with optional color accent */}
      <FolderOpen
        className="size-3.5 shrink-0"
        style={folder.color ? { color: folder.color } : undefined}
      />

      {/* Name — inline editable */}
      {isRenaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameCommit()
            if (e.key === 'Escape') onRenameCancel()
          }}
          onBlur={onRenameCommit}
          className="flex-1 min-w-0 text-xs font-medium bg-transparent border-b border-primary/40 outline-none px-0.5 py-0"
          maxLength={50}
        />
      ) : (
        <button
          onClick={onToggle}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onRename(folder.id)
          }}
          className="flex-1 min-w-0 text-left"
        >
          <span className="text-xs font-medium truncate block">{folder.name}</span>
        </button>
      )}

      {/* Count badge */}
      <span className="text-[0.625rem] text-muted-foreground tabular-nums shrink-0">
        {count}
      </span>

      {/* Context menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="shrink-0 p-0.5 rounded opacity-0 group-hover/folder:opacity-60 hover:!opacity-100 transition-opacity">
            <MoreHorizontal className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[120px]">
          <DropdownMenuItem onClick={() => onRename(folder.id)}>
            <Pencil className="size-3 mr-2" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onDelete(folder.id)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})

// --- Uncategorized header (drop target to remove folder assignment) ---

interface UncategorizedHeaderProps {
  count: number
  collapsed: boolean
  isDropTarget: boolean
  onToggle: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragEnter: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

function UncategorizedHeader({
  count,
  collapsed,
  isDropTarget,
  onToggle,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}: UncategorizedHeaderProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors select-none ${
        isDropTarget
          ? 'bg-primary/15 ring-1 ring-primary/30'
          : 'hover:bg-accent/30'
      }`}
    >
      <button
        onClick={onToggle}
        className="shrink-0 p-0.5 rounded hover:bg-accent/50 transition-colors"
      >
        <ChevronRight
          className={`size-3 text-muted-foreground transition-transform duration-150 ${
            !collapsed ? 'rotate-90' : ''
          }`}
        />
      </button>
      <button onClick={onToggle} className="flex-1 min-w-0 text-left">
        <span className="text-xs text-muted-foreground italic truncate block">Uncategorized</span>
      </button>
      <span className="text-[0.625rem] text-muted-foreground tabular-nums shrink-0">
        {count}
      </span>
    </div>
  )
}

// --- Folder group types ---

interface FolderGroup {
  folder: Folder | null // null = uncategorized
  fragments: Fragment[]
}

type SortMode = 'name' | 'newest' | 'oldest' | 'order'

export function FragmentList({
  storyId,
  type,
  allowedTypes,
  listIdBase,
  onSelect,
  onCreateNew,
  onImport,
  onImportCard,
  selectedId,
}: FragmentListProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('order')
  const queryClient = useQueryClient()
  const dragItem = useRef<number | null>(null)
  const [dragFragmentId, setDragFragmentId] = useState<string | null>(null)
  const [dragDisplayOrder, setDragDisplayOrder] = useState<Fragment[] | null>(null)
  const [isDragOverArchive, setIsDragOverArchive] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null)
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null)
  const [folderDragOverId, setFolderDragOverId] = useState<string | null>(null)
  const [folderDisplayOrder, setFolderDisplayOrder] = useState<Folder[] | null>(null)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newFolderId, setNewFolderId] = useState<string | null>(null)

  const { data: fragments, isLoading } = useQuery({
    queryKey: ['fragments', storyId, type, allowedTypes?.join(',') ?? 'all'],
    queryFn: () => api.fragments.list(storyId, type),
    staleTime: 2_000,
  })

  const { data: foldersData } = useQuery({
    queryKey: ['folders', storyId],
    queryFn: () => api.folders.list(storyId),
    staleTime: 5_000,
  })
  const folders = foldersData?.folders
  const folderAssignments = foldersData?.assignments ?? {}

  const { data: imageFragments } = useQuery({
    queryKey: ['fragments', storyId, 'image'],
    queryFn: () => api.fragments.list(storyId, 'image'),
    staleTime: 10_000,
  })

  const { data: iconFragments } = useQuery({
    queryKey: ['fragments', storyId, 'icon'],
    queryFn: () => api.fragments.list(storyId, 'icon'),
    staleTime: 10_000,
  })

  const pinMutation = useMutation({
    mutationFn: (fragment: Fragment) =>
      api.fragments.update(storyId, fragment.id, {
        name: fragment.name,
        description: fragment.description,
        content: fragment.content,
        sticky: !fragment.sticky,
      }),
    onSuccess: (_data, fragment) => {
      queryClient.invalidateQueries({
        queryKey: ['fragments', storyId],
        predicate: (q) => {
          const typeSlot = q.queryKey[2]
          return typeSlot === undefined || typeSlot === fragment.type
        },
      })
      queryClient.invalidateQueries({ queryKey: ['fragment', storyId, fragment.id] })
    },
  })

  const fragmentsQueryKey = ['fragments', storyId, type, allowedTypes?.join(',') ?? 'all']

  const reorderMutation = useMutation({
    mutationFn: (items: Array<{ id: string; order: number }>) =>
      api.fragments.reorder(storyId, items),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: ['fragments', storyId] })
      const previous = queryClient.getQueryData<Fragment[]>(fragmentsQueryKey)
      queryClient.setQueryData<Fragment[]>(fragmentsQueryKey, (old) => {
        if (!old) return old
        const orderMap = new Map(items.map((item) => [item.id, item.order]))
        return old
          .map((f) => (orderMap.has(f.id) ? { ...f, order: orderMap.get(f.id)! } : f))
          .sort((a, b) => a.order - b.order)
      })
      return { previous }
    },
    onError: (_err, _items, context) => {
      if (context?.previous) {
        queryClient.setQueryData(fragmentsQueryKey, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['fragments', storyId],
        predicate: (q) => {
          const typeSlot = q.queryKey[2]
          return typeSlot === undefined || typeSlot === type
        },
      })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (fragmentId: string) => api.fragments.archive(storyId, fragmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragments', storyId] })
      queryClient.invalidateQueries({ queryKey: ['fragments-archived', storyId] })
      queryClient.invalidateQueries({ queryKey: ['proseChain', storyId] })
    },
  })

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.folders.create(storyId, name),
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ['folders', storyId] })
      // Keep the new empty folder visible until it gets its first fragment
      setNewFolderId(folder.id)
      // Start renaming the new folder immediately
      setRenamingFolderId(folder.id)
      setRenameValue(folder.name)
    },
  })

  const renameFolderMutation = useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      api.folders.update(storyId, folderId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders', storyId] })
    },
  })

  const deleteFolderMutation = useMutation({
    mutationFn: (folderId: string) => api.folders.delete(storyId, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders', storyId] })
    },
  })

  const assignFolderMutation = useMutation({
    mutationFn: ({ fragmentId, folderId }: { fragmentId: string; folderId: string | null }) =>
      api.folders.assignFragment(storyId, fragmentId, folderId),
    onSuccess: (_data, { folderId }) => {
      queryClient.invalidateQueries({ queryKey: ['folders', storyId] })
      // Clear the "just-created" exception once a fragment is assigned to it
      if (folderId === newFolderId) setNewFolderId(null)
    },
  })

  const reorderFoldersMutation = useMutation({
    mutationFn: (items: Array<{ id: string; order: number }>) =>
      api.folders.reorder(storyId, items),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: ['folders', storyId] })
      const previous = queryClient.getQueryData<Folder[]>(['folders', storyId])
      queryClient.setQueryData<Folder[]>(['folders', storyId], (old) => {
        if (!old) return old
        const orderMap = new Map(items.map((item) => [item.id, item.order]))
        return old
          .map((f) => (orderMap.has(f.id) ? { ...f, order: orderMap.get(f.id)! } : f))
          .sort((a, b) => a.order - b.order)
      })
      return { previous }
    },
    onError: (_err, _items, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['folders', storyId], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['folders', storyId] })
    },
  })

  // Stable callback refs so FragmentRow memo is never defeated
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const stableOnSelect = useCallback((fragment: Fragment) => {
    onSelectRef.current(fragment)
  }, [])

  const pinMutateRef = useRef(pinMutation.mutate)
  pinMutateRef.current = pinMutation.mutate
  const stableOnPin = useCallback((fragment: Fragment) => {
    pinMutateRef.current(fragment)
  }, [])

  const showType = type === undefined || !!allowedTypes?.length
  const canDrag = sort === 'order' && !search.trim()
  const isSearching = !!search.trim()
  const hasFolders = (folders?.length ?? 0) > 0

  const filtered = useMemo(() => {
    if (!fragments) return []
    let list = [...fragments]

    // Markers are managed through the prose chain, not the sidebar
    list = list.filter((f) => f.type !== 'marker')

    if (allowedTypes && allowedTypes.length > 0) {
      list = list.filter((f) => allowedTypes.includes(f.type))
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q),
      )
    }

    switch (sort) {
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'newest':
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        break
      case 'oldest':
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        break
      case 'order':
      default:
        list.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
        break
    }

    return list
  }, [fragments, search, sort, allowedTypes])

  // The effective flat list: during drag it's the live-reordered list, otherwise filtered
  const effectiveList = dragDisplayOrder ?? filtered

  // Group fragments by folder (only when not searching and folders exist)
  const folderGroups = useMemo((): FolderGroup[] => {
    if (isSearching || !hasFolders) return []

    // Use live display order during folder drag, otherwise sort from query data
    const sortedFolders = folderDisplayOrder
      ? [...folderDisplayOrder]
      : [...(folders ?? [])].sort((a, b) => a.order - b.order)
    const byFolder = new Map<string | null, Fragment[]>()

    // Initialize folder buckets
    for (const folder of sortedFolders) {
      byFolder.set(folder.id, [])
    }
    byFolder.set(null, [])

    // Distribute from the effective list so drag-reorder is reflected live
    for (const fragment of effectiveList) {
      const folderId = folderAssignments[fragment.id] ?? null
      const validFolder = folderId && byFolder.has(folderId) ? folderId : null
      byFolder.get(validFolder)!.push(fragment)
    }

    // Only show folders that contain at least one fragment of the current type,
    // plus any just-created folder so users can drag fragments into it
    const groups: FolderGroup[] = []
    for (const folder of sortedFolders) {
      const folderFragments = byFolder.get(folder.id)!
      if (folderFragments.length > 0 || folder.id === newFolderId) {
        groups.push({ folder, fragments: folderFragments })
      }
    }
    // Uncategorized always last
    const uncategorized = byFolder.get(null)!
    if (uncategorized.length > 0 || groups.length > 0) {
      groups.push({ folder: null, fragments: uncategorized })
    }

    return groups
  }, [effectiveList, folders, folderAssignments, folderDisplayOrder, isSearching, hasFolders, newFolderId])

  // Map fragment ID → index in the effective flat list, so grouped view
  // can pass correct global indices to the drag handlers
  const fragmentIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = 0; i < effectiveList.length; i++) {
      map.set(effectiveList[i].id, i)
    }
    return map
  }, [effectiveList])

  const useGroupedView = !isSearching && hasFolders && folderGroups.length > 0

  const mediaById = useMemo(() => {
    const map = new Map<string, Fragment>()
    for (const fragment of imageFragments ?? []) {
      map.set(fragment.id, fragment)
    }
    for (const fragment of iconFragments ?? []) {
      map.set(fragment.id, fragment)
    }
    return map
  }, [imageFragments, iconFragments])

  // Drag handlers — live shifting + optimistic reorder
  const filteredRef = useRef(filtered)
  filteredRef.current = filtered
  const reorderMutateRef = useRef(reorderMutation.mutate)
  reorderMutateRef.current = reorderMutation.mutate

  const handleDragStart = useCallback((index: number, e: React.DragEvent) => {
    dragItem.current = index
    const list = filteredRef.current
    const id = list[index]?.id ?? null
    setDragFragmentId(id)
    setDragDisplayOrder([...list])
    if (id) {
      e.dataTransfer.setData('application/x-errata-fragment-id', id)
      e.dataTransfer.effectAllowed = 'move'
    }
  }, [])

  const handleDragEnter = useCallback((index: number) => {
    if (dragItem.current === null || dragItem.current === index) return
    setDragDisplayOrder((prev) => {
      if (!prev) return prev
      const reordered = [...prev]
      const [removed] = reordered.splice(dragItem.current!, 1)
      reordered.splice(index, 0, removed)
      dragItem.current = index
      return reordered
    })
  }, [])

  const droppedOnArchiveRef = useRef(false)
  const droppedOnFolderRef = useRef(false)

  const handleDragEnd = useCallback(() => {
    if (droppedOnArchiveRef.current || droppedOnFolderRef.current) {
      droppedOnArchiveRef.current = false
      droppedOnFolderRef.current = false
      dragItem.current = null
      setDragFragmentId(null)
      setDragDisplayOrder(null)
      setDropTargetFolderId(null)
      return
    }

    const displayOrder = dragDisplayOrderRef.current
    if (!displayOrder) {
      setDragFragmentId(null)
      setDragDisplayOrder(null)
      setDropTargetFolderId(null)
      return
    }

    // Only send fragments whose order actually changed
    const items = displayOrder
      .map((f, i) => ({ id: f.id, order: i }))
      .filter((item) => {
        const original = filteredRef.current.find((f) => f.id === item.id)
        return original && original.order !== item.order
      })
    if (items.length > 0) {
      reorderMutateRef.current(items)
    }

    dragItem.current = null
    setDragFragmentId(null)
    setDragDisplayOrder(null)
    setDropTargetFolderId(null)
  }, [])

  const dragDisplayOrderRef = useRef(dragDisplayOrder)
  dragDisplayOrderRef.current = dragDisplayOrder

  // Folder drop handlers (for fragment → folder assignment)
  const assignFolderRef = useRef(assignFolderMutation.mutate)
  assignFolderRef.current = assignFolderMutation.mutate
  const dragFragmentIdRef = useRef(dragFragmentId)
  dragFragmentIdRef.current = dragFragmentId
  const draggingFolderIdRef = useRef(draggingFolderId)
  draggingFolderIdRef.current = draggingFolderId

  const makeFolderDropHandlers = useCallback((folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault()
      // Only show fragment-assignment highlight when a fragment is being dragged
      if (dragFragmentIdRef.current && !draggingFolderIdRef.current) {
        setDropTargetFolderId(folderId)
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const { clientX, clientY } = e
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        setDropTargetFolderId((prev) => prev === folderId ? null : prev)
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      // Only assign fragment to folder if a fragment (not a folder) is being dragged
      if (draggingFolderIdRef.current) {
        setDropTargetFolderId(null)
        return
      }
      const fragId = dragFragmentIdRef.current ?? e.dataTransfer.getData('application/x-errata-fragment-id')
      if (fragId) {
        droppedOnFolderRef.current = true
        assignFolderRef.current({ fragmentId: fragId, folderId })
      }
      setDropTargetFolderId(null)
    },
  }), [])

  // Folder actions
  const handleToggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }, [])

  const handleStartRename = useCallback((folderId: string) => {
    const folder = folders?.find((f) => f.id === folderId)
    if (folder) {
      setRenamingFolderId(folderId)
      setRenameValue(folder.name)
    }
  }, [folders])

  const handleRenameCommit = useCallback(() => {
    if (renamingFolderId && renameValue.trim()) {
      renameFolderMutation.mutate({ folderId: renamingFolderId, name: renameValue.trim() })
    }
    setRenamingFolderId(null)
  }, [renamingFolderId, renameValue, renameFolderMutation])

  const handleRenameCancel = useCallback(() => {
    setRenamingFolderId(null)
  }, [])

  const handleDeleteFolder = useCallback((folderId: string) => {
    deleteFolderMutation.mutate(folderId)
  }, [deleteFolderMutation])

  const handleCreateFolder = useCallback(() => {
    createFolderMutation.mutate('New Folder')
  }, [createFolderMutation])

  // Folder drag-reorder handlers
  const folderDragItemRef = useRef<string | null>(null)
  const foldersRef = useRef(folders)
  foldersRef.current = folders
  const reorderFoldersMutateRef = useRef(reorderFoldersMutation.mutate)
  reorderFoldersMutateRef.current = reorderFoldersMutation.mutate
  const folderDisplayOrderRef = useRef(folderDisplayOrder)
  folderDisplayOrderRef.current = folderDisplayOrder

  const handleFolderDragStart = useCallback((folderId: string, e: React.DragEvent) => {
    // Don't start folder drag if a fragment is already being dragged
    if (dragFragmentIdRef.current) return
    folderDragItemRef.current = folderId
    setDraggingFolderId(folderId)
    const sorted = [...(foldersRef.current ?? [])].sort((a, b) => a.order - b.order)
    setFolderDisplayOrder(sorted)
    e.dataTransfer.setData('application/x-errata-folder-id', folderId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleFolderDragEnter = useCallback((targetFolderId: string) => {
    const dragId = folderDragItemRef.current
    if (!dragId || dragId === targetFolderId) {
      // Not a folder drag or same target — clear folder drag-over highlight
      if (!dragId) setFolderDragOverId(null)
      return
    }
    setFolderDragOverId(targetFolderId)
    setFolderDisplayOrder((prev) => {
      if (!prev) return prev
      const fromIdx = prev.findIndex((f) => f.id === dragId)
      const toIdx = prev.findIndex((f) => f.id === targetFolderId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const reordered = [...prev]
      const [removed] = reordered.splice(fromIdx, 1)
      reordered.splice(toIdx, 0, removed)
      return reordered
    })
  }, [])

  const handleFolderDragEnd = useCallback(() => {
    const displayOrder = folderDisplayOrderRef.current
    if (displayOrder && folderDragItemRef.current) {
      const items = displayOrder
        .map((f, i) => ({ id: f.id, order: i }))
        .filter((item) => {
          const original = foldersRef.current?.find((f) => f.id === item.id)
          return original && original.order !== item.order
        })
      if (items.length > 0) {
        reorderFoldersMutateRef.current(items)
      }
    }
    folderDragItemRef.current = null
    setDraggingFolderId(null)
    setFolderDragOverId(null)
    setFolderDisplayOrder(null)
  }, [])

  const displayList = dragDisplayOrder ?? filtered

  if (isLoading) {
    return <p className="text-sm text-muted-foreground p-4">Loading...</p>
  }

  // Render a list of fragments (used both in flat and grouped views)
  const renderFragmentList = (fragmentList: Fragment[]) => (
    <>
      {fragmentList.map((fragment) => {
        const globalIndex = fragmentIndexMap.get(fragment.id) ?? 0
        return (
          <FragmentRow
            key={fragment.id}
            fragment={fragment}
            index={globalIndex}
            selected={selectedId === fragment.id}
            isDragging={dragFragmentId === fragment.id}
            canDrag={canDrag}
            showType={showType}
            mediaById={mediaById}
            onSelect={stableOnSelect}
            onPin={stableOnPin}
            pinPending={pinMutation.isPending}
            onDragStart={handleDragStart}
            onDragEnter={handleDragEnter}
            onDragEnd={handleDragEnd}
          />
        )
      })}
    </>
  )

  return (
    <div className="flex flex-col h-full" data-component-id={listIdBase ?? componentId(type ?? 'fragment', 'sidebar-list')}>
      {/* Search + Sort controls */}
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-border/50" data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'list-controls')}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="h-7 text-xs bg-transparent"
          data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'list-search')}
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-0.5">
            {([
              { mode: 'order' as SortMode, tip: 'Sort by manual order' },
              { mode: 'name' as SortMode, tip: 'Sort alphabetically' },
              { mode: 'newest' as SortMode, tip: 'Sort by newest first' },
              { mode: 'oldest' as SortMode, tip: 'Sort by oldest first' },
            ]).map(({ mode, tip }) => (
              <Tooltip key={mode}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSort(mode)}
                    data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'sort', mode)}
                    className={`text-[0.625rem] px-1.5 py-0.5 rounded transition-colors ${
                      sort === mode
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-muted-foreground'
                    }`}
                  >
                    {mode}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{tip}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="flex gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={handleCreateFolder}
                  disabled={createFolderMutation.isPending}
                >
                  <FolderPlus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New folder</TooltipContent>
            </Tooltip>
            {onImportCard && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="size-6 text-muted-foreground hover:text-foreground" onClick={onImportCard} data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'import-card-button')}>
                    <UserPlus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Import character card</TooltipContent>
              </Tooltip>
            )}
            {onImport && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="size-6 text-muted-foreground hover:text-foreground" onClick={onImport} data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'import-button')}>
                    <FileDown className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Import from clipboard or file</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="size-6 text-muted-foreground hover:text-foreground" onClick={onCreateNew} data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'create-button')}>
                  <Plus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Create new fragment</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Pinning info */}
      <div className="px-3 py-2.5 border-b border-border/30">
        <p className="text-[0.625rem] text-muted-foreground leading-relaxed">
          <Pin className="size-2.5 inline -mt-0.5 mr-0.5" />
          Pinned fragments are always sent to the model. Unpinned ones appear as a shortlist.
        </p>
      </div>

      <ScrollArea className="flex-1 min-h-0" data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'list-scroll')}>
        <div className="p-2 space-y-0.5" data-component-id={componentId(listIdBase ?? type ?? 'fragment', 'list-items')}>
          {/* Grouped view */}
          {useGroupedView && (
            <>
              {folderGroups.map((group) => {
                const folderId = group.folder?.id ?? '__uncategorized__'
                const isCollapsed = collapsedFolders.has(folderId)
                const dropHandlers = makeFolderDropHandlers(group.folder?.id ?? null)

                return (
                  <div key={folderId} className="mb-1">
                    {group.folder ? (
                      <FolderHeader
                        folder={group.folder}
                        count={group.fragments.length}
                        collapsed={isCollapsed}
                        isDropTarget={dropTargetFolderId === group.folder.id}
                        isDraggingFolder={draggingFolderId === group.folder.id}
                        isFolderDragOver={folderDragOverId === group.folder.id}
                        renamingId={renamingFolderId}
                        renameValue={renameValue}
                        onToggle={() => handleToggleFolder(folderId)}
                        onRename={handleStartRename}
                        onRenameChange={setRenameValue}
                        onRenameCommit={handleRenameCommit}
                        onRenameCancel={handleRenameCancel}
                        onDelete={handleDeleteFolder}
                        onFolderDragStart={handleFolderDragStart}
                        onFolderDragEnter={handleFolderDragEnter}
                        onFolderDragEnd={handleFolderDragEnd}
                        {...dropHandlers}
                      />
                    ) : (
                      <UncategorizedHeader
                        count={group.fragments.length}
                        collapsed={isCollapsed}
                        isDropTarget={dropTargetFolderId === null && dragFragmentId !== null}
                        onToggle={() => handleToggleFolder(folderId)}
                        {...dropHandlers}
                      />
                    )}
                    {!isCollapsed && group.fragments.length > 0 && (
                      <div className="ml-3 border-l border-border/20 pl-0.5 mt-0.5">
                        {renderFragmentList(group.fragments)}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* Flat view (search active or no folders) */}
          {!useGroupedView && (
            <>
              {displayList.length === 0 && (
                <p className="text-xs text-muted-foreground py-8 text-center italic">
                  {search.trim() ? 'No matches' : 'No fragments yet'}
                </p>
              )}
              {displayList.map((fragment, index) => (
                <FragmentRow
                  key={fragment.id}
                  fragment={fragment}
                  index={index}
                  selected={selectedId === fragment.id}
                  isDragging={dragFragmentId === fragment.id}
                  canDrag={canDrag}
                  showType={showType}
                  mediaById={mediaById}
                  onSelect={stableOnSelect}
                  onPin={stableOnPin}
                  pinPending={pinMutation.isPending}
                  onDragStart={handleDragStart}
                  onDragEnter={handleDragEnter}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </>
          )}

          {/* Archive drop zone — visible during drag */}
          {dragFragmentId && (
            <div
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
              onDragEnter={() => setIsDragOverArchive(true)}
              onDragLeave={() => setIsDragOverArchive(false)}
              onDrop={() => {
                if (dragFragmentId) {
                  droppedOnArchiveRef.current = true
                  archiveMutation.mutate(dragFragmentId)
                }
                setIsDragOverArchive(false)
              }}
              className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed py-4 mt-2 transition-colors ${
                isDragOverArchive
                  ? 'border-destructive/60 bg-destructive/10 text-destructive'
                  : 'border-muted-foreground/30 text-muted-foreground'
              }`}
            >
              <Archive className="size-4" />
              <span className="text-xs font-medium">Drop to archive</span>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
