import { createContext, useContext, useMemo } from 'react'
import type { Fragment } from '@/lib/api'

interface CharacterMentionContextValue {
  getCharacter: (id: string) => Fragment | undefined
  mediaById: Map<string, Fragment>
}

const CharacterMentionContext = createContext<CharacterMentionContextValue | null>(null)

export function CharacterMentionProvider({
  characters,
  mediaById,
  children,
}: {
  characters: Fragment[]
  mediaById: Map<string, Fragment>
  children: React.ReactNode
}) {
  const value = useMemo(() => {
    const charMap = new Map<string, Fragment>()
    for (const c of characters) charMap.set(c.id, c)
    return {
      getCharacter: (id: string) => charMap.get(id),
      mediaById,
    }
  }, [characters, mediaById])

  return (
    <CharacterMentionContext.Provider value={value}>
      {children}
    </CharacterMentionContext.Provider>
  )
}

export function useCharacterMentionContext() {
  return useContext(CharacterMentionContext)
}
