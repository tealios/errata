export function definePlugin(plugin) {
  return plugin
}

export const createPlugin = definePlugin

export function findBlock(blocks, id) {
  return blocks.find(b => b.id === id)
}

export function replaceBlockContent(blocks, id, content) {
  return blocks.map(b => b.id === id ? { ...b, content } : b)
}

export function removeBlock(blocks, id) {
  return blocks.filter(b => b.id !== id)
}

export function insertBlockBefore(blocks, targetId, block) {
  const idx = blocks.findIndex(b => b.id === targetId)
  if (idx === -1) return [...blocks, block]
  return [...blocks.slice(0, idx), block, ...blocks.slice(idx)]
}

export function insertBlockAfter(blocks, targetId, block) {
  const idx = blocks.findIndex(b => b.id === targetId)
  if (idx === -1) return [...blocks, block]
  return [...blocks.slice(0, idx + 1), block, ...blocks.slice(idx + 1)]
}

export function reorderBlock(blocks, id, newOrder) {
  return blocks.map(b => b.id === id ? { ...b, order: newOrder } : b)
}
