import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Crew, Follower, Stats, Tokens } from '../types'

const frame = atom({ plugin: 'runner-buddy', key: 'frame' } as const, 0)
const crew = atom({ plugin: 'runner-buddy', key: 'crew' } as const, { list: [], stamp: 0 } as Crew)
const tokens = atom({ plugin: 'runner-buddy', key: 'tokens' } as const, { input: 0, output: 0, cacheRead: 0 } as Tokens)
const stats = atom({ plugin: 'runner-buddy', key: 'stats' } as const, null as Stats | null)

const TICK_MS = 120
const STATS_EVERY = 8 // ticks between usage refreshes (about once a second)
const EXIT_MS = 450 // how long a finished follower takes to fade out
const MAX_SLOTS = 6
const RUNNER_COLOR = '#D97757'
const PALETTE = ['#4F9DDE', '#4CB782', '#B57EDC', '#E0698A', '#3FB8AF', '#E8A33D']

// Context thresholds and colours, after the oh-my-claudecode HUD:
// green below 70%, yellow from 70% (and a /compact hint from 80%), red from 85%.
const CTX_WARNING = 70
const CTX_COMPACT = 80
const CTX_CRITICAL = 85
const GREEN = '#4CB782'
const YELLOW = '#E8A33D'
const RED = '#E5484D'
// Cache hit rate: green from 70%, yellow from 40%, red below (most input billed afresh).
const CACHE_GOOD = 70
const CACHE_FAIR = 40
// Rate-limit windows, after the oh-my-claudecode HUD: yellow from 70%, red from 90%.
const LIMIT_WARNING = 70
const LIMIT_CRITICAL = 90
const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '주간', spend_limit: '한도' }

// ---- vector surfaces (SVG, animated in CSS) ----
// Obstacles slide left at a steady speed; every character jumps on a fixed
// period, phased by its distance from the runner, so each clears each obstacle.
const SCALE = 0.7 // shown at this fraction of the drawing's units
const CANVAS = 2400 // px; the band crops the right side, so obstacles reach the edge
const PX_PER_CELL = 7.5 // the band reports code-font cells, not pixels
const HEIGHT = 64 // drawing units; constant so the band never changes height
const GROUND = 48 // y of every character's feet and every obstacle's base
const STEP = 72 // units between followers' slots
const SPACING = 120 // units between obstacles
const JUMP_S = 0.9 // seconds per jump, and per obstacle passing
// Small objects on the floor, each drawn on its base at (0, 0) and kept inside
// x -5.5..5.5, y -9..0: the jump clears the tallest by about 3 units.
const OBJECTS: { name: string; svg: string; ascii: string; color: string }[] = [
  {
    name: 'bug',
    color: '#E5484D',
    ascii: 'o',
    svg: `<path d="M -4.5 0 A 4.5 5 0 0 1 4.5 0 Z" fill="#E5484D"/><line x1="0" y1="-5" x2="0" y2="0" stroke="#1f1f1f" stroke-width="0.6"/><circle cx="-2" cy="-2.2" r="0.9" fill="#1f1f1f"/><circle cx="2" cy="-2.2" r="0.9" fill="#1f1f1f"/><circle cx="-1.3" cy="-3.9" r="0.6" fill="#1f1f1f"/><circle cx="1.3" cy="-3.9" r="0.6" fill="#1f1f1f"/><circle cx="4.6" cy="-1.6" r="1.6" fill="#1f1f1f"/>`,
  },
  {
    name: 'mushroom',
    color: '#D9534F',
    ascii: 'T',
    svg: `<rect x="-1.6" y="-4.5" width="3.2" height="4.5" rx="1" fill="#F2E6D0"/><path d="M -5 -4 A 5 4.6 0 0 1 5 -4 Z" fill="#D9534F"/><circle cx="-2" cy="-6" r="0.9" fill="#ffffff"/><circle cx="1.6" cy="-6.6" r="0.8" fill="#ffffff"/><circle cx="3.4" cy="-4.8" r="0.6" fill="#ffffff"/>`,
  },
  {
    name: 'coffee',
    color: '#8B5E3C',
    ascii: 'u',
    svg: `<path d="M -1.5 -7.2 q 0.8 -0.8 0 -1.6 M 0.8 -7.2 q 0.8 -0.8 0 -1.6" stroke="#b5b5b5" stroke-width="0.6" fill="none" stroke-linecap="round"/><path d="M 2.3 -5 q 2.6 0 2.6 1.8 q 0 1.8 -2.6 1.8" stroke="#d9d9d9" stroke-width="1.1" fill="none"/><path d="M -4 -6 h 6.6 v 4.4 q 0 1.6 -1.6 1.6 h -3.4 q -1.6 0 -1.6 -1.6 Z" fill="#f4f4f4" stroke="#c4c4c4" stroke-width="0.5"/><rect x="-3.6" y="-5.6" width="5.8" height="1.2" fill="#8B5E3C"/>`,
  },
  {
    name: 'braces',
    color: '#4F9DDE',
    ascii: '{',
    svg: `<path d="M -1.6 -8.5 q -2.2 0 -2.2 2 v 1.4 q 0 1.1 -1.2 1.1 q 1.2 0 1.2 1.1 v 1.4 q 0 2 2.2 2 M 1.6 -8.5 q 2.2 0 2.2 2 v 1.4 q 0 1.1 1.2 1.1 q -1.2 0 -1.2 1.1 v 1.4 q 0 2 -2.2 2" stroke="#4F9DDE" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    name: 'flower',
    color: '#E0698A',
    ascii: '*',
    svg: `<path d="M 0 0 V -5" stroke="#4CB782" stroke-width="1" stroke-linecap="round"/><path d="M 0 -2 q 2.4 -0.4 3 -2.4 q -2.4 0 -3 2.4" fill="#4CB782"/><circle cx="0" cy="-8.2" r="1.5" fill="#E0698A"/><circle cx="-1.8" cy="-6.8" r="1.5" fill="#E0698A"/><circle cx="1.8" cy="-6.8" r="1.5" fill="#E0698A"/><circle cx="-1.1" cy="-5" r="1.5" fill="#E0698A"/><circle cx="1.1" cy="-5" r="1.5" fill="#E0698A"/><circle cx="0" cy="-6.6" r="1.2" fill="#F5C842"/>`,
  },
  {
    name: 'cactus',
    color: '#3E9E6B',
    ascii: 'Y',
    svg: `<rect x="-1.6" y="-8.6" width="3.2" height="8.6" rx="1.6" fill="#3E9E6B"/><path d="M -1.6 -3.6 h -1.4 q -1 0 -1 -1 v -2 M 1.6 -4.6 h 1.4 q 1 0 1 -1 v -1.6" stroke="#3E9E6B" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M -0.6 -6.5 v 0.6 M 0.7 -4 v 0.6" stroke="#2c7a51" stroke-width="0.5" stroke-linecap="round"/>`,
  },
]
const LOOP_S = JUMP_S * OBJECTS.length // the objects' pattern repeats this often

function escapeXml(text: string): string {
  return text
    .replace(/\\/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function shorten(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b
}

function capacity(cols: number, cellPx: number, step: number, reserve: number): number {
  return Math.max(0, Math.min(MAX_SLOTS, Math.floor((cols * cellPx - reserve) / step)))
}

// A rounded blob on its feet at (0, 0), facing right. Followers frown with
// determination; the runner smiles.
function blob(color: string, isRunner: boolean): string {
  const face = isRunner
    ? `<path d="M 1 -10 Q 4.5 -7.5 8 -10" stroke="#1f1f1f" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
    : `<path d="M -2 -22 L 3 -20.5 M 10 -22 L 5.5 -20.5" stroke="#1f1f1f" stroke-width="1.4" stroke-linecap="round"/>`
  return `<g class="speed" stroke="${color}"><line x1="-17" y1="-19" x2="-27" y2="-19"/><line x1="-18" y1="-13" x2="-31" y2="-13"/><line x1="-17" y1="-7" x2="-25" y2="-7"/></g>
<circle class="footA" cx="-5" cy="-3" r="3" fill="${color}"/><circle class="footB" cx="5" cy="-3" r="3" fill="${color}"/>
<g transform="rotate(${isRunner ? 6 : 10} 0 -17)">
<rect x="-12" y="-28" width="24" height="22" rx="10" fill="${color}"/>
<circle cx="1" cy="-17" r="2.2" fill="#1f1f1f"/><circle cx="7.5" cy="-17" r="2.2" fill="#1f1f1f"/>
<circle cx="1.7" cy="-17.8" r="0.7" fill="#ffffff"/><circle cx="8.2" cy="-17.8" r="0.7" fill="#ffffff"/>
${face}
</g>`
}

// Every animation is phased from `nowMs`, the moment of drawing, so a redrawn
// SVG (any redraw of the band remounts it) resumes exactly where it was.
function sceneSvg(state: Crew, slots: number, nowMs: number): string {
  const t = nowMs / 1000
  const runnerX = 34 + slots * STEP
  const width = Math.ceil(CANVAS / SCALE)
  const speed = SPACING / JUMP_S // units per second

  // A jump peaks when an obstacle is under the character: the runner's phase,
  // delayed by the time an obstacle takes to travel from it to the character.
  const jumpDelay = (x: number) => -mod(t - (runnerX - x) / speed, JUMP_S)

  const followers = state.list
    .filter(f => f.slot < slots)
    .map(f => {
      const x = runnerX - (f.slot + 1) * STEP
      const ageS = (nowMs - f.joinedAt) / 1000
      const life =
        f.leftAt === undefined
          ? `class="enter" style="animation-delay: -${Math.max(0, ageS).toFixed(3)}s"`
          : `class="exit" style="animation-delay: -${Math.max(0, (nowMs - f.leftAt) / 1000).toFixed(3)}s"`
      const label = escapeXml(shorten(f.label, 9))
      return `<g transform="translate(${x} ${GROUND})"><g ${life}>
<g class="jump" style="animation-delay: ${jumpDelay(x).toFixed(3)}s">${blob(f.color, false)}</g>
<text class="name" x="0" y="12" text-anchor="middle" fill="${f.color}">${label}</text>
</g></g>`
    })
    .join('\n')
  const hidden = state.list.filter(f => f.slot >= slots && f.leftAt === undefined).length
  const more = hidden > 0 ? `<text class="name" x="2" y="${GROUND + 12}" fill="#9a9a9a">+${hidden}</text>` : ''

  // Obstacle k sits half a spacing past the runner at the loop's start; the
  // pattern of heights repeats every LOOP_S as the row slides one pattern left.
  let obstacles = ''
  const first = -Math.ceil(runnerX / SPACING) - OBJECTS.length
  const last = Math.ceil((width - runnerX) / SPACING) + OBJECTS.length
  for (let k = first; k <= last; k++) {
    const object = OBJECTS[mod(k, OBJECTS.length)]
    if (!object) continue
    const x = runnerX + SPACING * (k + 0.5)
    obstacles += `<g class="obstacle ${object.name}" transform="translate(${x.toFixed(1)} ${GROUND})">${object.svg}</g>`
  }
  const slideDelay = -mod(t, LOOP_S)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${HEIGHT}" width="${CANVAS}" height="${Math.round(HEIGHT * SCALE)}" preserveAspectRatio="xMinYMid slice">
<style>
.obstacles { animation: slide ${LOOP_S}s linear infinite; }
.jump { transform-box: fill-box; transform-origin: 50% 100%; animation: jump ${JUMP_S}s infinite; }
.speed { stroke-width: 2; stroke-linecap: round; stroke-dasharray: 6 6; opacity: 0.55; animation: speed 0.3s linear infinite; }
.footA { animation: foot 0.2s ease-in-out infinite alternate; }
.footB { animation: foot 0.2s ease-in-out infinite alternate-reverse; }
.enter { transform-box: view-box; transform-origin: 0 0; animation: enter 0.5s cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.exit { transform-box: view-box; transform-origin: 0 0; animation: exit ${EXIT_MS / 1000}s ease-in both; }
.name { font: 600 13px system-ui, sans-serif; }
@keyframes slide { from { transform: translateX(0); } to { transform: translateX(-${SPACING * OBJECTS.length}px); } }
@keyframes jump {
  0% { transform: translateY(0) scale(1.1, 0.88); animation-timing-function: ease-out; }
  12% { transform: translateY(0) scale(0.95, 1.06); animation-timing-function: ease-out; }
  50% { transform: translateY(-18px) scale(1, 1); animation-timing-function: ease-in; }
  88% { transform: translateY(0) scale(0.95, 1.05); }
  100% { transform: translateY(0) scale(1.1, 0.88); }
}
@keyframes speed { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 12; } }
@keyframes foot { from { transform: translate(-2px, 0); } to { transform: translate(2px, -2px); } }
@keyframes enter { from { opacity: 0; transform: scale(0.2); } to { opacity: 1; transform: scale(1); } }
@keyframes exit { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(-14px) scale(0.4); } }
@media (prefers-reduced-motion: reduce) { .obstacles, .jump, .speed, .footA, .footB, .enter, .exit { animation: none; } }
</style>
<g class="obstacles" style="animation-delay: ${slideDelay.toFixed(3)}s">${obstacles}</g>
${followers}
${more}
<g transform="translate(${runnerX} ${GROUND})"><g class="jump" style="animation-delay: ${jumpDelay(runnerX).toFixed(3)}s">${blob(RUNNER_COLOR, true)}</g></g>
</svg>`
}

// ---- terminal (ASCII) ----
// Plain ASCII only: wide or ambiguous-width glyphs would jitter on some terminals.
const T_STEP = 9 // cells between followers' slots
const T_GAP = 14 // cells between obstacles
const RUNNER_SPRITE = '(^^)'
const FOLLOWER_SPRITE = '(oo)'

type Part = { text: string; color?: string; dim?: boolean }
type Cell = { ch: string; color?: string; dim?: boolean }

function rowParts(cells: Cell[]): Part[] {
  const parts: Part[] = []
  for (const c of cells) {
    const last = parts[parts.length - 1]
    if (last && last.color === c.color && last.dim === c.dim) last.text += c.ch
    else parts.push({ text: c.ch, color: c.color, dim: c.dim })
  }
  return parts
}

function terminalScene(state: Crew, n: number, cols: number): Part[][] {
  const width = Math.max(30, cols - 1)
  const slots = capacity(cols, 1, T_STEP, 24)
  const runnerCol = 2 + slots * T_STEP
  const blank = (): Cell[] => Array.from({ length: width }, () => ({ ch: ' ' }))
  const air = blank()
  const floor = blank()
  const names = blank()

  // Obstacles slide one cell left per tick.
  const isObstacle = (x: number) => mod(x + n, T_GAP) === 0
  // Each obstacle keeps its object as it slides: its index along the floor.
  for (let x = 0; x < width; x++) {
    if (!isObstacle(x)) continue
    const object = OBJECTS[mod((x + n) / T_GAP, OBJECTS.length)]
    floor[x] = { ch: object?.ascii ?? '^', color: object?.color }
  }

  const put = (row: Cell[], col: number, text: string, color?: string) => {
    for (let i = 0; i < text.length; i++) if (col + i >= 0 && col + i < width) row[col + i] = { ch: text[i] ?? ' ', color }
  }
  // A character is in the air while an obstacle passes under it.
  const draw = (col: number, sprite: string, color: string) => {
    let isUp = false
    for (let x = col - 1; x <= col + sprite.length; x++) if (isObstacle(x)) isUp = true
    put(isUp ? air : floor, col, sprite, color)
  }

  for (const f of state.list) {
    if (f.leftAt !== undefined || f.slot >= slots) continue
    const col = runnerCol - (f.slot + 1) * T_STEP
    draw(col, FOLLOWER_SPRITE, f.color)
    put(names, col, shorten(f.label, T_STEP - 1), f.color)
  }
  draw(runnerCol, RUNNER_SPRITE, RUNNER_COLOR)
  return [air, floor, names].map(rowParts)
}

// ---- usage row ----
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

function ctxColor(percent: number): string {
  if (percent >= CTX_CRITICAL) return RED
  if (percent >= CTX_WARNING) return YELLOW
  return GREEN
}

// The share of all input the prompt cache served: high is cheap and fast.
function cacheColor(percent: number): string {
  if (percent >= CACHE_GOOD) return GREEN
  if (percent >= CACHE_FAIR) return YELLOW
  return RED
}

function limitColor(percent: number): string {
  if (percent >= LIMIT_CRITICAL) return RED
  if (percent >= LIMIT_WARNING) return YELLOW
  return GREEN
}

// How long until a window resets: 43m, 2h13m, 3d4h; null once passed or unknown.
function formatUntil(resetsAt: string | undefined, nowMs: number): string | null {
  if (!resetsAt) return null
  const ms = Date.parse(resetsAt) - nowMs
  if (!Number.isFinite(ms) || ms <= 0) return null
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

// 5h 38% (2h13m)  주간 12% (3d4h)
function limitParts(st: Stats): Part[] {
  const parts: Part[] = []
  for (const limit of st.limits ?? []) {
    const pct = Math.max(0, Math.round(limit.percentUsed))
    if (parts.length > 0) parts.push({ text: '  ' })
    parts.push({ text: `${LIMIT_LABELS[limit.kind] ?? limit.kind} `, dim: true }, { text: `${pct}%`, color: limitColor(pct) })
    const until = formatUntil(limit.resetsAt, st.at)
    if (until) parts.push({ text: ` (${until})`, dim: true })
  }
  return parts
}

// ctx [████░░░░░░] 42% 116k 남음  ·  5h 38% (2h13m)  주간 12% (3d4h)  ·  토큰 in 1.2M / out 34k  ·  캐시 적중 87%  ·  에이전트 3
function statParts(st: Stats | null, crewCount: number, isTerminal: boolean): Part[] {
  const sep: Part = { text: '  ·  ', dim: true }
  const parts: Part[] = [{ text: 'ctx ', dim: true }]
  if (st === null || st.ctxPercent === null) {
    parts.push({ text: '--', dim: true })
  } else {
    const pct = Math.min(100, Math.max(0, Math.round(st.ctxPercent)))
    const color = ctxColor(pct)
    const filled = Math.round(pct / 10)
    const [on, off] = isTerminal ? ['#', '.'] : ['█', '░']
    parts.push({ text: '[', dim: true }, { text: on.repeat(filled), color }, { text: off.repeat(10 - filled), dim: true })
    parts.push({ text: '] ', dim: true }, { text: `${pct}%`, color })
    if (st.ctxTokens !== null) {
      parts.push({ text: ` ${formatCount(Math.max(0, st.ctxWindow - st.ctxTokens))} 남음`, dim: true })
    }
    if (pct >= CTX_COMPACT) parts.push({ text: ' /compact?', color })
  }
  if (st !== null) {
    const limits = limitParts(st)
    if (limits.length > 0) parts.push(sep, ...limits)
    parts.push(sep, { text: '토큰 ', dim: true }, { text: `in ${formatCount(st.input)} / out ${formatCount(st.output)}` })
    parts.push(sep, { text: '캐시 적중 ', dim: true })
    if (st.input > 0) {
      const hit = Math.round((st.cacheRead / st.input) * 100)
      parts.push({ text: `${hit}%`, color: cacheColor(hit) })
    } else {
      parts.push({ text: '--', dim: true })
    }
  }
  if (crewCount > 0) parts.push(sep, { text: `에이전트 ${crewCount}`, dim: true })
  return parts
}

async function refreshStats($: EngineInterface) {
  const usage = await $.session.usage()
  const t = await read($, tokens)
  const fresh: Stats = {
    ctxTokens: usage.context.tokens ?? null,
    ctxWindow: usage.context.window,
    ctxPercent: usage.context.percent ?? null,
    input: t.input,
    output: t.output,
    cacheRead: t.cacheRead ?? 0, // absent from a total stored before cache reads were counted
    limits: usage.rateLimits.map(l => ({
      kind: l.kind,
      percentUsed: l.percentUsed,
      ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}),
    })),
    at: await $.clock.now(),
  }
  await update($, stats, () => fresh)
}

// ---- timer and subagent tracking ----
let timer: Timer | null = null
let isMainWorking = false
const labels = new Map<string, string>()

function start($: EngineInterface) {
  if (timer) return
  let ticks = 0
  timer = $.clock.every(TICK_MS, () => {
    void update($, frame, n => n + 1)
    ticks += 1
    if (ticks % STATS_EVERY === 0) void refreshStats($).catch(() => undefined)
  })
}

async function stop($: EngineInterface) {
  timer?.cancel()
  timer = null
  await update($, frame, () => 0)
}

async function labelOf($: EngineInterface, id: string): Promise<string> {
  const known = labels.get(id)
  if (known) return known
  const info = (await $.agent.list()).find(a => a.id === id)
  return info?.name ?? info?.type ?? 'agent'
}

async function join($: EngineInterface, id: string) {
  const label = await labelOf($, id)
  const now = await $.clock.now()
  await update($, crew, state => {
    const existing = state.list.find(f => f.id === id)
    if (existing && existing.leftAt === undefined) return state
    // A follower fading out that comes back (a resumed agent) runs on in its slot.
    const others = state.list.filter(f => f.id !== id)
    const usedSlots = new Set(others.map(f => f.slot))
    const usedColors = new Set(others.map(f => f.color))
    let slot = 0
    while (usedSlots.has(slot)) slot += 1
    const color =
      existing?.color ?? PALETTE.find(c => !usedColors.has(c)) ?? PALETTE[others.length % PALETTE.length] ?? PALETTE[0] ?? '#4F9DDE'
    const follower: Follower = existing
      ? { id, label, color, slot: existing.slot, joinedAt: existing.joinedAt }
      : { id, label, color, slot, joinedAt: now }
    return { list: [...others, follower], stamp: now }
  })
}

async function remove($: EngineInterface, id: string) {
  const now = await $.clock.now()
  const state = await update($, crew, s => {
    const gone = s.list.find(f => f.id === id)
    if (!gone || gone.leftAt === undefined) return s // came back meanwhile
    return { list: s.list.filter(f => f.id !== id), stamp: now }
  })
  if (state.list.length === 0 && !isMainWorking) await stop($)
}

async function leave($: EngineInterface, id: string) {
  labels.delete(id)
  const now = await $.clock.now()
  await update($, crew, state => ({
    list: state.list.map(f => (f.id === id ? { ...f, leftAt: now } : f)),
    stamp: now,
  }))
  // Let it fade out, then take it off the band.
  $.clock.after(EXIT_MS, () => {
    void remove($, id).catch(() => undefined)
  })
}

// Drop followers whose agent is no longer running (one killed before its
// turn.complete would otherwise stay on the band).
const DONE = new Set(['completed', 'failed', 'killed'])
async function prune($: EngineInterface) {
  const agents = await $.agent.list()
  const live = new Set(agents.filter(a => !DONE.has(a.status)).map(a => a.id))
  const now = await $.clock.now()
  await update($, crew, state =>
    state.list.every(f => live.has(f.id)) ? state : { list: state.list.filter(f => live.has(f.id)), stamp: now },
  )
}

export const register: Register = on => {
  // Remember each subagent's name (or its type) as it is spawned.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId) {
      const id = result.agentId
      const label = e.name ?? e.subagentType
      labels.set(id, label)
      await update($, crew, state =>
        state.list.some(f => f.id === id && f.label !== label)
          ? { ...state, list: state.list.map(f => (f.id === id ? { ...f, label } : f)) }
          : state,
      )
    }
    return result
  }).catch(($, e, next) => next(e)) // a drawing glitch must never block a spawn

  on('turn.start', async ($, e, next) => {
    start($)
    if (e.agentId) {
      await join($, e.agentId)
    } else {
      isMainWorking = true
      await prune($)
    }
    await refreshStats($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Every turn's tokens count, main's and each subagent's: new input, cache
    // writes and cache reads together, as the HUD's session total does.
    if ('usage' in e && e.usage) {
      const u = e.usage
      await update($, tokens, t => ({
        input: t.input + u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: (t.cacheRead ?? 0) + u.cache_read_input_tokens,
      }))
    }
    await refreshStats($)
    if (e.agentId) {
      await leave($, e.agentId)
    } else {
      isMainWorking = false
      // Background subagents may still be running: keep the band going for them.
      if ((await read($, crew)).list.length === 0) await stop($)
    }
    return result
  })

  // Drawing is pure: read state only, never write state or start timers here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, crew)
    // Shown while Claude works, and while background subagents still run.
    if ((!e.props.isWorking && state.list.length === 0) || e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const cols = e.props.bodyColumns
    const running = state.list.filter(f => f.leftAt === undefined)
    const st = await read($, stats)
    const row = statParts(st, running.length, e.surface === 'terminal')
    const statsRow = (
      <Box flexDirection="row">
        {row.map((p, i) => (
          <Text key={`s${i}`} color={p.color} dimColor={p.dim}>{p.text}</Text>
        ))}
      </Box>
    )

    // Vector surfaces animate in CSS and never read the frame. The SVG is phased
    // from the time of drawing; should the clock be refused here, from the
    // latest state change, which is what prompts a redraw.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      let nowMs: number
      try {
        nowMs = await $.clock.now()
      } catch {
        nowMs = Math.max(st?.at ?? 0, state.stamp)
      }
      const slots = capacity(cols, PX_PER_CELL, STEP * SCALE, 140)
      const names = running.map(f => f.label).join(', ')
      return (
        <Box flexDirection="column">
          <Svg
            source={sceneSvg(state, slots, nowMs)}
            height={Math.round(HEIGHT * SCALE)}
            alt={
              running.length > 0
                ? `캐릭터가 장애물을 뛰어넘고, ${names}가 뒤따라 뛰어요`
                : '캐릭터가 장애물을 뛰어넘으며 달려요'
            }
          />
          {statsRow}
        </Box>
      )
    }

    const n = await read($, frame)
    const rows = terminalScene(state, n, cols)
    return (
      <Box flexDirection="column">
        {rows.map((parts, r) => (
          <Box key={`r${r}`} flexDirection="row">
            {parts.map((p, i) => (
              <Text key={`r${r}c${i}`} color={p.color} dimColor={p.dim}>{p.text}</Text>
            ))}
          </Box>
        ))}
        {statsRow}
      </Box>
    )
  })
}
