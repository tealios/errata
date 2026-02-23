// API Client - Re-exports all modules for backward compatibility

// Types
export * from './types'

// API Modules
export { stories } from './stories'
export { fragments } from './fragments'
export { generation } from './generation'
export { librarian } from './librarian'
export { config } from './config'
export { proseChain } from './prose-chain'
export { plugins } from './plugins'
export { settings } from './settings'
export { blocks } from './blocks'
export { branches } from './branches'
export { chapters } from './chapters'
export { characterChat } from './character-chat'
export { agentBlocks } from './agent-blocks'
export { agents } from './agents'
export { tokenUsage } from './token-usage'
export { folders } from './folders'

// HTTP Client utilities (exported for advanced use cases)
export { apiFetch, fetchStream, fetchEventStream } from './client'

// Combined API object for backward compatibility
import { stories } from './stories'
import { fragments } from './fragments'
import { generation } from './generation'
import { librarian } from './librarian'
import { config } from './config'
import { proseChain } from './prose-chain'
import { plugins } from './plugins'
import { settings } from './settings'
import { blocks } from './blocks'
import { branches } from './branches'
import { chapters } from './chapters'
import { characterChat } from './character-chat'
import { agentBlocks } from './agent-blocks'
import { agents } from './agents'
import { tokenUsage } from './token-usage'
import { folders } from './folders'

export const api = {
  stories,
  fragments,
  generation,
  librarian,
  config,
  proseChain,
  plugins,
  settings,
  blocks,
  branches,
  chapters,
  characterChat,
  agentBlocks,
  agents,
  tokenUsage,
  folders,
}
