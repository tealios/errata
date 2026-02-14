import { createDeepSeek } from '@ai-sdk/deepseek'

export const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? 'sk-2106322f663f4d68a89c1386cb8f0ba5',
})

export const defaultModel = deepseek('deepseek-chat')
