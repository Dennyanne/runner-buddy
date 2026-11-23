import { expect, test } from 'claude-code/testing'

import type { Crew, Stats } from '../types'

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
function seed(on: On, crew: Crew, stats: Stats | null = STATS, frame = 7, clock: number | null = NOW) {
  const values: Record<string, unknown> = { crew, frame, stats, tokens: { input: 0, output: 0, cacheRead: 0 } }
  on('state.get', (_, e) => ({ value: { value: values[e.key] ?? null, version: 1 } }))
  on('clock.now', () => {
    if (clock === null) throw new Error('refused while drawing')
    return { value: clock }
  })
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
  expect(svg?.props.height).toBe(45)
  await ui.unmount()
})

test('desktop: the band keeps its height with no followers', async ($, on) => {
  seed(on, EMPTY)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.height).toBe(45)
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
  const rows = await ui.findAll({ type: 'Box' })
  const firstRow = rows.find(b => b.props.flexDirection === 'row')
  expect(firstRow?.text).toContain('(^^)') // in the air row
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
  expect(row).toContain('5h 5%  주간 9%  한도 41% (30m)')
  await ui.unmount()
})

test('with no rate limits (an API key, say) the gauge is left out', async ($, on) => {
  seed(on, EMPTY, { ...STATS, limits: [] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const row = await allText(ui)
  expect(row.includes('5h')).toBe(false)
  expect(row).toContain('42% 116k 남음  ·  토큰')
  await ui.unmount()
})
