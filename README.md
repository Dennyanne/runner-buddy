# runner-buddy

A Claude Code mod that draws a small band above the prompt while Claude works.

- **The runner.** A smiling orange blob runs in place and jumps over small objects that slide in from the right (a ladybug, a mushroom, a coffee cup, `{ }` braces, a flower and a cactus), squashing a little when it lands.
- **Subagents chase it.** Each running subagent appears behind the runner, in a fixed slot, as a frowning blob in its own colour with its name underneath. It jumps the same obstacles, timed to its distance from the runner. A new one pops up in place; a finished one floats up and fades out before it leaves, and the others stay where they are. The band stays up while background subagents are still running after Claude's turn ends.
- **Usage row.** Under the drawing, in the style of the oh-my-claudecode HUD:
  `ctx [████░░░░░░] 42% 116k 남음 · 5h 38% (2h13m)  주간 12% (3d4h) · 토큰 in 1.2M / out 34k · 캐시 적중 87% · 에이전트 3`
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
