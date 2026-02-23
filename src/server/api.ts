import { Elysia } from 'elysia'
import { pluginRegistry } from './plugins/registry'
import { getRuntimePluginUi } from './plugins/runtime-ui'
import { instructionRegistry } from './instructions'
import { dirname, extname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { storyRoutes } from './routes/stories'
import { branchRoutes } from './routes/branches'
import { fragmentRoutes } from './routes/fragments'
import { blockRoutes } from './routes/blocks'
import { librarianRoutes } from './routes/librarian'
import { characterChatRoutes } from './routes/character-chat'
import { generationRoutes } from './routes/generation'
import { proseChainRoutes } from './routes/prose-chain'
import { configRoutes } from './routes/config'
import { agentBlockRoutes } from './routes/agent-blocks'
import { tokenUsageRoutes } from './routes/token-usage'
import { folderRoutes } from './routes/folders'

const DATA_DIR = process.env.DATA_DIR ?? './data'

function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase()
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.js': return 'application/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.ico': return 'image/x-icon'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

export function createApp(dataDir: string = DATA_DIR) {
  const app = new Elysia({ prefix: '/api' })
    .get('/health', () => ({ status: 'ok' }))

    // --- Plugins ---
    .get('/plugins', () => {
      return pluginRegistry.listAll().map((p) => {
        const runtimeUi = getRuntimePluginUi(p.manifest.name)
        if (!runtimeUi) return p.manifest

        return {
          ...p.manifest,
          panel: p.manifest.panel
            ? {
              ...p.manifest.panel,
              mode: 'iframe',
              url: `/api/plugins/${p.manifest.name}/ui/`,
            }
            : undefined,
        }
      })
    })
    .get('/plugins/:pluginName/ui/*', ({ params, set }) => {
      const runtimeUi = getRuntimePluginUi(params.pluginName)
      if (!runtimeUi) {
        set.status = 404
        return { error: 'Plugin UI not found' }
      }

      const requestedAsset = (params as Record<string, string>)['*'] ?? ''
      const entryPath = resolve(runtimeUi.pluginRoot, runtimeUi.entryFile)
      const baseDir = dirname(entryPath)
      const targetPath = requestedAsset ? resolve(baseDir, requestedAsset) : entryPath

      const normalizedRoot = runtimeUi.pluginRoot.replace(/\\/g, '/').toLowerCase()
      const normalizedTarget = targetPath.replace(/\\/g, '/').toLowerCase()
      if (!normalizedTarget.startsWith(`${normalizedRoot}/`) && normalizedTarget !== normalizedRoot) {
        set.status = 403
        return { error: 'Access denied' }
      }

      if (!existsSync(targetPath)) {
        set.status = 404
        return { error: 'Plugin asset not found' }
      }

      return new Response(Bun.file(targetPath), {
        headers: {
          'content-type': contentTypeForPath(targetPath),
          'cache-control': 'no-cache',
        },
      })
    })

    // --- Route modules ---
    .use(storyRoutes(dataDir))
    .use(branchRoutes(dataDir))
    .use(fragmentRoutes(dataDir))
    .use(blockRoutes(dataDir))
    .use(librarianRoutes(dataDir))
    .use(characterChatRoutes(dataDir))
    .use(generationRoutes(dataDir))
    .use(proseChainRoutes(dataDir))
    .use(configRoutes(dataDir))
    .use(agentBlockRoutes(dataDir))
    .use(tokenUsageRoutes(dataDir))
    .use(folderRoutes(dataDir))

  // Load instruction overrides after agents are registered (route imports trigger agent registration)
  instructionRegistry.loadOverridesSync(dataDir)

  // Mount plugin routes
  for (const plugin of pluginRegistry.listAll()) {
    if (plugin.routes) {
      const pluginApp = new Elysia({ prefix: `/plugins/${plugin.manifest.name}` })
      plugin.routes(pluginApp as unknown as Elysia)
      app.use(pluginApp)
    }
  }

  return app
}
