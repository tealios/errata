import { describe, it, expect } from 'vitest'
import {
  isGeminiProvider,
  normalizeGeminiBaseURL,
  parseGeminiVersion,
  minimalGeminiThinking,
  geminiThinkingConfig,
  isGeminiChatModel,
} from '@/server/llm/gemini'

describe('gemini helpers', () => {
  it('detects Gemini providers by preset or base URL', () => {
    expect(isGeminiProvider({ preset: 'gemini', baseURL: 'https://example.com' })).toBe(true)
    expect(isGeminiProvider({ preset: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' })).toBe(true)
    expect(isGeminiProvider({ preset: 'openai', baseURL: 'https://api.openai.com/v1' })).toBe(false)
  })

  it('normalizes OpenAI-compat Gemini URLs to the native endpoint', () => {
    expect(normalizeGeminiBaseURL('https://generativelanguage.googleapis.com/v1beta/openai/')).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(normalizeGeminiBaseURL('https://generativelanguage.googleapis.com/v1beta')).toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  it('parses model generations', () => {
    expect(parseGeminiVersion('gemini-3.8-flash')).toEqual({ major: 3, minor: 8 })
    expect(parseGeminiVersion('gemini-4-argon')).toEqual({ major: 4, minor: 0 })
    expect(parseGeminiVersion('models/gemini-2.5-pro')).toEqual({ major: 2, minor: 5 })
    expect(parseGeminiVersion('gemini-3-flash-preview')).toEqual({ major: 3, minor: 0 })
    expect(parseGeminiVersion('gemini-flash-latest')).toBeNull()
    expect(parseGeminiVersion('gpt-4o')).toBeNull()
  })

  it('picks the lowest thinking setting each family accepts', () => {
    expect(minimalGeminiThinking('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 })
    expect(minimalGeminiThinking('gemini-3.5-flash')).toEqual({ thinkingLevel: 'minimal' })
    expect(minimalGeminiThinking('gemini-3-flash-preview')).toEqual({ thinkingLevel: 'minimal' })
    expect(minimalGeminiThinking('gemini-3.8-flash')).toEqual({ thinkingLevel: 'low' })
    expect(minimalGeminiThinking('gemini-4-argon')).toEqual({ thinkingLevel: 'low' })
    expect(minimalGeminiThinking('gemini-flash-latest')).toEqual({ thinkingBudget: 0 })
  })

  it('asks for thought summaries when thinking stays enabled', () => {
    expect(geminiThinkingConfig('gemini-3.8-flash', { disableThinking: false })).toEqual({ includeThoughts: true })
    expect(geminiThinkingConfig('gemini-3.8-flash', { disableThinking: true })).toEqual({ thinkingLevel: 'low' })
  })

  it('filters non-chat models out of the picker', () => {
    for (const id of ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-2.5-pro', 'gemini-flash-latest', 'gemini-omni-flash-preview']) {
      expect(isGeminiChatModel(id), id).toBe(true)
    }
    for (const id of [
      'gemini-3.8-flash-tts', 'gemini-3.5-transcribe', 'gemini-3.1-flash-image', 'gemini-embedding-2',
      'gemini-3.8-live', 'gemini-robotics-er-2-preview', 'models/antigravity-preview-latest',
      'gemini-2.5-flash-native-audio-latest', 'gemini-2.5-computer-use-preview-10-2025', 'gemini-nano-banana-2.1',
    ]) {
      expect(isGeminiChatModel(id), id).toBe(false)
    }
  })
})
