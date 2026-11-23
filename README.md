# runner-buddy

A Claude Code mod that draws a small band above the prompt while Claude works.

- **The runner.** A smiling orange blob runs in place and jumps over small objects that slide in from the right (a ladybug, a mushroom, a coffee cup, `{ }` braces, a flower and a cactus), squashing a little when it lands. It tires as the context fills, on the context bar's thresholds: from 70% a flat mouth and a sweat drop, from 85% an open panting mouth, flushed cheeks and two drops (in the terminal `(^^)`, `(-;)`, `(@o)`).
- **What each one is doing.** While a tool runs, the runner says what it is in a speech bubble beside its head (`Edit register.tsx`, `$ npm test`, `Grep TODO`, `Fetch docs.anthropic.com`), and a follower's second line shows its tool in place of its model and time. A quick call's label stays up for a second, so it does not flicker.
- **Reactions.** A tool call that fails trips whoever made it (the runner, or that subagent's follower): it tips over with stars circling, then gets up. When a turn finishes the runner does two victory hops with confetti, and when one is interrupted it stops with a `…` bubble; the band stays up for these after the turn ends.
- **Subagents chase it.** Each running subagent appears behind the runner, in a fixed slot, as a frowning blob in its own colour with its name underneath and, below that, its model and how long it has run (`haiku 0:42`; past an hour the model shrinks to its initial, `o 1:02:03`, so the time is never cut). It jumps the same obstacles, timed to its distance from the runner. A new one pops up in place; a finished one floats up and fades out before it leaves, and the others stay where they are. The band stays up while background subagents are still running after Claude's turn ends.
- **Usage row.** Under the drawing, in the style of the oh-my-claudecode HUD:
  `ctx [████░░░░░░] 42% 116k 남음   5h 38% (2h13m)   주간 12% (3d4h)   토큰 in 1.2M / out 34k   캐시 적중 87%   에이전트 3`
  Each part is one unit: on a narrow band whole parts move to the next line instead of breaking in the middle, and a part wider than the band is cut with an ellipsis.
  The context bar turns yellow from 70%, adds a `/compact?` hint from 80%, and turns red from 85%. The rate-limit windows (five-hour, weekly, or a gateway's spend limit) show how much is used and how long until each resets, yellow from 70% and red from 90%; they are left out when the account reports none, as with an API key. Tokens are summed over every turn (main and subagents) since the mod loaded. The cache hit rate is the share of all that input the prompt cache served (cache reads over new input, cache writes and cache reads together): green from 70%, yellow from 40%, red below.

The desktop app (and mobile, and the editor) draws the band as an animated SVG, every animation phased from the moment it is drawn, so a redraw picks up exactly where the last one was. The terminal draws an ASCII version. When Claude is idle and no subagent is running, nothing is drawn.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install runner-buddy --marketplace Dennyanne/runner-buddy
```

Answer `y` to add the marketplace, then choose a scope (the user scope is first; press Enter). The mod is active right away.

From a shell:

```
claude plugin install runner-buddy --marketplace Dennyanne/runner-buddy
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Dennyanne/runner-buddy`, then **Add plugin**.

## License

MIT
