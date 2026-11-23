# runner-buddy

A Claude Code mod that draws a small band above the prompt while Claude works.

- **The runner.** A smiling orange blob runs at the left of the band, hopping as it goes and squashing a little when it lands. It tires as the context fills, on the context bar's thresholds: from 70% a flat mouth and a sweat drop, from 85% an open panting mouth, flushed cheeks and two drops (in the terminal `(^^)`, `(-;)`, `(@o)`).
- **What each one is doing.** While a tool runs, the runner says what it is in a speech bubble beside its head (`Edit register.tsx`, `$ npm test`, `Grep TODO`, `Fetch docs.anthropic.com`), and a follower's second line shows its tool in place of its model and time. A quick call's label stays up for a second, so it does not flicker.
- **Finish flag.** When the todo list (the terminal's TodoWrite or TaskCreate/TaskUpdate, or the desktop app's task list) has three steps or more, a checkered flag stands at the band's right end, as far in from the right (20 px) as the crew starts from the left, with the steps done over it (`3/5`). The runner and its followers move right toward it as steps are done and drop back when the plan grows; when every step is done the runner reaches the flag, which waves. At the next turn the flag is taken down and the runner walks back to its start. When a subagent joins, the runner and its followers glide a slot to the right to make room for it behind them, and drop back once it has left. The runner's speech bubble is cut short so it never covers the flag. The usage row shows `할 일 3/5` too.
- **Reactions.** A tool call that fails trips whoever made it (the runner, or that subagent's follower): it tips over with stars circling, then gets up. When a turn finishes the runner does two victory hops with confetti, and when one is interrupted it stops with a `…` bubble; the band stays up for these after the turn ends.
- **Subagents chase it.** Each running subagent appears behind the runner, in a fixed slot, as a frowning blob in its own colour with its name underneath and, below that, its model and how long it has run (`haiku 0:42`; past an hour the model shrinks to its initial, `o 1:02:03`, so the time is never cut). It hops just after the one ahead of it, so the crew bounces along in a ripple. A new one pops up in place; a finished one floats up and fades out before it leaves, and the others stay where they are. The band stays up while background subagents are still running after Claude's turn ends.
- **Usage row.** Under the drawing, in the style of the oh-my-claudecode HUD:
  `ctx [████░░░░░░] 42% 116k 남음   할 일 3/5   5h 38% (2h13m)  주간 12% (3d4h)   토큰 in 1.2M / out 34k   캐시 적중 87%   요금 구독제   에이전트 3`
  The row always stays on one line: as the band narrows it drops detail, most expendable first (the bar shrinks, then the tokens, reset times and bar go, then the cache and 요금), down to the context and the agent count.
  The context bar turns yellow from 70%, adds a `/compact?` hint from 80%, and turns red from 85%. The rate-limit windows (five-hour, weekly, or a gateway's spend limit) are shown together as one part, each with how much is used and how long until it resets, yellow from 70% and red from 90%; they are left out when the account reports none, as with an API key. 요금 says 구독제 on a claude.ai subscription, where use inside the plan is not billed in dollars, and otherwise shows the engine's cost estimate (`~$0.84 (추정)`, the figure `/cost` shows, not a bill). Tokens are summed over every turn (main and subagents) since the mod loaded. The cache hit rate is the share of all that input the prompt cache served (cache reads over new input, cache writes and cache reads together): green from 70%, yellow from 40%, red below.

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
