// API list prices for cost estimates (usage page, live activity).
import type { TokenTally } from './usage-core'

// USD per million tokens (Anthropic first-party list prices). Cache writes are
// 1.25x (5m) / 2x (1h) input unless noted; reads use the listed price.
interface Price {
  input: number
  output: number
  cacheRead?: number
}

const CLAUDE_PRICES: [RegExp, Price][] = [
  [/fable|mythos/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus-(5|4-[5-9])/, { input: 5, output: 25 }],
  [/opus/, { input: 15, output: 75 }],
  [/sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet/, { input: 3, output: 15 }],
  [/haiku-5/, { input: 0.1, output: 0.5 }],
  [/haiku-4/, { input: 1, output: 5 }],
  [/haiku/, { input: 0.8, output: 4 }]
]

function claudePrice(model: string): Price | null {
  return CLAUDE_PRICES.find(([re]) => re.test(model))?.[1] || null
}

export function claudeCost(model: string, tally: TokenTally): number {
  const price = claudePrice(model)

  if (!price) return 0

  const read = price.cacheRead ?? price.input * 0.1

  return (
    (tally.input * price.input +
      tally.output * price.output +
      tally.cacheWrite * price.input * 1.25 +
      tally.cacheWrite1h * price.input * 2 +
      tally.cacheRead * read) /
    1_000_000
  )
}
