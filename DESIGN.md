# DESIGN — mcp-robot-sim (toy robot simulator MCP)

> Task: `robot-sim-mcp-001` / system_type: `content_gen` (toy MCP server)
> Foundation: forked from NexaScience/mcp-research (Alpic-deployed MCP Apps widget).
> This document is the **API contract** the `coder` implements against. RED tests
> under `tests/` import the exact symbols specified here; implementing them to
> spec turns the suite green.

## 0. Scope of this change

Replace the research-domain server (`present_options` / `get_current_view` and the
research widget) with a **toy robot simulator**:

- A pure simulation core in `src/sim.ts` (no side effects, fully unit-tested).
- A Streamable-HTTP MCP server in `src/server.ts` exposing 5 tools and one UI
  resource, holding the robot state at **module scope** (mcp-research pattern).
- An MCP Apps widget (`ui://robot/view.html`) that renders a first-person
  pseudo-3D `<canvas>` view from the **pushed tool-result** structuredContent and
  lets the user drive the robot live via in-widget buttons.

`src/index.ts` (Express + Streamable HTTP, `sessionIdGenerator: undefined`, new
transport per POST) and `src/config.ts` are kept as-is from mcp-research.

## 1. Module layout

```
src/
  index.ts    # UNCHANGED: Express, POST /mcp, stateless transport per request
  config.ts   # UNCHANGED: env (MCP_HTTP_PORT)
  sim.ts      # NEW: pure simulation core — the heavily-tested unit
  server.ts   # REWRITTEN: module-scope robot state + 5 app tools + UI resource
tests/
  unit/sim.test.ts            # NEW: exhaustive unit tests for sim.ts (RED)
  integration/server.test.ts  # NEW: smoke test of getServer() wiring (RED)
vitest.config.ts              # NEW
```

Design intent: **all logic worth testing lives in `sim.ts`**. `server.ts` is thin
glue that (a) keeps the current `Robot` at module scope, (b) applies a sim
transition, (c) returns `{ world, robot, view }` as structuredContent. The widget
is presentation only.

## 2. World model (`sim.ts`)

### 2.1 Constants

- `GRID_SIZE = 7` — the world is a fixed `7 x 7` grid. Outer ring (`x === 0`,
  `y === 0`, `x === 6`, `y === 6`) is always `'wall'`.
- A few **fixed** colored blocks are placed on interior cells. Fixed layout
  (deterministic) — see `INITIAL_BLOCKS` below.
- `INITIAL_ROBOT: Robot = { x: 1, y: 1, dir: 'N' }` — interior, on an `'empty'`
  cell, by construction never on a wall/block.

### 2.2 Coordinate & direction conventions (NORMATIVE — tests depend on these)

- `x` increases to the **East**, `y` increases to the **South** (screen/array
  convention; row = `y`, col = `x`).
- Direction unit deltas (`forward` vector):
  - `'N'` → `(dx, dy) = (0, -1)`
  - `'E'` → `(dx, dy) = (1, 0)`
  - `'S'` → `(dx, dy) = (0, 1)`
  - `'W'` → `(dx, dy) = (-1, 0)`
- Turn order (clockwise): `N → E → S → W → N`.
  - `turnRight`: advance one step clockwise (`N→E→S→W→N`).
  - `turnLeft`: advance one step counter-clockwise (`N→W→S→E→N`).

### 2.3 Types

```ts
export type Dir = 'N' | 'E' | 'S' | 'W';

// Colors used by colored obstacle blocks. 'empty' and 'wall' are structural.
export type BlockColor = 'red' | 'green' | 'blue' | 'yellow';

export type Cell =
  | { kind: 'empty' }
  | { kind: 'wall' }
  | { kind: 'block'; color: BlockColor };

export interface World {
  width: number;          // === GRID_SIZE
  height: number;         // === GRID_SIZE
  cells: Cell[][];        // cells[y][x], row-major (y = row, x = col)
}

export interface Robot {
  x: number;              // 0..width-1
  y: number;              // 0..height-1
  dir: Dir;
}

// Full simulator state. World is constant for a given run but carried in state
// so transitions are pure (state in → state out) and the server can return it.
export interface SimState {
  world: World;
  robot: Robot;
}

// One raycast column for the first-person view.
export interface ViewColumn {
  // Perpendicular grid distance from the robot to the first non-empty cell hit
  // along this column's ray. Integer number of cells (>= 1). If the immediate
  // neighbour is solid the distance is 1.
  distance: number;
  // What the ray hit: a wall or a colored block.
  hit: 'wall' | 'block';
  // Color of the hit. 'wall' for walls; the block color for blocks.
  color: 'wall' | BlockColor;
}

// Deterministic first-person view: a fixed number of columns, left-to-right
// across the robot's field of view. Index 0 is the leftmost column.
export interface ViewColumns {
  columns: ViewColumn[];   // length === VIEW_COLUMNS
}
```

### 2.4 Exported constants (NORMATIVE)

```ts
export const GRID_SIZE: number;            // 7
export const INITIAL_ROBOT: Robot;         // { x: 1, y: 1, dir: 'N' }
export const VIEW_COLUMNS: number;          // number of raycast columns, = 7
export const INITIAL_BLOCKS: ReadonlyArray<{ x: number; y: number; color: BlockColor }>;
// Fixed interior blocks. Must NOT overlap INITIAL_ROBOT (1,1) and must be
// interior cells (1..5). Suggested layout (coder may keep exactly this):
//   { x: 3, y: 2, color: 'red' }
//   { x: 2, y: 4, color: 'green' }
//   { x: 4, y: 4, color: 'blue' }
//   { x: 5, y: 1, color: 'yellow' }
```

## 3. Pure function contract (`sim.ts`) — NORMATIVE signatures

```ts
// Build the fixed world (outer ring walls + INITIAL_BLOCKS), all other cells empty.
export function createWorld(): World;

// Fresh simulator state: fixed world + robot at INITIAL_ROBOT.
export function createInitialState(): SimState;

// Alias for createInitialState(): returns a brand-new initial state.
export function reset(): SimState;

// True iff (x,y) is inside the grid AND the cell is 'empty' (walkable).
// Out-of-bounds or wall/block => false.
export function canEnter(world: World, x: number, y: number): boolean;

// Move one cell along robot.dir. If the target cell is walkable ('empty'),
// return new state with updated robot position. If blocked (wall/block) OR
// out of bounds, return state with the robot UNCHANGED (collision => no-op).
// PURE: never mutates the input; returns a new SimState (new robot object).
export function moveForward(state: SimState): SimState;

// Rotate 90° counter-clockwise (N→W→S→E→N). Position unchanged. PURE.
export function turnLeft(state: SimState): SimState;

// Rotate 90° clockwise (N→E→S→W→N). Position unchanged. PURE.
export function turnRight(state: SimState): SimState;

// Deterministic raycast first-person view from the robot's pose.
// Casts VIEW_COLUMNS rays fanned across the field of view, leftmost first.
// For each column, walk cells outward until the first non-empty cell; report
// its grid distance (>=1), whether it is wall/block, and its color.
// PURE: depends only on (world, robot); same input => same output.
export function castView(state: SimState): ViewColumns;
```

### 3.1 `castView` determinism rules (so tests are stable)

The toy raycaster is **grid-stepping**, not floating-point, to stay deterministic:

- The center column (index `Math.floor(VIEW_COLUMNS / 2)`) looks straight along
  `robot.dir`: step cell-by-cell in the forward direction from the robot until a
  non-empty cell is hit; `distance` = number of steps taken (immediate neighbour
  => 1). The outer ring guarantees a hit within the grid, so `distance` is always
  finite and `>= 1`.
- Side columns look along the forward direction but offset laterally by a fixed
  per-column amount (left/right of the robot's strafe axis). The coder implements
  a simple deterministic fan; the **only** properties the tests assert are:
  - Output length is exactly `VIEW_COLUMNS`.
  - Every `distance >= 1` and integer.
  - Facing directly into an adjacent wall/block, the **center** column reports
    `distance === 1` and the correct `hit`/`color`.
  - Facing down an open corridor (several empty cells ahead, then the far wall),
    the **center** column reports `distance > 1`.
  - Same input state yields a deep-equal `ViewColumns` (determinism).

> Rationale: we pin the center-column semantics precisely (that is the
> correctness-bearing behaviour) and leave the lateral fan formula to the coder,
> asserting only structural invariants. This keeps the view contract testable
> without over-constraining the pseudo-3D look.

## 4. Server wiring (`server.ts`)

### 4.1 Module-scope state

```ts
let state: SimState = createInitialState(); // OUTSIDE getServer()
const UI_RESOURCE_URI = 'ui://robot/view.html';
```

`getServer()` is called once per POST (stateless transport). State MUST live at
module scope so the robot persists across requests — identical to the
mcp-research rationale.

### 4.2 structuredContent payload (returned by every app tool)

```ts
interface RobotToolResult {
  world: World;            // full grid (so widget can draw a minimap)
  robot: Robot;            // current pose
  view: ViewColumns;       // first-person columns for the canvas
}
```

`outputSchema` (zod, in `registerAppTool`) mirrors this shape. The widget renders
**only** from the pushed `ui/notifications/tool-result` `structuredContent`
(never from shared server state), exactly as mcp-research does — correct under
Alpic horizontal scaling.

### 4.3 Tools (all via `registerAppTool`, `_meta.ui.resourceUri = UI_RESOURCE_URI`)

| tool | inputSchema | effect on module state | returns |
|---|---|---|---|
| `look` | `{}` | none (read) | `{ world, robot, view }` |
| `move_forward` | `{}` | `state = moveForward(state)` | `{ world, robot, view }` |
| `turn_left` | `{}` | `state = turnLeft(state)` | `{ world, robot, view }` |
| `turn_right` | `{}` | `state = turnRight(state)` | `{ world, robot, view }` |
| `reset` | `{}` | `state = reset()` | `{ world, robot, view }` |

Each handler returns a `CallToolResult` whose `content[0]` is a short human-readable
text summary (e.g. pose) AND whose `structuredContent` is the `RobotToolResult`
above. `view` is `castView(state)` after the transition.

All five tools bind to the same UI resource so any of them can (re)spawn / update
the widget.

### 4.4 UI resource (`registerAppResource`)

- URI `ui://robot/view.html`, `mimeType = RESOURCE_MIME_TYPE`.
- Server-renders an HTML document with **inline** vanilla JS only (no external
  imports / CDN — claude.ai CSP-safe), drawing the first-person pseudo-3D view to
  a `<canvas>` plus an optional small top-down minimap.
- Handshake: `ui/initialize` with **`appInfo`** (NOT `clientInfo`),
  `protocolVersion: "2026-01-26"`, then `notify("ui/notifications/initialized")`.
- Primary render path: listen for `ui/notifications/tool-result`; draw from
  `params.structuredContent` (`{ world, robot, view }`).
- Buttons (前進 / 左回転 / 右回転 / リセット) call `tools/call`
  (`move_forward` / `turn_left` / `turn_right` / `reset`) via the bridge and
  re-draw from the returned `structuredContent` (mcp-todo live-operation pattern).
- A read-only server-rendered fallback is acceptable for non-UI hosts.

## 5. Environment / tooling changes (minimal)

- `package.json`: add devDependency `vitest` and script `"test": "vitest run"`.
  Rename `name` to `mcp-robot-sim`. (Test runner is **vitest** per task.)
- `vitest.config.ts`: minimal config, Node environment, include `tests/**/*.test.ts`.
- No infra/CI changes here. `npm install` is performed by the `coder`/`custodian`.

## 5.1 Test-time SDK imports

`tests/integration/server.test.ts` drives the real `McpServer` via an in-memory
transport pair:

- `Client` from `@modelcontextprotocol/sdk/client/index.js`
- `InMemoryTransport` from `@modelcontextprotocol/sdk/inMemory.js`
  (`InMemoryTransport.createLinkedPair()`).

These are the canonical subpath exports for `@modelcontextprotocol/sdk ^1.28.0`.
If a future SDK bump moves them, update only the two import lines in that test
(not the assertions). If wiring an in-memory client proves awkward, an
acceptable alternative is to export the tool handler functions from `server.ts`
and call them directly — but the structuredContent shape asserted here
(`{ world, robot, view }`) is NORMATIVE either way.

## 6. Notes for the coder

- Keep `sim.ts` free of any MCP/Express imports — pure TS only.
- All sim transitions must be non-mutating (return new objects); `tests/unit`
  asserts the input state is unchanged after `moveForward`/`turn*`.
- Use the exact exported symbol names/signatures in §2–§3. Tests import them
  directly; matching the contract makes them green.
- Keep the widget JS inline and CSP-safe; reuse the mcp-research postMessage
  bridge structure (request/notify/listener/`ui/initialize` with `appInfo`).
- `INITIAL_BLOCKS` may keep the suggested layout verbatim; if changed, ensure no
  block sits on `INITIAL_ROBOT` and the cell in front of the robot for the
  corridor test stays open (see test comments).

## 7. Open questions / ambiguities

- The lateral raycast fan formula is intentionally unspecified (toy visual).
  If a later task needs a faithful Wolfenstein projection, revisit `castView`
  and add tighter tests then. For now, structural invariants + pinned center
  column suffice.
