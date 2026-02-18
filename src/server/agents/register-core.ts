import { registerLibrarianAgents } from '../librarian/agents'
import { registerChapterAgents } from '../chapters/agents'

let registered = false

export function ensureCoreAgentsRegistered(): void {
  if (registered) return
  registerLibrarianAgents()
  registerChapterAgents()
  registered = true
}
