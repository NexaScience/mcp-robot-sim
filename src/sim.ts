// ===========================================================================
// src/sim.ts — PURE simulation core (NO side effects, NO MCP/Express imports).
//
// THIS IS AN ARCHITECT STUB. The types/signatures below are the NORMATIVE
// contract from DESIGN.md (§2-§3). The coder MUST implement the function
// bodies so that tests/unit/sim.test.ts goes green WITHOUT changing these
// exported names or signatures.
//
// Current state: types are final; function bodies are placeholders that
// compile but FAIL the unit tests (RED). Replace the bodies, not the API.
// ===========================================================================

export type Dir = "N" | "E" | "S" | "W";

export type BlockColor = "red" | "green" | "blue" | "yellow";

export type Cell =
  | { kind: "empty" }
  | { kind: "wall" }
  | { kind: "block"; color: BlockColor };

export interface World {
  width: number;
  height: number;
  cells: Cell[][]; // cells[y][x] (row = y, col = x)
}

export interface Robot {
  x: number;
  y: number;
  dir: Dir;
}

export interface SimState {
  world: World;
  robot: Robot;
}

export interface ViewColumn {
  distance: number; // integer >= 1
  hit: "wall" | "block";
  color: "wall" | BlockColor;
}

export interface ViewColumns {
  columns: ViewColumn[]; // length === VIEW_COLUMNS
}

// --- Constants (NORMATIVE) -------------------------------------------------

export const GRID_SIZE = 7;

export const INITIAL_ROBOT: Robot = { x: 1, y: 1, dir: "N" };

export const VIEW_COLUMNS = 7;

// Fixed interior colored blocks. Interior cells only (1..GRID_SIZE-2), and
// never on INITIAL_ROBOT. Coder may keep this layout verbatim.
export const INITIAL_BLOCKS: ReadonlyArray<{
  x: number;
  y: number;
  color: BlockColor;
}> = [
  { x: 3, y: 2, color: "red" },
  { x: 2, y: 4, color: "green" },
  { x: 4, y: 4, color: "blue" },
  { x: 5, y: 1, color: "yellow" },
];

// --- Pure functions (STUBS — coder implements bodies to spec) --------------

// Forward (dx, dy) unit vector for each direction (NORMATIVE per DESIGN §2.2).
const FORWARD: Record<Dir, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

// Clockwise cycle order: N -> E -> S -> W -> N.
const CW_ORDER: Dir[] = ["N", "E", "S", "W"];

function rotate(dir: Dir, steps: number): Dir {
  const i = CW_ORDER.indexOf(dir);
  // +steps = clockwise. Normalize into [0, 4).
  const next = (((i + steps) % 4) + 4) % 4;
  return CW_ORDER[next];
}

export function createWorld(): World {
  const cells: Cell[][] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      const isOuterRing =
        x === 0 || y === 0 || x === GRID_SIZE - 1 || y === GRID_SIZE - 1;
      row.push(isOuterRing ? { kind: "wall" } : { kind: "empty" });
    }
    cells.push(row);
  }
  // Stamp the fixed colored blocks onto interior cells.
  for (const b of INITIAL_BLOCKS) {
    cells[b.y][b.x] = { kind: "block", color: b.color };
  }
  return { width: GRID_SIZE, height: GRID_SIZE, cells };
}

export function createInitialState(): SimState {
  return { world: createWorld(), robot: { ...INITIAL_ROBOT } };
}

export function reset(): SimState {
  return createInitialState();
}

export function canEnter(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return world.cells[y][x].kind === "empty";
}

export function moveForward(state: SimState): SimState {
  const { dx, dy } = FORWARD[state.robot.dir];
  const tx = state.robot.x + dx;
  const ty = state.robot.y + dy;
  if (!canEnter(state.world, tx, ty)) {
    // Collision (wall/block/out-of-bounds): no-op, but stay PURE (new robot obj).
    return { world: state.world, robot: { ...state.robot } };
  }
  return { world: state.world, robot: { x: tx, y: ty, dir: state.robot.dir } };
}

export function turnLeft(state: SimState): SimState {
  // Counter-clockwise = one step backwards in the clockwise order.
  return {
    world: state.world,
    robot: { ...state.robot, dir: rotate(state.robot.dir, -1) },
  };
}

export function turnRight(state: SimState): SimState {
  return {
    world: state.world,
    robot: { ...state.robot, dir: rotate(state.robot.dir, 1) },
  };
}

export function castView(state: SimState): ViewColumns {
  const center = Math.floor(VIEW_COLUMNS / 2);
  const { dx, dy } = FORWARD[state.robot.dir];
  // Strafe (lateral) axis = forward rotated 90° clockwise.
  const { dx: sx, dy: sy } = FORWARD[rotate(state.robot.dir, 1)];

  const columns: ViewColumn[] = [];
  for (let i = 0; i < VIEW_COLUMNS; i++) {
    // Lateral offset: leftmost column (i=0) is negative, center is 0.
    const lateral = i - center;
    const originX = state.robot.x + sx * lateral;
    const originY = state.robot.y + sy * lateral;
    columns.push(castColumn(state.world, originX, originY, dx, dy));
  }
  return { columns };
}

// Step cell-by-cell from (originX, originY) along (dx, dy) until a non-empty
// cell is hit. Distance counts steps (immediate neighbour => 1). The outer
// wall ring guarantees a hit, so distance is always finite and >= 1.
function castColumn(
  world: World,
  originX: number,
  originY: number,
  dx: number,
  dy: number,
): ViewColumn {
  let x = originX;
  let y = originY;
  let distance = 0;
  // Safety bound: at most width+height steps before we must hit the ring.
  const maxSteps = world.width + world.height;
  for (let step = 0; step < maxSteps; step++) {
    x += dx;
    y += dy;
    distance++;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) {
      // Treat the (theoretical) edge as a wall; should not happen inside ring.
      return { distance: Math.max(1, distance), hit: "wall", color: "wall" };
    }
    const cell = world.cells[y][x];
    if (cell.kind === "wall") {
      return { distance, hit: "wall", color: "wall" };
    }
    if (cell.kind === "block") {
      return { distance, hit: "block", color: cell.color };
    }
  }
  // Fallback (unreachable given the wall ring): report a far wall.
  return { distance: maxSteps, hit: "wall", color: "wall" };
}
