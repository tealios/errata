// Recipe: plugin lifecycle hooks

export const hooksRecipe = {
  async beforeContext(ctx) {
    ctx.messages.push({
      role: 'system',
      content: 'Plugin hook: prioritize consistency with world rules.',
    })
    return ctx
  },

  async afterSave(fragment, storyId) {
    // Example: log to stdout; replace with your side effects.
    console.log(`[my-plugin] saved fragment ${fragment.id} in story ${storyId}`)
  },
}
