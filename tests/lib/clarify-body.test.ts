import { describe, it, expect } from 'vitest'
import { clarifyBody } from '@/lib/api/generation'

describe('clarifyBody (generation request payload)', () => {
  it('sends nothing for a plain first-round generation', () => {
    expect(clarifyBody()).toEqual({})
    expect(clarifyBody({})).toEqual({})
    expect(clarifyBody({ clarifications: [], clarifyRound: 0 })).toEqual({})
  })

  it('sends answers and round when clarifications are supplied', () => {
    expect(clarifyBody({ clarifications: [{ question: 'q', answer: 'a' }], clarifyRound: 1 })).toEqual({
      clarifications: [{ question: 'q', answer: 'a' }],
      clarifyRound: 1,
    })
  })

  it('sends the round even with no clarifications (force-proceed / write anyway)', () => {
    // Regression: skipping on the first round must still carry the high round so
    // the server withholds the ask tool instead of re-asking.
    expect(clarifyBody({ clarifications: [], clarifyRound: 99 })).toEqual({ clarifications: [], clarifyRound: 99 })
    expect(clarifyBody({ clarifyRound: 99 })).toEqual({ clarifications: [], clarifyRound: 99 })
  })
})
