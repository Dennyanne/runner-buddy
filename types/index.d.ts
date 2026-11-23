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
  /** The model it runs on, as the engine resolved it (`claude-haiku-5-5`); absent until known. */
  model?: string
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

/** A short reaction a character plays: tripping on a tool error, cheering at a finished turn, stopping when interrupted. */
export type ReactionKind = 'trip' | 'finish' | 'stop'
/** `target` is `runner` or a follower's agent id; `at` is when it began, `$.clock.now()` ms. */
export type Reaction = { target: string; kind: ReactionKind; at: number }

/** A tool call a character is running: `target` as for a reaction, `text` its label, `seq` the call's own number. */
export type Doing = { target: string; text: string; at: number; seq: number }

declare module 'claude-code' {
  interface PluginState {
    'runner-buddy': { frame: Frame; crew: Crew; tokens: Tokens; stats: Stats | null; reactions: Reaction[]; doing: Doing[] }
  }
}
