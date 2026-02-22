import type { Fragment } from '@/lib/api'
import { resolveFragmentVisual } from '@/lib/fragment-visuals'

export function CharacterAvatar({ character, mediaById, size = 'md' }: {
  character: Fragment
  mediaById: Map<string, Fragment>
  size?: 'sm' | 'md' | 'lg'
}) {
  const visual = resolveFragmentVisual(character, mediaById)
  const sizeClass = size === 'sm' ? 'size-6' : size === 'lg' ? 'w-14 h-14' : 'size-9'
  const textClass = size === 'sm' ? 'text-[10px]' : size === 'lg' ? 'text-xl' : 'text-sm'

  if (visual.imageUrl) {
    const boundary = visual.boundary
    if (boundary && boundary.width < 1 && boundary.height < 1) {
      const bgPosX = boundary.x / (1 - boundary.width) * 100
      const bgPosY = boundary.y / (1 - boundary.height) * 100
      return (
        <div
          className={`${sizeClass} shrink-0 rounded-full overflow-hidden border border-primary/10 bg-muted bg-no-repeat`}
          style={{
            backgroundImage: `url("${visual.imageUrl}")`,
            backgroundSize: `${100 / boundary.width}% ${100 / boundary.height}%`,
            backgroundPosition: `${bgPosX}% ${bgPosY}%`,
          }}
        />
      )
    }
    return (
      <div className={`${sizeClass} shrink-0 rounded-full overflow-hidden border border-primary/10 bg-muted`}>
        <img src={visual.imageUrl} alt="" className="size-full object-cover" />
      </div>
    )
  }

  return (
    <div className={`${sizeClass} shrink-0 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center`}>
      <span className={`font-display ${textClass} text-primary/60`}>
        {character.name.charAt(0)}
      </span>
    </div>
  )
}
