import type { Crew, Follower } from '../types'

// Slots the followers take behind the runner: up to the farthest one in use,
// so the runner stands that many slots in from the left.
export function roomOf(list: readonly Follower[]): number {
  return list.reduce((n, f) => Math.max(n, f.slot + 1), 0)
}

// The crew with a new list of followers, remembering the room it had when the
// room changes, so the runner glides aside (or back) from there.
export function withList(state: Crew, list: Follower[], now: number): Crew {
  const before = roomOf(state.list)
  if (roomOf(list) === before) return { ...state, list, stamp: now }
  return { list, stamp: now, fromRoom: before, roomAt: now }
}
