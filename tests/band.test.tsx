import { expect, test } from 'claude-code/testing'

import type { Crew, Doing, Reaction, Stats } from '../types'
import { planOf } from '../hooks/plan'
import { toolLabel } from '../hooks/tool-label'

const NOW = 100_000

const CREW: Crew = {
  stamp: NOW,
  list: [
    { id: 'a1', label: 'Explore', color: '#4F9DDE', slot: 0, joinedAt: NOW - 5_000 },
    { id: 'a2', label: 'code-reviewer', color: '#4CB782', slot: 1, joinedAt: NOW - 3_000 },
    { id: 'a3', label: 'planner', color: '#B57EDC', slot: 2, joinedAt: NOW },
  ],
}

const EMPTY: Crew = { list: [], stamp: 0 }

const STATS: Stats = {
  ctxTokens: 84_000,
  ctxWindow: 200_000,
  ctxPercent: 42,
  input: 1_234_567,
  output: 34_210,
  cacheRead: 1_074_073, // 87% of the input
  at: NOW,
}

const BAND = {
  plugin: 'runner-buddy',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

// `test(name, body)` or `test(name, options, body)`: take the body's form.
type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

// `clock` is what `$.clock.now()` answers while drawing; null refuses it.
function seed(on: On, crew: Crew, stats: Stats | null = STATS, frame = 7, clock: number | null = NOW, reactions: Reaction[] = [], doing: Doing[] = []) {
  const values: Record<string, unknown> = { crew, frame, stats, tokens: { input: 0, output: 0, cacheRead: 0 }, reactions, doing }
  on('state.get', (_, e) => ({ value: { value: values[e.key] ?? null, version: 1 } }))
  on('clock.now', () => {
    if (clock === null) throw new Error('refused while drawing')
    return { value: clock }
  })
}

type Found = { text: string; props: Record<string, unknown> }

// The lines drawn as single units: the usage row's groups (and, on the
// terminal, the scene's rows), each one Text that cuts rather than wraps.
async function units(ui: { findAll: (q: { type: 'Text' }) => Promise<Found[]> }) {
  return (await ui.findAll({ type: 'Text' })).filter(t => t.props.wrap === 'truncate').map(t => t.text)
}

async function allText(ui: { findAll: (q: { type: 'Text' }) => Promise<{ text: string }[]> }) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
}

async function svgSource(ui: { find: (q: { type: 'Svg' }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  return String((await ui.find({ type: 'Svg' }))?.props.source)
}

test('desktop: runner and named followers jump obstacles, full width, fixed height', async ($, on) => {
  seed(on, CREW)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  const source = String(svg?.props.source)
  for (const f of CREW.list) expect(source.includes(f.color)).toBe(true)
  expect(source.includes('#D97757')).toBe(true) // the runner
  expect(source.includes('>Explore<')).toBe(true)
  expect(source.includes('>code-rev…<')).toBe(true)
  for (const object of ['bug', 'mushroom', 'coffee', 'braces', 'flower', 'cactus']) {
    expect(source.includes(`class="obstacle ${object}"`)).toBe(true)
  }
  expect(source.match(/class="jump"/g)?.length).toBe(4) // three followers and the runner
  expect(source.includes('class="dot"')).toBe(false) // no more dots to eat
  expect(source.includes('class="ground"')).toBe(false)
  expect(source.includes('width="2400"')).toBe(true)
  expect(svg?.props.height).toBe(53)
  await ui.unmount()
})

test('desktop: the band keeps its height with no followers', async ($, on) => {
  seed(on, EMPTY)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: "Svg" }))?.props.height).toBe(53)
  await ui.unmount()
})

test('desktop: a new follower pops in, an old one is already in, a finished one fades out', async ($, on) => {
  const crew: Crew = {
    stamp: NOW,
    list: [
      { id: 'old', label: 'old', color: '#4F9DDE', slot: 0, joinedAt: NOW - 60_000 },
      { id: 'new', label: 'new', color: '#4CB782', slot: 1, joinedAt: NOW },
      { id: 'done', label: 'done', color: '#B57EDC', slot: 2, joinedAt: NOW - 9_000, leftAt: NOW - 100 },
    ],
  }
  seed(on, crew)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = await svgSource(ui)
  // Each enter/exit is phased from the moment of drawing, so a redraw resumes it.
  expect(source).toContain('class="enter" style="animation-delay: -60.000s"')
  expect(source).toContain('class="enter" style="animation-delay: -0.000s"')
  expect(source).toContain('class="exit" style="animation-delay: -0.100s"')
  // A finished agent no longer counts in the usage row.
  expect(await allText(ui)).toContain('에이전트 2')
  await ui.unmount()
})

test('desktop: every redraw resumes the loops where the clock says they are', async ($, on) => {
  // Drawn at 1.35 s, then again at 7.0 s with nothing else changed: the
  // objects and the jump pick up from each moment, never from the crew's stamp.
  seed(on, { list: [], stamp: 0 }, STATS, 7, 1_350)
  const first = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const a = await svgSource(first)
  expect(a).toContain('class="obstacles" style="animation-delay: -1.350s"')
  expect(a).toMatch(/class="jump" style="animation-delay: -0\.450s"/)
  await first.unmount()
})

test('desktop: a later redraw is phased from its own moment', async ($, on) => {
  seed(on, { list: [], stamp: 0 }, STATS, 7, 7_000) // 7.0 s: 1.6 s into the 5.4 s loop
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = await svgSource(ui)
  expect(source).toContain('class="obstacles" style="animation-delay: -1.600s"')
  expect(source).toMatch(/class="jump" style="animation-delay: -0\.700s"/)
  await ui.unmount()
})

test('desktop: if the clock is refused while drawing, the latest reading stands in', async ($, on) => {
  seed(on, { list: [], stamp: 500 }, { ...STATS, at: 1_350 }, 7, null)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await svgSource(ui)).toContain('class="obstacles" style="animation-delay: -1.350s"')
  await ui.unmount()
})

test('the stats row shows context, tokens, the cache hit rate and the agent count, and no cost', async ($, on) => {
  seed(on, CREW)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const row = await allText(ui)
    expect(row).toContain('ctx [')
    expect(row).toContain('42%')
    expect(row).toContain('116k 남음')
    expect(row).toContain('in 1.2M / out 34.2k')
    expect(row).toContain('캐시 적중 87%')
    expect(row.includes('$')).toBe(false)
    expect(row.includes('비용')).toBe(false)
    expect(row).toContain('에이전트 3')
    expect(row.includes('/compact?')).toBe(false)
    expect(row).toContain(surface === 'terminal' ? '####.....' : '████░░░░░░')
    await ui.unmount()
  }
})

// The cache hit rate is green from 70%, yellow from 40%, red below.
for (const [cacheRead, color, name] of [
  [870, '#4CB782', 'green'],
  [550, '#E8A33D', 'yellow'],
  [120, '#E5484D', 'red'],
] as const) {
  test(`a cache hit rate of ${cacheRead / 10}% is ${name}`, async ($, on) => {
    seed(on, EMPTY, { ...STATS, input: 1_000, cacheRead })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const pct = await ui.find({ type: 'Text', text: new RegExp(`^${Math.round(cacheRead / 10)}%$`) })
    expect(pct?.props.color).toBe(color)
    await ui.unmount()
  })
}

test('the cache hit rate shows -- before any input', async ($, on) => {
  seed(on, EMPTY, { ...STATS, input: 0, cacheRead: 0 })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await allText(ui)).toContain('캐시 적중 --')
  await ui.unmount()
})

test('context turns yellow at 70% and red at 85%, with a compact hint from 80%', async ($, on) => {
  seed(on, EMPTY, { ...STATS, ctxPercent: 88, ctxTokens: 176_000 })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const pct = await ui.find({ type: 'Text', text: /^88%$/ })
  expect(pct?.props.color).toBe('#E5484D')
  expect(await allText(ui)).toContain('/compact?')
  await ui.unmount()
})

test('before the first reading the context shows a placeholder', async ($, on) => {
  seed(on, EMPTY, null)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await allText(ui)).toContain('ctx --')
  await ui.unmount()
})

test('terminal: followers in their colours, names under them, obstacles on the floor', async ($, on) => {
  seed(on, CREW)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })
  const coloured = texts.filter(t => t.props.color !== undefined).map(t => t.props.color)
  for (const f of CREW.list) expect(coloured.includes(f.color)).toBe(true)
  const all = texts.map(t => t.text).join('')
  expect(all).toContain('(^^)')
  expect(all).toContain('(oo)')
  expect(all).toContain('Explore')
  // The floor carries the small objects, each its own colour and letter.
  const objects = texts.filter(t => ['o', 'T', 'u', '{', '*', 'Y'].includes(t.text) && t.props.color !== undefined)
  expect(new Set(objects.map(t => t.text)).size).toBeGreaterThanOrEqual(4)
  await ui.unmount()
})

test('terminal: a character jumps while an obstacle passes under it', async ($, on) => {
  // Runner at column 2 + 6 * 9 = 56 with 140 columns; at frame n an obstacle
  // sits at every x with (x + n) % 14 === 0, so frame 10 puts one at x = 60.
  seed(on, EMPTY, STATS, 10)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const [air, floor] = await units(ui)
  expect(air).toContain('(^^)') // in the air row
  expect(floor?.includes('(^^)')).toBe(false)
  await ui.unmount()
})

test('idle with no subagents draws nothing', async ($, on) => {
  seed(on, EMPTY)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: false }, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('background subagents keep the band up after the turn ends', async ($, on) => {
  seed(on, CREW)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: false }, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

// ---- rate-limit windows ----
const HOUR = 3_600_000

test('rate limits show each window with its use and time to reset', async ($, on) => {
  seed(on, EMPTY, {
    ...STATS,
    limits: [
      { kind: 'five_hour', percentUsed: 38.4, resetsAt: new Date(NOW + 2 * HOUR + 13 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(NOW + 76 * HOUR).toISOString() },
    ],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const row = await allText(ui)
    expect(row).toContain('5h 38% (2h13m)')
    expect(row).toContain('주간 12% (3d4h)')
    expect((await ui.find({ type: 'Text', text: /^38%$/ }))?.props.color).toBe('#4CB782')
    await ui.unmount()
  }
})

for (const [percentUsed, color, name] of [
  [72, '#E8A33D', 'yellow'],
  [93.5, '#E5484D', 'red'],
] as const) {
  test(`a rate limit at ${percentUsed}% is ${name}`, async ($, on) => {
    seed(on, EMPTY, { ...STATS, limits: [{ kind: 'five_hour', percentUsed }] })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const pct = await ui.find({ type: 'Text', text: new RegExp(`^${Math.round(percentUsed)}%$`) })
    expect(pct?.props.color).toBe(color)
    await ui.unmount()
  })
}

test('a window with no reset time, or one already passed, shows no countdown', async ($, on) => {
  seed(on, EMPTY, {
    ...STATS,
    limits: [
      { kind: 'five_hour', percentUsed: 5 },
      { kind: 'seven_day', percentUsed: 9, resetsAt: new Date(NOW - 60_000).toISOString() },
      { kind: 'spend_limit', percentUsed: 41, resetsAt: new Date(NOW + 30 * 60_000).toISOString() },
    ],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const row = await allText(ui)
  expect(row).toContain('5h 5%')
  const groups = await units(ui)
  expect(groups).toContain('5h 5%  주간 9%  한도 41% (30m)') // the windows are one unit
  await ui.unmount()
})

test('with no rate limits (an API key, say) the gauge is left out', async ($, on) => {
  seed(on, EMPTY, { ...STATS, limits: [] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const row = await allText(ui)
  expect(row.includes('5h')).toBe(false)
  expect(await units(ui)).toEqual(['ctx [████░░░░░░] 42% 116k 남음', '토큰 in 1.2M / out 34.2k', '캐시 적중 87%'])
  await ui.unmount()
})

// ---- wrapping on a narrow band ----
test('the usage row wraps by whole groups, each cut rather than broken, with no stray separators', async ($, on) => {
  seed(on, CREW, {
    ...STATS,
    limits: [
      { kind: 'five_hour', percentUsed: 38, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
      { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(NOW + 76 * HOUR).toISOString() },
    ],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 40 }, surface })
    const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.flexWrap === 'wrap')
    expect(row).toBeDefined()
    expect(row?.props.flexDirection).toBe('row')
    // Every group is its own unit, so a wrap can only fall between them.
    const groups = await units(ui)
    for (const g of ['5h 38% (2h00m)  주간 12% (3d4h)', '토큰 in 1.2M / out 34.2k', '캐시 적중 87%', '에이전트 3']) {
      expect(groups).toContain(g)
    }
    expect(groups.some(g => g.startsWith('ctx ['))).toBe(true)
    expect((await allText(ui)).includes('·')).toBe(false)
    await ui.unmount()
  }
})

test('terminal: the scene rows are cut to the band, never wrapped', async ($, on) => {
  seed(on, CREW)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 40 }, surface: 'terminal' })
  const sceneRows = (await units(ui)).slice(0, 3)
  expect(sceneRows.length).toBe(3)
  for (const r of sceneRows) expect(r.length).toBeLessThanOrEqual(39)
  await ui.unmount()
})

// ---- subagent model and elapsed time ----
test('desktop: each follower shows its model and how long it has run under its name', async ($, on) => {
  const crew: Crew = {
    stamp: NOW,
    list: [
      { id: 'a', label: 'Explore', color: '#4F9DDE', slot: 0, joinedAt: NOW - 5_000, model: 'claude-haiku-5-5' },
      { id: 'b', label: 'architect', color: '#4CB782', slot: 1, joinedAt: NOW - 3_723_000, model: 'claude-opus-5-5' },
      { id: 'c', label: 'mystery', color: '#B57EDC', slot: 2, joinedAt: NOW - 42_000 },
      { id: 'd', label: 'done', color: '#E0698A', slot: 3, joinedAt: NOW - 9_000, leftAt: NOW - 100, model: 'claude-sonnet-5-5' },
    ],
  }
  seed(on, crew)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = await svgSource(ui)
  expect(source).toContain('class="meta" x="0" y="25" text-anchor="middle" fill="#4F9DDE">haiku 0:05<')
  expect(source).toContain('>o 1:02:03<') // past an hour the model gives way to its initial; the time stays whole
  expect(source).toContain('>0:42<') // model not known yet: time alone
  expect(source).toContain('>sonnet 0:08<') // finished: its time stops at leftAt
  await ui.unmount()
})

test('desktop: a model outside the known families is shortened to fit', async ($, on) => {
  seed(on, {
    stamp: NOW,
    list: [{ id: 'a', label: 'custom', color: '#4F9DDE', slot: 0, joinedAt: NOW, model: 'claude-experimental-model-x' }],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await svgSource(ui)).toContain('>exper… 0:00<')
  await ui.unmount()
})

test('terminal: a fourth row shows the model initial and time under each name', async ($, on) => {
  seed(on, {
    stamp: NOW,
    list: [
      { id: 'a', label: 'Explore', color: '#4F9DDE', slot: 0, joinedAt: NOW - 5_000, model: 'claude-haiku-5-5' },
      { id: 'b', label: 'planner', color: '#4CB782', slot: 1, joinedAt: NOW - 754_000 },
    ],
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rows = await units(ui)
  expect(rows[2]).toContain('Explore')
  expect(rows[3]).toContain('h 0:05')
  expect(rows[3]).toContain('12:34')
  await ui.unmount()
})

test('terminal: with no followers there is no fourth row', async ($, on) => {
  seed(on, EMPTY)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rows = await units(ui)
  expect(rows[3]?.startsWith('ctx [')).toBe(true) // the usage row comes straight after the names row
  await ui.unmount()
})

// ---- the runner tires as the context fills ----
for (const [ctxPercent, mood, sprite] of [
  [42, 'fresh', '(^^)'],
  [75, 'tired', '(-;)'],
  [88, 'exhausted', '(@o)'],
] as const) {
  test(`at ${ctxPercent}% context the runner is ${mood}`, async ($, on) => {
    seed(on, EMPTY, { ...STATS, ctxPercent, ctxTokens: ctxPercent * 2_000 }, 0)
    const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const source = await svgSource(desktop)
    const sweat = source.match(/class="sweat"/g)?.length ?? 0
    expect(sweat).toBe(mood === 'fresh' ? 0 : mood === 'tired' ? 1 : 2)
    expect(source.includes('class="pant"')).toBe(mood === 'exhausted')
    expect(source.includes('Q 4.5 -7.5 8 -10')).toBe(mood === 'fresh') // the smile
    await desktop.unmount()
    const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await allText(terminal)).toContain(sprite)
    await terminal.unmount()
  })
}

test('the mood changes only the runner: followers keep their frown and the jump is unchanged', async ($, on) => {
  seed(on, CREW, { ...STATS, ctxPercent: 90, ctxTokens: 180_000 })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = await svgSource(ui)
  expect(source.match(/M -2 -22 L 3 -20.5/g)?.length).toBe(3) // three frowning followers
  expect(source).toContain('50% { transform: translateY(-18px)') // same jump height
  await ui.unmount()
})

test('before the first reading the runner is fresh', async ($, on) => {
  seed(on, EMPTY, null)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await svgSource(ui)).includes('class="sweat"')).toBe(false)
  await ui.unmount()
})

// ---- reactions: trip on an error, cheer at the end, stop when interrupted ----
const idle = { ...BAND, props: { ...BAND.props, isWorking: false } }

test('a runner that tripped falls with stars, phased from when it tripped', async ($, on) => {
  seed(on, EMPTY, STATS, 7, NOW, [{ target: 'runner', kind: 'trip', at: NOW - 300 }])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = await svgSource(ui)
  expect(source).toContain('class="trip" style="animation-delay: -0.300s"')
  expect(source).toContain('class="stars"')
  expect(source.includes('class="jump"')).toBe(false) // it is not jumping while it lies there
  await ui.unmount()
})

test('a follower whose tool call failed trips alone; the others keep jumping', async ($, on) => {
  seed(on, CREW, STATS, 7, NOW, [{ target: 'a2', kind: 'trip', at: NOW }])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = await svgSource(ui)
  expect(source.match(/class="trip"/g)?.length).toBe(1)
  expect(source.match(/class="jump"/g)?.length).toBe(3) // two followers and the runner
  await ui.unmount()
})

test('a finished turn: the runner cheers with confetti, smiling even when exhausted, after the turn ended', async ($, on) => {
  seed(on, EMPTY, { ...STATS, ctxPercent: 90, ctxTokens: 180_000 }, 7, NOW, [{ target: 'runner', kind: 'finish', at: NOW - 500 }])
  const ui = await $.ui.mount({ ...idle, surface: 'desktop' }) // the turn is over: isWorking is false
  const source = await svgSource(ui)
  expect(source).toContain('class="cheer" style="animation-delay: -0.500s"')
  expect(source.match(/class="confetti/g)?.length).toBe(8)
  expect(source).toContain('Q 4.5 -7.5 8 -10') // the smile
  await ui.unmount()
})

test('an interrupted turn: the runner stands still with a "…" bubble', async ($, on) => {
  seed(on, EMPTY, STATS, 7, NOW, [{ target: 'runner', kind: 'stop', at: NOW }])
  const ui = await $.ui.mount({ ...idle, surface: 'desktop' })
  const source = await svgSource(ui)
  expect(source).toContain('class="say"')
  expect(source).toContain('>…</text>')
  expect(source.includes('class="jump"')).toBe(false)
  await ui.unmount()
})

for (const [kind, shows] of [
  ['trip', ['(xx)', '*  *']],
  ['finish', ['\\^^/']],
  ['stop', ['(^^)', '...']],
] as const) {
  test(`terminal: the runner's ${kind} reaction`, async ($, on) => {
    seed(on, EMPTY, STATS, 0, NOW, [{ target: 'runner', kind, at: NOW }])
    const ui = await $.ui.mount({ ...idle, surface: 'terminal' })
    const text = await allText(ui)
    for (const s of shows) expect(text).toContain(s)
    await ui.unmount()
  })
}

test('a failed tool call trips the runner; a successful one does not', async ($, on) => {
  on('clock.now', () => ({ value: NOW })) // the kit answers no clock by itself
  let fail = true
  on('tool.call', () => (fail ? { isError: true as const, result: {}, text: 'exit 1' } : { result: {} }))
  await $.tool.call({ tool: 'Bash', command: 'true' } as never).catch(() => undefined)
  const tripped = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await svgSource(tripped)).toContain('class="trip"')
  await tripped.unmount()
  fail = false
  await $.tool.call({ tool: 'Bash', command: 'true' } as never).catch(() => undefined)
  const still = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await svgSource(still)).toContain('class="trip"') // the first trip is still playing; no new one replaced it
  await still.unmount()
})

test("a subagent's failed tool call trips that subagent, not the runner", async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('tool.call', () => ({ isError: true as const, result: {}, text: 'exit 1' }))
  await $.tool.call({ tool: 'Bash', command: 'false', agentId: 'a1' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await svgSource(ui)).includes('class="trip"')).toBe(false) // a1 is not on the band here, and the runner did not trip
  await ui.unmount()
})

// ---- what each character is doing ----
test('a tool call reads as the tool and the one detail that says what it works on', () => {
  expect(toolLabel('Edit', { file_path: '/Users/x/project/hooks/register.tsx', old_string: 'a' })).toBe('Edit register.tsx')
  expect(toolLabel('Read', { file_path: 'C:\\code\\app\\main.ts' })).toBe('Read main.ts')
  expect(toolLabel('NotebookEdit', { notebook_path: '/n/analysis.ipynb' })).toBe('NotebookEdit analysis.ipynb')
  expect(toolLabel('Bash', { command: 'npm test -- --watch\necho done' })).toBe('$ npm test -- --watch')
  expect(toolLabel('Grep', { pattern: 'TODO', path: 'src' })).toBe('Grep TODO')
  expect(toolLabel('Glob', { pattern: '**/*.tsx' })).toBe('Glob **/*.tsx')
  expect(toolLabel('WebFetch', { url: 'https://docs.anthropic.com/en/docs' })).toBe('Fetch docs.anthropic.com')
  expect(toolLabel('WebFetch', { url: 'not a url' })).toBe('Fetch')
  expect(toolLabel('WebSearch', { query: 'claude code mods' })).toBe('Search claude code mods')
  expect(toolLabel('Agent', { description: 'Count lines', prompt: 'long…' })).toBe('Agent Count lines')
  expect(toolLabel('mcp__ccd_turn__update_plan', { items: [] })).toBe('update_plan')
  expect(toolLabel('Bash', {})).toBe('Bash')
  expect(toolLabel('SomethingNew', { x: 1 })).toBe('SomethingNew')
})

const editing: Doing = { target: 'runner', text: 'Edit register.tsx', at: NOW - 200, seq: 1 }

test('desktop: the runner says what it is doing in a bubble beside its head', async ($, on) => {
  seed(on, EMPTY, STATS, 7, NOW, [], [editing])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = await svgSource(ui)
  expect(source).toContain('class="bubble"')
  expect(source).toContain('>Edit register.tsx</text>')
  // Inside the jump group, so it rides along rather than leaving the band at the top of a jump.
  expect(source).toMatch(/<g class="jump"[^>]*>(?:(?!<\/svg>)[\s\S])*class="bubble"/)
  await ui.unmount()
})

test('desktop: a long label is cut to the bubble', async ($, on) => {
  seed(on, EMPTY, STATS, 7, NOW, [], [{ ...editing, text: '$ npm run build -- --mode production --verbose' }])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await svgSource(ui)).toContain('>$ npm run build -- --mo…</text>')
  await ui.unmount()
})

test('desktop: while the runner reacts, its bubble steps aside', async ($, on) => {
  seed(on, EMPTY, STATS, 7, NOW, [{ target: 'runner', kind: 'trip', at: NOW }], [editing])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await svgSource(ui)).includes('class="bubble"')).toBe(false)
  await ui.unmount()
})

test("desktop: a follower's second line shows its tool while it runs, then its model and time again", async ($, on) => {
  const crew: Crew = {
    stamp: NOW,
    list: [
      { id: 'a', label: 'Explore', color: '#4F9DDE', slot: 0, joinedAt: NOW - 5_000, model: 'claude-haiku-5-5' },
      { id: 'b', label: 'planner', color: '#4CB782', slot: 1, joinedAt: NOW - 8_000, model: 'claude-opus-5-5' },
    ],
  }
  seed(on, crew, STATS, 7, NOW, [], [{ target: 'a', text: 'Grep TODO in src', at: NOW, seq: 2 }])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = await svgSource(ui)
  expect(source).toContain('fill="#4F9DDE">Grep TODO …</text>') // cut to the slot
  expect(source).toContain('>opus 0:08</text>') // the other follower is between tools
  expect(source.includes('class="bubble"')).toBe(false) // the runner is not running one
  await ui.unmount()
})

test("terminal: the runner's tool shows under it, a follower's in its fourth row", async ($, on) => {
  const crew: Crew = { stamp: NOW, list: [{ id: 'a', label: 'Explore', color: '#4F9DDE', slot: 0, joinedAt: NOW - 5_000 }] }
  seed(on, crew, STATS, 0, NOW, [], [editing, { target: 'a', text: 'Read a.ts', at: NOW, seq: 3 }])
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rows = await units(ui)
  expect(rows[2]).toContain('Explore')
  expect(rows[2]).toContain('Edit register.tsx')
  expect(rows[3]).toContain('Read a.…') // cut to the follower's 8-cell slot
  await ui.unmount()
})

test('a real tool call labels the runner while it runs, and the label outlasts a quick call', async ($, on) => {
  on('clock.now', () => ({ value: NOW })) // the kit answers no clock by itself
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Edit', file_path: '/p/hooks/register.tsx', old_string: 'a', new_string: 'b' } as never).catch(() => undefined)
  // The call took no time on the frozen clock, so its label is kept up for its minimum.
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await svgSource(ui)).toContain('>Edit register.tsx</text>')
  await ui.unmount()
})

// ---- the plan: a subscription says so; per-use billing shows its estimate ----
test('the plan comes from how the session is signed in, else from the rate-limit windows', () => {
  expect(planOf('claude.ai', false)).toBe('subscription')
  expect(planOf('console', false)).toBe('usage')
  expect(planOf('api-key', true)).toBe('usage') // the sign-in wins
  expect(planOf('bedrock', false)).toBe('usage')
  expect(planOf(null, true)).toBe('subscription')
  expect(planOf('none', true)).toBe('subscription')
  expect(planOf(null, false)).toBe('unknown')
})

test('on a subscription the row says 구독제 and shows no amount', async ($, on) => {
  seed(on, EMPTY, { ...STATS, plan: 'subscription', usd: 3.21 })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await units(ui)).toContain('요금 구독제')
    expect((await allText(ui)).includes('$')).toBe(false)
    await ui.unmount()
  }
})

test('billed per use, the row shows the estimate, labelled as one', async ($, on) => {
  seed(on, EMPTY, { ...STATS, plan: 'usage', usd: 0.8412 })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await units(ui)).toContain('요금 ~$0.84 (추정)')
  await ui.unmount()
})

test('a price at another model\'s rates is marked, and an unknown plan still shows a known cost', async ($, on) => {
  seed(on, EMPTY, { ...STATS, plan: 'unknown', usd: 12.5, hasUnknownPrice: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await units(ui)).toContain('요금 ~$12.50* (추정)')
  await ui.unmount()
})

test('with no plan known and no cost ledger, the 요금 part is left out', async ($, on) => {
  seed(on, EMPTY, { ...STATS, plan: 'unknown' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await allText(ui)).includes('요금')).toBe(false)
  await ui.unmount()
})
