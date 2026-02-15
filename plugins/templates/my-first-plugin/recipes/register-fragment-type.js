// Recipe: registering custom fragment types

export const fragmentTypeRecipe = [
  {
    type: 'location',
    prefix: 'lc',
    stickyByDefault: false,
    contextRenderer(fragment) {
      return `### Location: ${fragment.name}\n${fragment.content}`
    },
    shortlistFields: ['id', 'name', 'description'],
    llmTools: true,
  },
]
