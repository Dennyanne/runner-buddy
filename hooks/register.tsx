import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Crew, Doing, Follower, Reaction, ReactionKind, Stats, Tokens } from '../types'

import { toolLabel } from './tool-label'

const frame = atom({ plugin: 'runner-buddy', key: 'frame' } as const, 0)
const crew = atom({ plugin: 'runner-buddy', key: 'crew' } as const, { list: [], stamp: 0 } as Crew)
const tokens = atom({ plugin: 'runner-buddy', key: 'tokens' } as const, { input: 0, output: 0, cacheRead: 0 } as Tokens)
const stats = atom({ plugin: 'runner-buddy', key: 'stats' } as const, null as Stats | null)
const reactions = atom({ plugin: 'runner-buddy', key: 'reactions' } as const, [] as Reaction[])
const doing = atom({ plugin: 'runner-buddy', key: 'doing' } as const, [] as Doing[])

const TICK_MS = 120
const STATS_EVERY = 8 // ticks between usage refreshes (about once a second)
const EXIT_MS = 450 // how long a finished follower takes to fade out
// How long each reaction plays; the band stays up for it after a turn ends.
const REACTION_MS: Record<ReactionKind, number> = { trip: 1200, finish: 2200, stop: 1500 }
const RUNNER = 'runner' // a reaction's target when it is the runner's
const DOING_MIN_MS = 1000 // a tool's label stays up at least this long, so a quick Read does not flicker
const BUBBLE_CHARS = 24 // the runner's speech bubble, in characters
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
const HEIGHT = 76 // drawing units; constant so the band never changes height
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

// The model family from an id: claude-haiku-5-5 -> haiku; anything else, shortened.
function shortModel(model: string | undefined): string | null {
  if (!model) return null
  const family = /(haiku|sonnet|opus|fable)/i.exec(model)?.[1]
  return family ? family.toLowerCase() : shorten(model.replace(/^claude-/, ''), 8)
}

// 0:42, 12:05, 1:03:20
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// A follower's second line, at most `max` characters: its model and how long it
// has run (frozen once it finished). The time is never cut; the model gives way
// first to a shorter name, then to its initial: "haiku 0:42", "o 1:02:03".
function followerMeta(f: Follower, nowMs: number | null, max: number): string {
  const model = shortModel(f.model)
  const time = nowMs === null ? null : formatElapsed((f.leftAt ?? nowMs) - f.joinedAt)
  if (!time) return shorten(model ?? '', max)
  if (!model) return time
  const full = `${model} ${time}`
  if (full.length <= max) return full
  const room = max - time.length - 1
  if (room >= 4) return `${shorten(model, room)} ${time}`
  return `${model[0]} ${time}`
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b
}

function capacity(cols: number, cellPx: number, step: number, reserve: number): number {
  return Math.max(0, Math.min(MAX_SLOTS, Math.floor((cols * cellPx - reserve) / step)))
}

// How the runner feels, from how full the context is (the context bar's own
// thresholds): fresh, tired from 70%, exhausted from 85%.
type Mood = 'fresh' | 'tired' | 'exhausted'

function moodOf(st: Stats | null): Mood {
  const pct = st?.ctxPercent ?? 0
  if (pct >= CTX_CRITICAL) return 'exhausted'
  if (pct >= CTX_WARNING) return 'tired'
  return 'fresh'
}

// A drop drawn outside the head, deeper blue with a white rim so it shows on the orange.
const SWEAT_DROP = `<path d="M 0 -4.5 q 3.4 4.8 0 7 q -3.4 -2.2 0 -7 Z" fill="#3FA9F5" stroke="#ffffff" stroke-width="0.8"/>`

// The runner's face for its mood: a smile; a flat mouth and a sweat drop; an
// open panting mouth, flushed cheeks and two drops.
function runnerFace(mood: Mood): string {
  if (mood === 'fresh') {
    return `<path d="M 1 -10 Q 4.5 -7.5 8 -10" stroke="#1f1f1f" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
  }
  const drop = (x: number, y: number, delayS: number) =>
    `<g transform="translate(${x} ${y})"><g class="sweat" style="animation-delay: ${delayS}s">${SWEAT_DROP}</g></g>`
  if (mood === 'tired') {
    return `<path d="M 2 -10 L 7.5 -10" stroke="#1f1f1f" stroke-width="1.4" stroke-linecap="round"/>${drop(-15, -25, 0)}`
  }
  return `<ellipse class="pant" cx="4.8" cy="-9.6" rx="2" ry="2.4" fill="#1f1f1f"/>
<circle cx="-3" cy="-12" r="2.2" fill="#E5484D" opacity="0.45"/><circle cx="11" cy="-12" r="2" fill="#E5484D" opacity="0.45"/>
${drop(-15, -25, 0)}${drop(-17, -15, -0.45)}`
}

// A rounded blob on its feet at (0, 0), facing right. Followers frown with
// determination; the runner's face shows its mood.
function blob(color: string, isRunner: boolean, mood: Mood = 'fresh'): string {
  const face = isRunner
    ? runnerFace(mood)
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

const STAR = `<path d="M 0 -3 L 0.8 -0.8 L 3 0 L 0.8 0.8 L 0 3 L -0.8 0.8 L -3 0 L -0.8 -0.8 Z" fill="#F5C842"/>`
const CONFETTI_COLORS = ['#E5484D', '#F5C842', '#4F9DDE', '#4CB782', '#B57EDC', '#E0698A', '#3FB8AF', '#E8A33D']

// A character's body at (0, 0) on its feet: jumping, or playing its reaction,
// each phased from when the reaction began so a redraw resumes it.
// The runner's speech bubble for the tool it is running, beside its head on the
// right (above would leave the band at the top of a jump), tail toward its mouth.
function bubble(text: string): string {
  const label = shorten(text, BUBBLE_CHARS)
  const width = 9 + label.length * 5.5
  return `<g class="bubble" transform="translate(16 -27)"><path d="M 0.5 6 L -4 9.5 L 0.5 10 Z" fill="#ffffff" stroke="#cfcfcf" stroke-width="0.8"/><rect x="0" y="0" width="${width.toFixed(1)}" height="13" rx="6.5" fill="#ffffff" stroke="#cfcfcf" stroke-width="0.8"/><text class="tool" x="4.5" y="9.3">${escapeXml(label)}</text></g>`
}

function body(color: string, isRunner: boolean, mood: Mood, jumpDelayS: number, act: Reaction | undefined, nowMs: number, says?: string): string {
  const jumping = () =>
    `<g class="jump" style="animation-delay: ${jumpDelayS.toFixed(3)}s">${blob(color, isRunner, mood)}${says ? bubble(says) : ''}</g>`
  if (!act) return jumping()
  const age = `-${Math.max(0, (nowMs - act.at) / 1000).toFixed(3)}s`
  if (act.kind === 'trip') {
    // Tips forward over its front foot (the pivot at x 12, on the ground) to lie
    // flat ahead of where it stood, stars circling over it, then gets up.
    const stars = [[18, -30], [27, -35], [36, -30]].map(([x, y]) => `<g transform="translate(${x} ${y})">${STAR}</g>`).join('')
    return `<g class="trip" style="animation-delay: ${age}">${blob(color, isRunner, mood)}</g><g class="stars" style="animation-delay: ${age}">${stars}</g>`
  }
  if (act.kind === 'finish') {
    // Two victory hops, smiling whatever the context, and a burst of confetti.
    const bits = CONFETTI_COLORS.map(
      (c, i) => `<rect class="confetti c${(i % 4) + 1}" style="animation-delay: ${age}" x="${(i % 2) * 3 - 1.5}" y="-28" width="2.6" height="1.6" fill="${c}"/>`,
    ).join('')
    return `<g class="cheer" style="animation-delay: ${age}">${blob(color, isRunner, 'fresh')}</g>${bits}`
  }
  // Stopped: stands still with a "…" bubble.
  return `${blob(color, isRunner, mood)}<g class="say" style="animation-delay: ${age}"><rect x="9" y="-45" width="20" height="12" rx="6" fill="#ffffff" stroke="#cfcfcf" stroke-width="0.8"/><text x="19" y="-36.5" text-anchor="middle" class="dots">…</text></g>`
}

// Every animation is phased from `nowMs`, the moment of drawing, so a redrawn
// SVG (any redraw of the band remounts it) resumes exactly where it was.
function sceneSvg(state: Crew, slots: number, nowMs: number, mood: Mood = 'fresh', acts: Reaction[] = [], busy: Doing[] = []): string {
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
      const tool = busy.find(d => d.target === f.id)
      const meta = escapeXml(tool ? shorten(tool.text, 11) : followerMeta(f, nowMs, 11))
      return `<g transform="translate(${x} ${GROUND})"><g ${life}>
${body(f.color, false, 'fresh', jumpDelay(x), acts.find(r => r.target === f.id), nowMs)}
<text class="name" x="0" y="12" text-anchor="middle" fill="${f.color}">${label}</text>
<text class="meta" x="0" y="25" text-anchor="middle" fill="${f.color}">${meta}</text>
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
.sweat { animation: sweat 0.9s ease-in infinite; }
.pant { transform-box: fill-box; transform-origin: 50% 50%; animation: pant 0.3s ease-in-out infinite alternate; }
.trip { transform-box: view-box; transform-origin: 12px 0; animation: trip ${REACTION_MS.trip / 1000}s ease-out both; }
.trip .speed { display: none; }
.stars { transform-box: fill-box; transform-origin: 50% 50%; animation: stars ${REACTION_MS.trip / 1000}s linear both; }
.cheer { transform-box: fill-box; transform-origin: 50% 100%; animation: cheer ${REACTION_MS.finish / 1000}s ease-in-out both; }
.confetti { opacity: 0; animation-duration: 1.4s; animation-timing-function: ease-out; animation-fill-mode: both; }
.c1 { animation-name: c1; } .c2 { animation-name: c2; } .c3 { animation-name: c3; } .c4 { animation-name: c4; }
.say { animation: say ${REACTION_MS.stop / 1000}s ease-out both; }
.dots { font: 700 10px system-ui, sans-serif; fill: #555555; }
.bubble { animation: pop 0.2s ease-out both; }
.tool { font: 500 9px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #444444; }
.enter { transform-box: view-box; transform-origin: 0 0; animation: enter 0.5s cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.exit { transform-box: view-box; transform-origin: 0 0; animation: exit ${EXIT_MS / 1000}s ease-in both; }
.name { font: 600 13px system-ui, sans-serif; }
.meta { font: 500 11px system-ui, sans-serif; opacity: 0.75; font-variant-numeric: tabular-nums; }
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
@keyframes sweat { from { opacity: 1; transform: translate(0, 0); } to { opacity: 0; transform: translate(-5px, 6px); } }
@keyframes pant { from { transform: scale(1, 0.6); } to { transform: scale(1, 1.15); } }
@keyframes trip {
  0% { transform: rotate(0deg); }
  12% { transform: translate(1px, -4px) rotate(14deg); }
  30% { transform: rotate(84deg); }
  78% { transform: rotate(84deg); }
  100% { transform: rotate(0deg); }
}
@keyframes stars { 0% { opacity: 0; transform: rotate(0deg); } 25% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; transform: rotate(140deg); } }
@keyframes cheer {
  0% { transform: translateY(0) rotate(0deg); }
  15% { transform: translateY(-16px) rotate(-8deg); }
  30% { transform: translateY(0) rotate(0deg); }
  45% { transform: translateY(-16px) rotate(8deg); }
  60% { transform: translateY(0) rotate(0deg); }
  100% { transform: translateY(0) rotate(0deg); }
}
@keyframes c1 { from { opacity: 1; transform: translate(0, 0) rotate(0deg); } to { opacity: 0; transform: translate(-17px, -12px) rotate(220deg); } }
@keyframes c2 { from { opacity: 1; transform: translate(0, 0) rotate(0deg); } to { opacity: 0; transform: translate(17px, -12px) rotate(-220deg); } }
@keyframes c3 { from { opacity: 1; transform: translate(0, 0) rotate(0deg); } to { opacity: 0; transform: translate(-9px, -17px) rotate(160deg); } }
@keyframes c4 { from { opacity: 1; transform: translate(0, 0) rotate(0deg); } to { opacity: 0; transform: translate(9px, -17px) rotate(-160deg); } }
@keyframes say { 0% { opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; } }
@keyframes pop { from { opacity: 0; } to { opacity: 1; } }
@keyframes enter { from { opacity: 0; transform: scale(0.2); } to { opacity: 1; transform: scale(1); } }
@keyframes exit { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(-14px) scale(0.4); } }
@media (prefers-reduced-motion: reduce) { .obstacles, .jump, .speed, .footA, .footB, .enter, .exit, .sweat, .pant, .trip, .stars, .cheer, .confetti, .say, .bubble { animation: none; } }
</style>
<g class="obstacles" style="animation-delay: ${slideDelay.toFixed(3)}s">${obstacles}</g>
${followers}
${more}
<g transform="translate(${runnerX} ${GROUND})">${body(RUNNER_COLOR, true, mood, jumpDelay(runnerX), acts.find(r => r.target === RUNNER), nowMs, busy.find(d => d.target === RUNNER)?.text)}</g>
</svg>`
}

// ---- terminal (ASCII) ----
// Plain ASCII only: wide or ambiguous-width glyphs would jitter on some terminals.
const T_STEP = 9 // cells between followers' slots
const T_GAP = 14 // cells between obstacles
// The runner's face per mood, four cells like the followers' '(oo)'.
const RUNNER_SPRITES: Record<Mood, string> = { fresh: '(^^)', tired: '(-;)', exhausted: '(@o)' }
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

function terminalScene(state: Crew, n: number, cols: number, nowMs: number | null, mood: Mood = 'fresh', acts: Reaction[] = [], busy: Doing[] = []): Part[][] {
  const width = Math.max(30, cols - 1)
  const slots = capacity(cols, 1, T_STEP, 24)
  const runnerCol = 2 + slots * T_STEP
  const blank = (): Cell[] => Array.from({ length: width }, () => ({ ch: ' ' }))
  const air = blank()
  const floor = blank()
  const names = blank()
  const metas = blank()

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
  // A character is in the air while an obstacle passes under it; a reaction
  // takes over: fallen with stars over it, cheering in the air, or stopped.
  const draw = (col: number, sprite: string, color: string, act?: Reaction) => {
    if (act?.kind === 'trip') {
      put(floor, col, '(xx)', color)
      put(air, col, '*  *', '#F5C842')
      return
    }
    if (act?.kind === 'finish') {
      put(air, col - 1, '*', '#E5484D')
      put(air, col, '\\^^/', color)
      put(air, col + 4, '*', '#4F9DDE')
      return
    }
    if (act?.kind === 'stop') {
      put(floor, col, sprite, color)
      put(air, col + 4, '...', color)
      return
    }
    let isUp = false
    for (let x = col - 1; x <= col + sprite.length; x++) if (isObstacle(x)) isUp = true
    put(isUp ? air : floor, col, sprite, color)
  }

  for (const f of state.list) {
    if (f.leftAt !== undefined || f.slot >= slots) continue
    const col = runnerCol - (f.slot + 1) * T_STEP
    draw(col, FOLLOWER_SPRITE, f.color, acts.find(r => r.target === f.id))
    put(names, col, shorten(f.label, T_STEP - 1), f.color)
    // "h 0:42": the model's initial keeps it inside the slot.
    const tool = busy.find(d => d.target === f.id)
    put(metas, col, tool ? shorten(tool.text, T_STEP - 1) : followerMeta({ ...f, model: shortModel(f.model)?.[0] }, nowMs, T_STEP - 1), f.color)
  }
  draw(runnerCol, RUNNER_SPRITES[mood], RUNNER_COLOR, acts.find(r => r.target === RUNNER))
  const says = busy.find(d => d.target === RUNNER)
  if (says) put(names, runnerCol, shorten(says.text, Math.max(4, width - runnerCol)), RUNNER_COLOR)
  const rows = [air, floor, names]
  if (metas.some(c => c.ch !== ' ')) rows.push(metas)
  return rows.map(rowParts)
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

// The usage row as groups, each drawn as one unit that never breaks inside:
// on a narrow band whole groups move to the next line.
//   ctx [████░░░░░░] 42% 116k 남음 | 5h 38% (2h13m) | 주간 12% (3d4h) | 토큰 in 1.2M / out 34k | 캐시 적중 87% | 에이전트 3
function statGroups(st: Stats | null, crewCount: number, isTerminal: boolean): Part[][] {
  const groups: Part[][] = []
  const ctx: Part[] = [{ text: 'ctx ', dim: true }]
  if (st === null || st.ctxPercent === null) {
    ctx.push({ text: '--', dim: true })
  } else {
    const pct = Math.min(100, Math.max(0, Math.round(st.ctxPercent)))
    const color = ctxColor(pct)
    const filled = Math.round(pct / 10)
    const [on, off] = isTerminal ? ['#', '.'] : ['█', '░']
    ctx.push({ text: '[', dim: true }, { text: on.repeat(filled), color }, { text: off.repeat(10 - filled), dim: true })
    ctx.push({ text: '] ', dim: true }, { text: `${pct}%`, color })
    if (st.ctxTokens !== null) {
      ctx.push({ text: ` ${formatCount(Math.max(0, st.ctxWindow - st.ctxTokens))} 남음`, dim: true })
    }
    if (pct >= CTX_COMPACT) ctx.push({ text: ' /compact?', color })
  }
  groups.push(ctx)
  if (st !== null) {
    for (const limit of st.limits ?? []) {
      const pct = Math.max(0, Math.round(limit.percentUsed))
      const window: Part[] = [{ text: `${LIMIT_LABELS[limit.kind] ?? limit.kind} `, dim: true }, { text: `${pct}%`, color: limitColor(pct) }]
      const until = formatUntil(limit.resetsAt, st.at)
      if (until) window.push({ text: ` (${until})`, dim: true })
      groups.push(window)
    }
    groups.push([{ text: '토큰 ', dim: true }, { text: `in ${formatCount(st.input)} / out ${formatCount(st.output)}` }])
    const hit = st.input > 0 ? Math.round((st.cacheRead / st.input) * 100) : null
    groups.push([
      { text: '캐시 적중 ', dim: true },
      hit === null ? { text: '--', dim: true } : { text: `${hit}%`, color: cacheColor(hit) },
    ])
  }
  if (crewCount > 0) groups.push([{ text: `에이전트 ${crewCount}`, dim: true }])
  return groups
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
const known = new Map<string, { label: string; model?: string }>()

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

async function infoOf($: EngineInterface, id: string): Promise<{ label: string; model?: string }> {
  const remembered = known.get(id)
  if (remembered?.model) return remembered
  const info = (await $.agent.list()).find(a => a.id === id)
  return {
    label: remembered?.label ?? info?.name ?? info?.type ?? 'agent',
    ...(remembered?.model ?? info?.model ? { model: remembered?.model ?? info?.model } : {}),
  }
}

async function join($: EngineInterface, id: string) {
  const { label, model } = await infoOf($, id)
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
    if (model) follower.model = model
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
  known.delete(id)
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

let callSeq = 0

// Shows `text` as what `target` is doing; returns when it began.
async function startDoing($: EngineInterface, target: string, text: string, seq: number): Promise<number> {
  const at = await $.clock.now()
  await update($, doing, list => [...list.filter(d => d.target !== target), { target, text, at, seq }])
  return at
}

// Clears it once the call is done, but not before it has shown for a moment,
// and only if no later call of that character has taken its place.
async function endDoing($: EngineInterface, target: string, seq: number, at: number) {
  const clear = () => update($, doing, list => (list.some(d => d.seq === seq) ? list.filter(d => d.seq !== seq) : list))
  const shown = (await $.clock.now()) - at
  if (shown >= DOING_MIN_MS) {
    await clear()
    return
  }
  $.clock.after(DOING_MIN_MS - shown, () => {
    void clear().catch(() => undefined)
  })
}

// Plays `kind` on `target` (the runner or a follower), replacing one it was
// playing, and takes it off once its time is up.
async function react($: EngineInterface, target: string, kind: ReactionKind) {
  const at = await $.clock.now()
  await update($, reactions, list => [...list.filter(r => r.target !== target), { target, kind, at }])
  $.clock.after(REACTION_MS[kind], () => {
    void endReaction($, target, at).catch(() => undefined)
  })
}

async function endReaction($: EngineInterface, target: string, at: number) {
  await update($, reactions, list =>
    list.some(r => r.target === target && r.at === at) ? list.filter(r => !(r.target === target && r.at === at)) : list,
  )
}

export const register: Register = on => {
  // Remember each subagent's name (or its type) and model as it is spawned.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId) {
      const id = result.agentId
      const label = e.name ?? e.subagentType
      const model = result.model
      known.set(id, model ? { label, model } : { label })
      await update($, crew, state =>
        state.list.some(f => f.id === id && (f.label !== label || (model && f.model !== model)))
          ? { ...state, list: state.list.map(f => (f.id === id ? { ...f, label, ...(model ? { model } : {}) } : f)) }
          : state,
      )
    }
    return result
  }).catch(($, e, next) => next(e)) // a drawing glitch must never block a spawn

  // While a tool call runs, its character shows what it is; one that fails
  // trips that character. Both are decoration: the call and its result pass
  // through untouched, whatever happens to them.
  on('tool.call', async ($, e, next) => {
    const target = e.agentId ?? RUNNER
    const seq = ++callSeq
    let startedAt: number | null = null
    try {
      startedAt = await startDoing($, target, toolLabel(e.tool, e as unknown as Record<string, unknown>), seq)
    } catch {
      // No label this time.
    }
    const result = await next(e)
    try {
      if (startedAt !== null) await endDoing($, target, seq, startedAt)
      if (result.isError === true) await react($, target, 'trip')
    } catch {
      // A reaction is decoration: never let it touch the call's result.
    }
    return result
  }).catch(($, e, next) => next(e))

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
    const done = e.agentId ?? RUNNER
    await update($, doing, list => (list.some(d => d.target === done) ? list.filter(d => d.target !== done) : list))
    if (e.agentId) {
      await leave($, e.agentId)
    } else {
      isMainWorking = false
      // The runner cheers a finished turn, stops at an interruption, trips on an error.
      const kind: ReactionKind | null =
        e.reason === 'answer' ? 'finish' : e.reason === 'aborted' ? 'stop' : e.reason === 'error' ? 'trip' : null
      if (kind) await react($, RUNNER, kind)
      // Background subagents may still be running: keep the band going for them.
      if ((await read($, crew)).list.length === 0) await stop($)
    }
    return result
  })

  // Drawing is pure: read state only, never write state or start timers here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, crew)
    const acts = (await read($, reactions)) ?? [] // none stored yet reads as no reactions
    const busy = (await read($, doing)) ?? []
    // Shown while Claude works, while background subagents still run, and while
    // a reaction plays out (the cheer after a turn ends).
    if ((!e.props.isWorking && state.list.length === 0 && acts.length === 0) || e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const cols = e.props.bodyColumns
    const running = state.list.filter(f => f.leftAt === undefined)
    const st = await read($, stats)
    const groups = statGroups(st, running.length, e.surface === 'terminal')
    // Each group is one Text holding its coloured runs, so it wraps as a unit;
    // one wider than the band is cut with an ellipsis rather than broken.
    const statsRow = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        {groups.map((g, i) => (
          <Text key={`g${i}`} wrap="truncate">
            {g.map((p, j) => (
              <Text key={`g${i}p${j}`} color={p.color} dimColor={p.dim}>{p.text}</Text>
            ))}
          </Text>
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
            source={sceneSvg(state, slots, nowMs, moodOf(st), acts, busy)}
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
    const rows = terminalScene(state, n, cols, st?.at ?? null, moodOf(st), acts, busy)
    return (
      <Box flexDirection="column">
        {/* Each scene row is one line cut to the band, never wrapped: a wrap would
            push its characters out of line with the row above. */}
        {rows.map((parts, r) => (
          <Text key={`r${r}`} wrap="truncate">
            {parts.map((p, i) => (
              <Text key={`r${r}c${i}`} color={p.color} dimColor={p.dim}>{p.text}</Text>
            ))}
          </Text>
        ))}
        {statsRow}
      </Box>
    )
  })
}
