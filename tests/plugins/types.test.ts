import { describe, it, expect } from 'vitest'
import type { WritingPlugin } from '@/server/plugins/types'

describe('WritingPlugin types', () => {
  it('accepts a full plugin with all fields', () => {
    const plugin: WritingPlugin = {
      manifest: {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A full test plugin',
      },
      fragmentTypes: [
        {
          type: 'timeline',
          prefix: 'tl',
          stickyByDefault: false,
          contextRenderer: (f) => `[${f.name}] ${f.content}`,
        },
      ],
      tools: (_dataDir, _storyId) => ({}),
      routes: (app) => app,
      hooks: {
        beforeContext: (ctx) => ctx,
        beforeGeneration: (msgs) => msgs,
        afterGeneration: (result) => result,
        afterSave: () => {},
      },
    }

    expect(plugin.manifest.name).toBe('test-plugin')
    expect(plugin.fragmentTypes).toHaveLength(1)
    expect(plugin.hooks?.beforeContext).toBeDefined()
    expect(plugin.hooks?.afterSave).toBeDefined()
  })

  it('accepts a minimal plugin with manifest only', () => {
    const plugin: WritingPlugin = {
      manifest: {
        name: 'minimal',
        version: '0.1.0',
        description: 'Minimal plugin',
      },
    }

    expect(plugin.manifest.name).toBe('minimal')
    expect(plugin.fragmentTypes).toBeUndefined()
    expect(plugin.tools).toBeUndefined()
    expect(plugin.routes).toBeUndefined()
    expect(plugin.hooks).toBeUndefined()
  })

  it('accepts a plugin with panel metadata', () => {
    const plugin: WritingPlugin = {
      manifest: {
        name: 'panel-plugin',
        version: '1.0.0',
        description: 'Plugin with sidebar panel',
        panel: { title: 'My Panel' },
      },
    }

    expect(plugin.manifest.panel).toEqual({ title: 'My Panel' })
  })

  it('panel metadata is optional', () => {
    const plugin: WritingPlugin = {
      manifest: {
        name: 'no-panel',
        version: '1.0.0',
        description: 'Plugin without panel',
      },
    }

    expect(plugin.manifest.panel).toBeUndefined()
  })
})
