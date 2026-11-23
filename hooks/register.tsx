import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Crew, Doing, Follower, Reaction, ReactionKind, Stats, Todos, Tokens } from '../types'

import { planOf } from './plan'
import { roomOf, withList } from './room'
import { applyTodoCall, remainingShare, todoProgress } from './todos'
import { toolLabel } from './tool-label'

const frame = atom({ plugin: 'runner-buddy', key: 'frame' } as const, 0)
const crew = atom({ plugin: 'runner-buddy', key: 'crew' } as const, { list: [], stamp: 0 } as Crew)
const tokens = atom({ plugin: 'runner-buddy', key: 'tokens' } as const, { input: 0, output: 0, cacheRead: 0 } as Tokens)
const stats = atom({ plugin: 'runner-buddy', key: 'stats' } as const, null as Stats | null)
const reactions = atom({ plugin: 'runner-buddy', key: 'reactions' } as const, [] as Reaction[])
const doing = atom({ plugin: 'runner-buddy', key: 'doing' } as const, [] as Doing[])
const NO_TODOS: Todos = { items: [], fromShare: 1, changedAt: 0 }
const todos = atom({ plugin: 'runner-buddy', key: 'todos' } as const, NO_TODOS)

const TICK_MS = 120
const STATS_EVERY = 8 // ticks between usage refreshes (about once a second)
const EXIT_MS = 450 // how long a finished follower takes to fade out
// How long each reaction plays; the band stays up for it after a turn ends.
const REACTION_MS: Record<ReactionKind, number> = { trip: 1200, finish: 2200, stop: 1500 }
const RUNNER = 'runner' // a reaction's target when it is the runner's
const DOING_MIN_MS = 1000 // a tool's label stays up at least this long, so a quick Read does not flicker
const BUBBLE_CHARS = 24 // the runner's speech bubble, in characters
// The finish flag stands still at the band's right end (FLAG_SPAN past the
// most slots when the band's width is not known); the runner and its
// followers move right by the share done, gliding there in ADVANCE_S, and
// stop FLAG_NEAR short of the flag once all is done.
const FLAG_NEAR = 26
const FLAG_SPAN = 300
const ADVANCE_S = 0.8
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
// Every character hops on a fixed period, each a little after the one ahead
// of it, as if over the same bump, so the crew bounces along in a ripple.
const SCALE = 0.7 // shown at this fraction of the drawing's units
const CANVAS = 2400 // px; the drawing's own width, which the band narrows to its slot
const PX_PER_CELL = 7.5 // the band reports code-font cells, not pixels: an estimate, for sizing only
const HEIGHT = 76 // drawing units; constant so the band never changes height
const GROUND = 48 // y of every character's feet
const STEP = 72 // units between followers' slots
// The scene keeps the same margin, in CSS pixels, at both ends of the band:
// from the left edge to the leftmost character's speed lines (31 units behind
// it), and from the flag's count and cloth (15 units past its pole) to the
// right edge.
const MARGIN_PX = 20
const START_X = Math.round(MARGIN_PX / 0.7 + 31) // the runner's place with no followers, in units
const RIPPLE = 120 / 0.9 // units per second the hops' ripple runs back along the crew
const JUMP_S = 0.9 // seconds per hop
// The flag's pole stands this far in from the band's right edge, in CSS pixels.
const FLAG_EDGE_PX = MARGIN_PX + 15 * 0.7
const FLAG_MIN_STEPS = 3 // a list of fewer steps puts up no flag: too short a run to show

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

// Whether the list is long enough to put up the finish flag.
function hasFlag(td: Todos): boolean {
  return td.items.length >= FLAG_MIN_STEPS
}

// The share of the list still to do, as the runner's place reads it: 1 (at
// its start) with no flag up.
function shareLeft(td: Todos): number {
  return hasFlag(td) ? remainingShare(td.items) : 1
}

// The finish flag for the todo list: a checkered flag on a pole at the band's
// right end, the steps done over it; it waves once all is done.
function flagSvg(td: Todos, flagX: number): string {
  if (!hasFlag(td)) return ''
  const { done, total } = todoProgress(td.items)
  let checks = ''
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      checks += `<rect x="${1 + col * 3}" y="${-34 + row * 4}" width="3" height="4" fill="${(row + col) % 2 === 0 ? '#2b2b2b' : '#ffffff'}"/>`
    }
  }
  return `<g class="flag" transform="translate(${flagX.toFixed(1)} ${GROUND})">
<line x1="0" y1="0" x2="0" y2="-35" stroke="#7a7a7a" stroke-width="1.4" stroke-linecap="round"/>
<g class="${done === total ? 'cloth wave' : 'cloth'}"><rect x="0.6" y="-34.4" width="13" height="8.8" fill="none" stroke="#7a7a7a" stroke-width="0.6"/>${checks}</g>
<text class="steps" x="7" y="-38" text-anchor="middle">${done}/${total}</text>
</g>`
}

// Every animation is phased from `nowMs`, the moment of drawing, so a redrawn
// SVG (any redraw of the band remounts it) resumes exactly where it was.
function sceneSvg(state: Crew, slots: number, nowMs: number, mood: Mood = 'fresh', acts: Reaction[] = [], busy: Doing[] = [], td: Todos = NO_TODOS, flagX = START_X + slots * STEP + FLAG_SPAN + FLAG_NEAR): string {
  const t = nowMs / 1000
  // The runner starts at the left, one slot farther right for each follower's
  // slot in use, so they have room behind it. The flag stands at the band's
  // right end; the runner covers the share done of the way there. `flagX` is
  // where the band's width in columns puts the flag, in units: an estimate,
  // used only for the hops' phases and the bubble's room. The drawing itself
  // places the crew and the flag by the band's real width (`%` of it).
  const room = Math.min(slots, roomOf(state.list))
  const fromRoom = Math.min(slots, state.fromRoom ?? room)
  const placeOf = (r: number, share: number) => {
    const startX = START_X + r * STEP
    return startX + Math.round((1 - share) * (flagX - FLAG_NEAR - startX))
  }
  const runnerX = placeOf(room, shareLeft(td))
  const flag = flagSvg(td, 0) // drawn at its pole, placed from the right edge below
  // The runner's bubble stops short of the flag, even stretched by a landing's
  // squash (1.1 wide): cut to the room before it, and left out where not even
  // a few letters fit (at the flag itself).
  const said = busy.find(d => d.target === RUNNER)?.text
  const bubbleChars = !hasFlag(td) ? BUBBLE_CHARS : Math.floor(((flagX - runnerX - 4) / 1.1 - 16 - 9) / 5.5)
  const says = said === undefined || bubbleChars < 4 ? undefined : shorten(said, Math.min(BUBBLE_CHARS, bubbleChars))
  // The crew glides from where it stood before the list's last change, and
  // steps aside (or back) when the followers' room last changed.
  const glideAge = Math.max(0, (nowMs - td.changedAt) / 1000)
  const shiftAge = Math.max(0, (nowMs - (state.roomAt ?? 0)) / 1000)
  // The crew's place in CSS pixels as `calc(P% + Apx)` of the band's width: a
  // share `d` done of the way from its start to just short of the flag.
  const crewAt = (r: number, share: number) => {
    const d = 1 - share // shareLeft and a stored fromShare already read 1 with no flag up
    const startPx = SCALE * (START_X + r * STEP)
    const endInsetPx = FLAG_EDGE_PX + SCALE * FLAG_NEAR
    const px = (1 - d) * startPx - d * endInsetPx
    return `calc(${(d * 100).toFixed(2)}% + ${px.toFixed(1)}px)`
  }
  const crewNow = crewAt(room, shareLeft(td))
  const crewFrom = crewAt(room, td.fromShare)
  // Stepping aside for a follower moves the start by whole slots, scaled by
  // the share of the way still to go.
  const shiftUnits = shareLeft(td) * (fromRoom - room) * STEP

  // A hop peaks a little later the farther back a character is: the anchor's
  // phase, delayed by the ripple's travel from the anchor to it.
  const jumpDelay = (x: number) => -mod(t - (START_X - x) / RIPPLE, JUMP_S)

  const followers = state.list
    .filter(f => f.slot < slots)
    .map(f => {
      const rel = -(f.slot + 1) * STEP
      const x = runnerX + rel // its estimated place, for its hop's phase
      const ageS = (nowMs - f.joinedAt) / 1000
      const life =
        f.leftAt === undefined
          ? `class="enter" style="animation-delay: -${Math.max(0, ageS).toFixed(3)}s"`
          : `class="exit" style="animation-delay: -${Math.max(0, (nowMs - f.leftAt) / 1000).toFixed(3)}s"`
      const label = escapeXml(shorten(f.label, 9))
      const tool = busy.find(d => d.target === f.id)
      const meta = escapeXml(tool ? shorten(tool.text, 11) : followerMeta(f, nowMs, 11))
      return `<g transform="translate(${rel} ${GROUND})"><g ${life}>
${body(f.color, false, 'fresh', jumpDelay(x), acts.find(r => r.target === f.id), nowMs)}
<text class="name" x="0" y="12" text-anchor="middle" fill="${f.color}">${label}</text>
<text class="meta" x="0" y="25" text-anchor="middle" fill="${f.color}">${meta}</text>
</g></g>`
    })
    .join('\n')
  const hidden = state.list.filter(f => f.slot >= slots && f.leftAt === undefined).length
  const more = hidden > 0 ? `<g transform="scale(${SCALE})"><text class="name" x="2" y="${GROUND + 12}" fill="#9a9a9a">+${hidden}</text></g>` : ''


  // No viewBox: the drawing's units are the band's CSS pixels, so `100%` is the
  // band's real width; each part is drawn in units inside a scale(SCALE) group.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${Math.round(HEIGHT * SCALE)}">
<style>
/* Squash and stretch about the feet (0, 0), not the group's box: that box
   holds the speed lines, swinging feet and bubble, so its centre wanders and a
   landing squash would shove the body sideways. */
.jump { transform-box: view-box; transform-origin: 0 0; animation: jump ${JUMP_S}s infinite; }
.speed { stroke-width: 2; stroke-linecap: round; stroke-dasharray: 6 6; opacity: 0.55; animation: speed 0.3s linear infinite; }
.footA { animation: foot 0.2s ease-in-out infinite alternate; }
.footB { animation: foot 0.2s ease-in-out infinite alternate-reverse; }
.sweat { animation: sweat 0.9s ease-in infinite; }
.pant { transform-box: fill-box; transform-origin: 50% 50%; animation: pant 0.3s ease-in-out infinite alternate; }
.trip { transform-box: view-box; transform-origin: 12px 0; animation: trip ${REACTION_MS.trip / 1000}s ease-out both; }
.trip .speed { display: none; }
.stars { transform-box: fill-box; transform-origin: 50% 50%; animation: stars ${REACTION_MS.trip / 1000}s linear both; }
.cheer { transform-box: view-box; transform-origin: 0 0; animation: cheer ${REACTION_MS.finish / 1000}s ease-in-out both; }
.confetti { opacity: 0; animation-duration: 1.4s; animation-timing-function: ease-out; animation-fill-mode: both; }
.c1 { animation-name: c1; } .c2 { animation-name: c2; } .c3 { animation-name: c3; } .c4 { animation-name: c4; }
.say { animation: say ${REACTION_MS.stop / 1000}s ease-out both; }
.dots { font: 700 10px system-ui, sans-serif; fill: #555555; }
.bubble { animation: pop 0.2s ease-out both; }
.tool { font: 500 9px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #444444; }
.crew, .flagpos { transform-box: view-box; }
.advance { animation: advance ${ADVANCE_S}s cubic-bezier(0.2, 0.8, 0.3, 1) both; }
.shift { animation: shift ${ADVANCE_S}s cubic-bezier(0.3, 0.7, 0.3, 1) both; }
.steps { font: 700 9px system-ui, sans-serif; fill: #7a7a7a; font-variant-numeric: tabular-nums; }
.wave { transform-box: fill-box; transform-origin: 0 50%; animation: wave 0.6s ease-in-out infinite alternate; }
.enter { transform-box: view-box; transform-origin: 0 0; animation: enter 0.5s cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.exit { transform-box: view-box; transform-origin: 0 0; animation: exit ${EXIT_MS / 1000}s ease-in both; }
.name { font: 600 13px system-ui, sans-serif; }
.meta { font: 500 11px system-ui, sans-serif; opacity: 0.75; font-variant-numeric: tabular-nums; }
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
@keyframes wave { from { transform: skewY(-6deg) scaleX(0.94); } to { transform: skewY(5deg) scaleX(1); } }
@keyframes advance { from { transform: translateX(${crewFrom}); } to { transform: translateX(${crewNow}); } }
@keyframes shift { from { transform: translateX(${shiftUnits.toFixed(1)}px); } to { transform: translateX(0); } }
@keyframes enter { from { opacity: 0; transform: scale(0.2); } to { opacity: 1; transform: scale(1); } }
@keyframes exit { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(-14px) scale(0.4); } }
@media (prefers-reduced-motion: reduce) { .jump, .speed, .footA, .footB, .enter, .exit, .sweat, .pant, .trip, .stars, .cheer, .confetti, .say, .bubble, .advance, .shift, .wave { animation: none; } }
</style>
${flag ? `<g class="flagpos" style="transform: translateX(calc(100% - ${FLAG_EDGE_PX.toFixed(1)}px))"><g transform="scale(${SCALE})">${flag}</g></g>` : ''}
${more}
<g class="crew advance" style="transform: translateX(${crewNow}); animation-delay: -${glideAge.toFixed(3)}s"><g transform="scale(${SCALE})"><g class="shift" style="animation-delay: -${shiftAge.toFixed(3)}s">
${followers}
<g transform="translate(0 ${GROUND})">${body(RUNNER_COLOR, true, mood, jumpDelay(runnerX), acts.find(r => r.target === RUNNER), nowMs, says)}</g>
</g></g></g>
</svg>`
}

// ---- terminal (ASCII) ----
// Plain ASCII only: wide or ambiguous-width glyphs would jitter on some terminals.
const T_STEP = 9 // cells between followers' slots
const T_GAP = 14 // ticks between a character's hops
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

function terminalScene(state: Crew, n: number, cols: number, nowMs: number | null, mood: Mood = 'fresh', acts: Reaction[] = [], busy: Doing[] = [], td: Todos = NO_TODOS): Part[][] {
  const width = Math.max(30, cols - 1)
  const slots = capacity(cols, 1, T_STEP, 24)
  // The runner starts at the left, a slot farther right for each follower's
  // slot in use, and walks right by the share done toward a fixed flag.
  // '|>' ends two cells in from the right, as the leftmost sprite starts two in from the left.
  const flagCol = Math.max(2 + slots * T_STEP + 12, width - 4)
  const startCol = 2 + Math.min(slots, roomOf(state.list)) * T_STEP
  const endCol = flagCol - 6
  const runnerCol = startCol + Math.round((1 - shareLeft(td)) * (endCol - startCol))
  const blank = (): Cell[] => Array.from({ length: width }, () => ({ ch: ' ' }))
  const air = blank()
  const floor = blank()
  const names = blank()
  const metas = blank()

  // An unseen bump runs back one cell per tick, every T_GAP cells; a
  // character is up while one passes under it, so the crew hops in a ripple.
  const isBump = (x: number) => mod(x + n, T_GAP) === 0

  const put = (row: Cell[], col: number, text: string, color?: string) => {
    for (let i = 0; i < text.length; i++) if (col + i >= 0 && col + i < width) row[col + i] = { ch: text[i] ?? ' ', color }
  }
  // A character is in the air while a bump passes under it; a reaction
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
    for (let x = col - 1; x <= col + sprite.length; x++) if (isBump(x)) isUp = true
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
  if (hasFlag(td)) {
    // |> on the floor at a fixed spot, past where the runner stops.
    const { done, total } = todoProgress(td.items)
    const col = flagCol
    put(floor, col, '|', '#7a7a7a')
    put(air, col, '|>', done === total ? '#4CB782' : '#E5484D')
  }
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

// The usage row as groups at a level of detail, 0 the most. The row is one
// line: it drops detail until it fits rather than wrapping.
//   0  ctx [██████████] 42% 116k 남음   5h 38% (2h13m)  주간 12% (3d4h)   토큰 in 1.2M / out 34k   캐시 적중 87%   요금 구독제   에이전트 3
//   1  ctx [█████] 42%   5h 38% (2h13m)  주간 12% (3d4h)   토큰 1.2M/34k   캐시 87%   구독제   에이전트 3
//   2  ctx 42%  5h 38%  주간 12%  캐시 87%  구독제  에이전트 3
//   3  ctx 42%  5h 38%  주간 12%  에이전트 3
//   4  ctx 42%  에이전트 3
const DETAIL_LEVELS = 5

function statGroups(st: Stats | null, crewCount: number, isTerminal: boolean, level = 0, todo: { done: number; total: number } | null = null): Part[][] {
  const groups: Part[][] = []
  const ctx: Part[] = [{ text: 'ctx ', dim: true }]
  if (st === null || st.ctxPercent === null) {
    ctx.push({ text: '--', dim: true })
  } else {
    const pct = Math.min(100, Math.max(0, Math.round(st.ctxPercent)))
    const color = ctxColor(pct)
    const cells = level === 0 ? 10 : level === 1 ? 5 : 0
    if (cells > 0) {
      const filled = Math.round((pct / 100) * cells)
      const [on, off] = isTerminal ? ['#', '.'] : ['█', '░']
      ctx.push({ text: '[', dim: true }, { text: on.repeat(filled), color }, { text: off.repeat(cells - filled), dim: true }, { text: '] ', dim: true })
    }
    ctx.push({ text: `${pct}%`, color })
    if (level === 0 && st.ctxTokens !== null) {
      ctx.push({ text: ` ${formatCount(Math.max(0, st.ctxWindow - st.ctxTokens))} 남음`, dim: true })
    }
    if (pct >= CTX_COMPACT) ctx.push({ text: level <= 1 ? ' /compact?' : '!', color })
  }
  groups.push(ctx)
  if (st !== null) {
    // All the rate-limit windows together, as one unit: they read as a pair.
    if (level <= 3) {
      const windows: Part[] = []
      for (const limit of st.limits ?? []) {
        const pct = Math.max(0, Math.round(limit.percentUsed))
        if (windows.length > 0) windows.push({ text: '  ' })
        windows.push({ text: `${LIMIT_LABELS[limit.kind] ?? limit.kind} `, dim: true }, { text: `${pct}%`, color: limitColor(pct) })
        const until = level <= 1 ? formatUntil(limit.resetsAt, st.at) : null
        if (until) windows.push({ text: ` (${until})`, dim: true })
      }
      if (windows.length > 0) groups.push(windows)
    }
    if (level === 0) {
      groups.push([{ text: '토큰 ', dim: true }, { text: `in ${formatCount(st.input)} / out ${formatCount(st.output)}` }])
    } else if (level === 1) {
      groups.push([{ text: '토큰 ', dim: true }, { text: `${formatCount(st.input)}/${formatCount(st.output)}` }])
    }
    if (level <= 2) {
      const hit = st.input > 0 ? Math.round((st.cacheRead / st.input) * 100) : null
      groups.push([
        { text: level === 0 ? '캐시 적중 ' : '캐시 ', dim: true },
        hit === null ? { text: '--', dim: true } : { text: `${hit}%`, color: cacheColor(hit) },
      ])
      // On a subscription, use inside the plan is not billed in dollars: say so
      // instead of a figure. Otherwise the engine's estimate, labelled as one.
      const fee: Part[] = level === 0 ? [{ text: '요금 ', dim: true }] : []
      if (st.plan === 'subscription') {
        groups.push([...fee, { text: '구독제' }])
      } else if (st.usd !== undefined) {
        const amount: Part = { text: `~$${st.usd.toFixed(2)}${st.hasUnknownPrice ? '*' : ''}` }
        groups.push(level === 0 ? [...fee, amount, { text: ' (추정)', dim: true }] : [amount])
      }
    }
  }
  if (todo && todo.total > 0 && level <= 3) {
    groups.splice(1, 0, [{ text: '할 일 ', dim: true }, { text: `${todo.done}/${todo.total}`, color: todo.done === todo.total ? GREEN : undefined }])
  }
  if (crewCount > 0) groups.push([{ text: `에이전트 ${crewCount}`, dim: true }])
  return groups
}

// Cells a text takes on a monospaced grid: Hangul and other wide letters two,
// the rest one (the bar's blocks and the ellipsis included).
function cellWidth(text: string): number {
  let cells = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    cells += wide ? 2 : 1
  }
  return cells
}

// The gap between groups, in cells: roomier at the detailed levels.
function groupGap(level: number): number {
  return level <= 1 ? 3 : 2
}

function rowWidth(groups: Part[][], level: number): number {
  const text = groups.reduce((sum, g) => sum + g.reduce((n, p) => n + cellWidth(p.text), 0), 0)
  return text + groupGap(level) * Math.max(0, groups.length - 1)
}

// The most detailed level whose row fits in `cols` cells; the least, cut at
// its end, when even that does not.
function fitStats(st: Stats | null, crewCount: number, isTerminal: boolean, cols: number, todo: { done: number; total: number } | null = null): { groups: Part[][]; level: number } {
  const room = Math.max(1, cols - 1)
  for (let level = 0; level < DETAIL_LEVELS - 1; level++) {
    const groups = statGroups(st, crewCount, isTerminal, level, todo)
    if (rowWidth(groups, level) <= room) return { groups, level }
  }
  const level = DETAIL_LEVELS - 1
  return { groups: statGroups(st, crewCount, isTerminal, level, todo), level }
}

// How the session is signed in, read once: it does not change within a session.
let signedInAs: string | null = null

async function refreshStats($: EngineInterface) {
  const usage = await $.session.usage()
  const t = await read($, tokens)
  if (signedInAs === null) {
    try {
      signedInAs = (await $.session.identity()).kind ?? null
    } catch {
      // Not answered: the rate-limit windows decide.
    }
  }
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
    plan: planOf(signedInAs, usage.rateLimits.length > 0),
    ...(usage.cost ? { usd: usage.cost.usd } : {}),
    ...(usage.cost?.hasUnknownPrice ? { hasUnknownPrice: true } : {}),
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
    return withList(state, [...others, follower], now)
  })
}

async function remove($: EngineInterface, id: string) {
  const now = await $.clock.now()
  const state = await update($, crew, s => {
    const gone = s.list.find(f => f.id === id)
    if (!gone || gone.leftAt === undefined) return s // came back meanwhile
    return withList(s, s.list.filter(f => f.id !== id), now)
  })
  if (state.list.length === 0 && !isMainWorking) await stop($)
}

async function leave($: EngineInterface, id: string) {
  known.delete(id)
  const now = await $.clock.now()
  await update($, crew, state => withList(state, state.list.map(f => (f.id === id ? { ...f, leftAt: now } : f)), now))
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
    state.list.every(f => live.has(f.id)) ? state : withList(state, state.list.filter(f => live.has(f.id)), now),
  )
}

let callSeq = 0

// Updates the todo list from a call that succeeded, if it keeps the list,
// remembering where the flag stood so it glides from there.
async function followTodos($: EngineInterface, tool: string, input: Record<string, unknown>, result: unknown) {
  const current = (await read($, todos)) ?? NO_TODOS
  const items = applyTodoCall(current.items, tool, input, result)
  if (items === null || JSON.stringify(items) === JSON.stringify(current.items)) return
  const now = await $.clock.now()
  const fromShare = shareLeft(current)
  await update($, todos, () => ({ items, fromShare, changedAt: now }))
}

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
    // The app's own bookkeeping (its task list, its wrap-up) is not work to show.
    if (!e.tool.startsWith('mcp__ccd_turn__')) {
      try {
        startedAt = await startDoing($, target, toolLabel(e.tool, e as unknown as Record<string, unknown>), seq)
      } catch {
        // No label this time.
      }
    }
    const result = await next(e)
    try {
      if (result.deny === undefined && result.isError !== true) await followTodos($, e.tool, e as unknown as Record<string, unknown>, result.result)
    } catch {
      // The flag is decoration too.
    }
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
      const td = (await read($, todos)) ?? NO_TODOS
      // The runner walks back to its start from the flag (if one was up).
      if (td.items.length > 0 && td.items.every(i => i.status === 'completed')) {
        const now = await $.clock.now()
        await update($, todos, () => ({ items: [], fromShare: shareLeft(td), changedAt: now }))
      }
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
    const td = (await read($, todos)) ?? NO_TODOS
    // Shown while Claude works, while background subagents still run, and while
    // a reaction plays out (the cheer after a turn ends).
    if ((!e.props.isWorking && state.list.length === 0 && acts.length === 0) || e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const cols = e.props.bodyColumns
    const running = state.list.filter(f => f.leftAt === undefined)
    const st = await read($, stats)
    const { groups, level } = fitStats(st, running.length, e.surface === 'terminal', cols, td.items.length > 0 ? todoProgress(td.items) : null)
    // One line: the groups were chosen to fit, and the row never wraps. Each
    // group is one Text holding its coloured runs, so should the estimate be
    // short, a group is cut with an ellipsis rather than broken.
    const statsRow = (
      <Box flexDirection="row" flexWrap="nowrap" columnGap={groupGap(level)}>
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
      // Where the flag stands, as the band's width in columns suggests: only an
      // estimate (the drawing anchors the flag to the real right edge), for the
      // hops' ripple and the room the runner's bubble has.
      const view = (cols * PX_PER_CELL) / SCALE
      const flagX = Math.round(Math.max(view - FLAG_EDGE_PX / SCALE, START_X + slots * STEP + 60 + FLAG_NEAR))
      const names = running.map(f => f.label).join(', ')
      return (
        <Box flexDirection="column">
          <Svg
            source={sceneSvg(state, slots, nowMs, moodOf(st), acts, busy, td, flagX)}
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
    const rows = terminalScene(state, n, cols, st?.at ?? null, moodOf(st), acts, busy, td)
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
