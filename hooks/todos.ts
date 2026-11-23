import type { TodoItem, TodoStatus } from '../types'

// The session's todo list, followed from the tools that keep it:
//   TodoWrite                       the whole list each time
//   TaskCreate / TaskUpdate         one task at a time, by id
//   mcp__ccd_turn__update_plan      the whole list, then changes (advance, done, start)
//   mcp__ccd_turn__wrap_up          checks every step off
// Returns the list after `tool` ran with `input` and `result`, or null when the
// call is not one of these (or says nothing the list can use).
export function applyTodoCall(
  items: readonly TodoItem[],
  tool: string,
  input: Readonly<Record<string, unknown>>,
  result: unknown,
): TodoItem[] | null {
  switch (tool) {
    case 'TodoWrite':
      return listFrom(input.todos, 'content')
    case 'mcp__ccd_turn__update_plan': {
      const whole = listFrom(input.items, 'content')
      if (whole) return whole
      return stepPlan(items, input)
    }
    case 'mcp__ccd_turn__wrap_up':
      return items.length > 0 ? items.map(i => ({ ...i, status: 'completed' })) : null
    case 'TaskCreate': {
      const task = (result as { task?: { id?: unknown; subject?: unknown } } | null)?.task
      const subject = typeof input.subject === 'string' ? input.subject : typeof task?.subject === 'string' ? task.subject : null
      if (typeof task?.id !== 'string' || subject === null) return null
      return [...items.filter(i => i.id !== task.id), { id: task.id, text: subject, status: 'pending' }]
    }
    case 'TaskUpdate': {
      const id = typeof input.taskId === 'string' ? input.taskId : null
      if (id === null || !items.some(i => i.id === id)) return null
      if (input.status === 'deleted') return items.filter(i => i.id !== id)
      return items.map(i =>
        i.id === id
          ? {
              ...i,
              ...(isStatus(input.status) ? { status: input.status } : {}),
              ...(typeof input.subject === 'string' ? { text: input.subject } : {}),
            }
          : i,
      )
    }
  }
  return null
}

// How many are done, of how many.
export function todoProgress(items: readonly TodoItem[]): { done: number; total: number } {
  return { done: items.filter(i => i.status === 'completed').length, total: items.length }
}

// The share still to do, 0 to 1; 0 for an empty list.
export function remainingShare(items: readonly TodoItem[]): number {
  const { done, total } = todoProgress(items)
  return total === 0 ? 0 : (total - done) / total
}

function isStatus(value: unknown): value is TodoStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

function listFrom(value: unknown, textKey: string): TodoItem[] | null {
  if (!Array.isArray(value)) return null
  const items: TodoItem[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const text = record[textKey]
    if (typeof text !== 'string') continue
    items.push({ text, status: isStatus(record.status) ? record.status : 'pending' })
  }
  return items
}

// update_plan's change-only forms, applied to the list as last given:
// advance completes the step in progress and starts the next pending one;
// done (1-based numbers) completes those; start (1-based) starts that one.
function stepPlan(items: readonly TodoItem[], input: Readonly<Record<string, unknown>>): TodoItem[] | null {
  if (items.length === 0) return null
  let next = items.map(i => ({ ...i }))
  let changed = false
  if (input.advance === true) {
    const current = next.findIndex(i => i.status === 'in_progress')
    if (current >= 0) next[current] = { ...next[current]!, status: 'completed' }
    const upcoming = next.findIndex((i, n) => n > current && i.status === 'pending')
    if (upcoming >= 0) next[upcoming] = { ...next[upcoming]!, status: 'in_progress' }
    changed = true
  }
  if (Array.isArray(input.done)) {
    for (const n of input.done) {
      if (typeof n === 'number' && next[n - 1]) next[n - 1] = { ...next[n - 1]!, status: 'completed' }
    }
    changed = true
  }
  if (typeof input.start === 'number' && next[input.start - 1]) {
    next = next.map((i, n) => (n === (input.start as number) - 1 ? { ...i, status: 'in_progress' } : i))
    changed = true
  }
  return changed ? next : null
}
