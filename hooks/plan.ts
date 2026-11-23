import type { Plan } from '../types'

// How the session is billed, from how it is signed in (`$.session.identity()`'s
// kind): a claude.ai login is a subscription; a console login, an API key or a
// cloud provider is billed per use. Rate-limit windows only come with a
// subscription, so they settle it where the sign-in is unknown.
export function planOf(kind: string | null, hasWindows: boolean): Plan {
  if (kind === 'claude.ai') return 'subscription'
  if (kind !== null && kind !== 'none') return 'usage'
  return hasWindows ? 'subscription' : 'unknown'
}
