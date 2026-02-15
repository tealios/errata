import type { WritingPlugin } from '@tealios/errata-plugin-sdk'

const plugin: WritingPlugin = {
  manifest: {
    name: 'keybinds',
    version: '0.1.0',
    description: 'Configurable keyboard shortcuts for prose navigation and panels',
    panel: {
      title: 'Keybinds',
      icon: { type: 'lucide', name: 'Keyboard' },
    },
  },
}

export default plugin
