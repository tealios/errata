import { KeybindsPanel } from './Panel'
import { startKeybindRuntime, stopKeybindRuntime } from './runtime'

export const pluginName = 'keybinds'
export const panel = KeybindsPanel
export const activate = () => startKeybindRuntime()
export const deactivate = () => stopKeybindRuntime()
