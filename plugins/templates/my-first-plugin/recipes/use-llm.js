// Recipe: accessing the configured LLM for the story

import { generateText } from 'ai'
import { getModel } from '../../../src/server/llm/client'

export async function askStoryModel(dataDir, storyId, prompt) {
  const { model, providerId, modelId } = await getModel(dataDir, storyId)
  const result = await generateText({
    model,
    prompt,
  })

  return {
    providerId,
    modelId,
    text: result.text,
  }
}
