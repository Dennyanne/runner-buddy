export type Frame = number
/** One subagent on the band. Times are `$.clock.now()` milliseconds. */
export type Follower = {
  id: string
  label: string
  color: string
  /** Its fixed place behind the runner, 0 nearest. */
  slot: number
  joinedAt: number
  /** Set when its agent finished; it fades out, then leaves the list. */
  leftAt?: number
}
/** The followers, and when the list last changed (keeps redrawn SVG animations in phase). */
export type Crew = { list: Follower[]; stamp: number }
/** Summed over every turn: `input` is new input, cache writes and cache reads together; `cacheRead` is the cache's part of it. */
export type Tokens = { input: number; output: number; cacheRead: number }
export type Stats = {
  ctxTokens: number | null
  ctxWindow: number
  ctxPercent: number | null
  input: number
  output: number
  cacheRead: number
  /** The account's rate-limit windows, as the last API response reported them; empty without any. */
  limits?: Limit[]
  /** When these were read, `$.clock.now()` ms: a time base for drawing. */
  at: number
}
/** One rate-limit window: `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'runner-buddy': { frame: Frame; crew: Crew; tokens: Tokens; stats: Stats | null }
  }
}
