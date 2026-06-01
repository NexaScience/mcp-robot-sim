# mcp-robot-sim

A **toy robot simulator**, delivered as a
[SEP-1865 "MCP Apps"](https://modelcontextprotocol.io) interactive widget on
claude.ai.

A robot lives on a fixed `7 × 7` grid (outer ring is wall, a few colored
obstacle blocks inside). It has a position (cell) and a facing
(`N`/`E`/`S`/`W`). The agent and the user can both drive it. The widget renders
a **first-person pseudo-3D view** (Wolfenstein-style raycast) to a `<canvas>`
plus a small top-down minimap, and updates live.

The server performs **no external API calls**. All simulation logic is a set of
pure functions in `src/sim.ts`; `src/server.ts` is thin glue that holds the
robot state at module scope and exposes it via MCP tools. This project reuses
the **mcp-research / Alpic** stack (same stateless Streamable HTTP entrypoint).

## The control loop

```
Claude calls look / move_forward / turn_* / reset
        │
        ▼
tool returns { world, robot, view } ──renders──▶ robot widget in the chat
                                                        │
                    user clicks ↑前進 / ⟲左 / ⟳右 / ⟳リセット
                                                        │
                                                        ▼
                    widget calls tools/call directly and re-draws
                    from the returned structuredContent (live)
```

## World model (`src/sim.ts`)

- `GRID_SIZE = 7`. Outer ring (`x`/`y` = `0` or `6`) is always `wall`.
- Fixed colored blocks: red `(3,2)`, green `(2,4)`, blue `(4,4)`, yellow `(5,1)`.
- `INITIAL_ROBOT = { x: 1, y: 1, dir: 'N' }`.
- Conventions (NORMATIVE): `x` East, `y` South, `cells[y][x]`. Forward deltas
  `N(0,-1) E(1,0) S(0,1) W(-1,0)`. Clockwise turn order `N→E→S→W→N`.
- All transitions (`moveForward`, `turnLeft`, `turnRight`, `reset`) are **pure**
  (return new state, never mutate input). `moveForward` is a no-op on collision
  (wall/block/out-of-bounds).
- `castView` casts `VIEW_COLUMNS = 7` deterministic grid-stepping rays; the
  center column looks straight along `robot.dir`. Each column reports
  `{ distance, hit, color }`.

## Tools

All five are MCP App tools (`_meta.ui.resourceUri` → `ui://robot/view.html`),
take no arguments (`{}`), and return `structuredContent = { world, robot, view }`
plus a short human-readable text summary.

| Tool | Effect on robot |
|------|------|
| `look` | none (read) — returns current pose + first-person view |
| `move_forward` | move one cell forward; blocked by wall/block (no-op) |
| `turn_left` | rotate 90° counter-clockwise |
| `turn_right` | rotate 90° clockwise |
| `reset` | restore initial position and facing |

## Resource

`ui://robot/view.html` (mimeType `text/html;profile=mcp-app`) server-renders an
HTML document with **inline vanilla JS only** (no external/CDN scripts, no
bundler — claude.ai CSP-safe).

### Widget behavior

1. Handshake via `ui/initialize` using **`appInfo`** (not `clientInfo`),
   `protocolVersion: "2026-01-26"`, then notifies `ui/notifications/initialized`.
2. Primary render path: listens for `ui/notifications/tool-result` and draws
   from `params.structuredContent` (`{ world, robot, view }`) — the authoritative
   per-call data, correct under horizontal scaling. If none arrives it falls
   back to a `look` call.
3. Buttons (`↑ 前進` / `⟲ 左` / `⟳ 右` / `⟳ リセット`) call `tools/call`
   directly and re-draw from the returned `structuredContent` (live operation).

### Rendering

- First-person `<canvas>`: one vertical wall slice per view column, height
  scaled by `1/distance`, shaded by distance, colored by the hit (`wall` grey;
  blocks red/green/blue/yellow). Ceiling and floor are filled separately.
- Top-down minimap: draws `world.cells` and the robot as a triangle pointing
  along its facing.

## State note

`src/index.ts` runs in **stateless** Streamable HTTP mode and calls
`getServer()` once per POST. The robot `state` therefore lives at **module
scope** in `src/server.ts` (not inside `getServer()`), so it survives across
requests. It resets on process restart / redeploy. The widget always draws from
the pushed tool-result, so per-instance state is never authoritative for
rendering.

## Build, test & run

```bash
npm install
npm test           # vitest run — pure sim unit tests + server wiring smoke test
npm run build      # tsc → dist/
npm start          # node dist/index.js
```

The server speaks MCP over **Streamable HTTP** at `POST /mcp`
(`MCP_HTTP_PORT`, default `3000`). `GET`/`DELETE /mcp` return 405.

## Alpic deploy

Deploy the same way as the mcp-research / Alpic template:

1. Push this repo to GitHub (`NexaScience/mcp-robot-sim`).
2. In Alpic, import the repo (build command `npm run build`, start command
   `npm start`). Alpic provides the port via `MCP_HTTP_PORT`.
3. After deploy, the MCP endpoint is `https://<your-app>.alpic.live/mcp`;
   `initialize` → `tools/list` returns the 5 robot tools and the widget renders
   in claude.ai.
