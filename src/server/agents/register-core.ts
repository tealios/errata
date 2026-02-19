import { registerLibrarianAgents } from '../librarian/agents'
import { registerChapterAgents } from '../chapters/agents'
import { registerCharacterChatAgents } from '../character-chat/agents'

let registered = false

export function ensureCoreAgentsRegistered(): void {
  if (registered) return
  registerLibrarianAgents()
  registerChapterAgents()
  registerCharacterChatAgents()
  registered = true
}
