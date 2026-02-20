// Auto-discover agent modules from src/server/*/agents.ts
// Adding a new agent only requires creating src/server/<name>/agents.ts with a `register` export.
const agentModules = import.meta.glob<{ register: () => void }>(
  '../*/agents.ts',
  { eager: true },
)

let registered = false

export function ensureCoreAgentsRegistered(): void {
  if (registered) return
  for (const [, mod] of Object.entries(agentModules)) {
    if (typeof mod.register === 'function') {
      mod.register()
    }
  }
  registered = true
}
