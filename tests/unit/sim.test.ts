import { describe, it, expect } from "vitest";
import {
  GRID_SIZE,
  INITIAL_ROBOT,
  INITIAL_BLOCKS,
  VIEW_COLUMNS,
  createWorld,
  createInitialState,
  reset,
  canEnter,
  moveForward,
  turnLeft,
  turnRight,
  castView,
  type Dir,
  type SimState,
  type World,
} from "../../src/sim.js";

// ---------------------------------------------------------------------------
// These tests pin the NORMATIVE contract in DESIGN.md (§2-§3). They are RED
// until the coder implements src/sim.ts to spec. Conventions under test:
//   - cells[y][x] (row = y, x = col); x East, y South.
//   - forward deltas: N(0,-1) E(1,0) S(0,1) W(0,-1->-? see below)
//   - turnRight: N->E->S->W->N ; turnLeft: N->W->S->E->N
// ---------------------------------------------------------------------------

const FORWARD: Record<Dir, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

function withRobot(state: SimState, x: number, y: number, dir: Dir): SimState {
  return { world: state.world, robot: { x, y, dir } };
}

function cellAt(world: World, x: number, y: number) {
  return world.cells[y][x];
}

describe("world / initial state invariants", () => {
  it("createWorld builds a GRID_SIZE x GRID_SIZE grid", () => {
    const w = createWorld();
    expect(w.width).toBe(GRID_SIZE);
    expect(w.height).toBe(GRID_SIZE);
    expect(w.cells.length).toBe(GRID_SIZE);
    for (const row of w.cells) expect(row.length).toBe(GRID_SIZE);
  });

  it("the entire outer ring is wall", () => {
    const w = createWorld();
    for (let i = 0; i < GRID_SIZE; i++) {
      expect(cellAt(w, i, 0).kind).toBe("wall"); // top row
      expect(cellAt(w, i, GRID_SIZE - 1).kind).toBe("wall"); // bottom row
      expect(cellAt(w, 0, i).kind).toBe("wall"); // left col
      expect(cellAt(w, GRID_SIZE - 1, i).kind).toBe("wall"); // right col
    }
  });

  it("INITIAL_BLOCKS are interior, colored blocks, and not on the robot", () => {
    const w = createWorld();
    for (const b of INITIAL_BLOCKS) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.x).toBeLessThan(GRID_SIZE - 1);
      expect(b.y).toBeGreaterThan(0);
      expect(b.y).toBeLessThan(GRID_SIZE - 1);
      const c = cellAt(w, b.x, b.y);
      expect(c.kind).toBe("block");
      if (c.kind === "block") expect(c.color).toBe(b.color);
      // never under the initial robot position
      expect(b.x === INITIAL_ROBOT.x && b.y === INITIAL_ROBOT.y).toBe(false);
    }
  });

  it("createInitialState places the robot on an empty cell at INITIAL_ROBOT with initial dir", () => {
    const s = createInitialState();
    expect(s.robot).toEqual(INITIAL_ROBOT);
    expect(cellAt(s.world, s.robot.x, s.robot.y).kind).toBe("empty");
  });
});

describe("moveForward", () => {
  it("moves one cell forward into an empty cell for every direction", () => {
    // Stand on an interior open cell with open neighbours. Pick a spot with
    // empty neighbours in all 4 directions; (1,1)'s south/east neighbours are
    // empty, but to test all dirs put the robot in the middle (3,3) region that
    // is open in the suggested layout, then move and assert per-direction.
    const base = createInitialState();
    // Use a guaranteed-open center-ish cell surrounded by empties.
    const start = { x: 1, y: 5 - 0 }; // (1,5) interior; choose openness-safe below
    void start;

    const dirs: Dir[] = ["N", "E", "S", "W"];
    for (const dir of dirs) {
      // Place robot one cell "behind" an empty target so forward lands on empty.
      // Use (3,3)-ish: find an empty cell whose forward neighbour is also empty.
      const sx = 3;
      const sy = 3;
      const { dx, dy } = FORWARD[dir];
      const tx = sx + dx;
      const ty = sy + dy;
      const s0 = withRobot(base, sx, sy, dir);
      // Only assert movement when both start and target cells are empty.
      const startEmpty = cellAt(base.world, sx, sy).kind === "empty";
      const targetEmpty =
        tx > 0 && tx < GRID_SIZE && ty > 0 && ty < GRID_SIZE
          ? cellAt(base.world, tx, ty).kind === "empty"
          : false;
      const s1 = moveForward(s0);
      if (startEmpty && targetEmpty) {
        expect(s1.robot).toEqual({ x: tx, y: ty, dir });
      } else {
        // collision / wall: unchanged
        expect(s1.robot).toEqual({ x: sx, y: sy, dir });
      }
    }
  });

  it("does not move when facing a wall (outer ring)", () => {
    const base = createInitialState();
    // Robot at (1,1) facing North -> (1,0) is wall -> no move.
    const s = withRobot(base, 1, 1, "N");
    expect(moveForward(s).robot).toEqual({ x: 1, y: 1, dir: "N" });
    // Facing West -> (0,1) is wall -> no move.
    const s2 = withRobot(base, 1, 1, "W");
    expect(moveForward(s2).robot).toEqual({ x: 1, y: 1, dir: "W" });
  });

  it("does not move when facing a colored block", () => {
    const base = createInitialState();
    const b = INITIAL_BLOCKS[0];
    // Stand on the cell immediately "behind" the block w.r.t. North-facing:
    // robot just south of the block, facing North, so forward is the block.
    const rx = b.x;
    const ry = b.y + 1;
    // Guard: the cell we stand on must be empty for a valid setup.
    expect(cellAt(base.world, rx, ry).kind).toBe("empty");
    const s = withRobot(base, rx, ry, "N");
    expect(moveForward(s).robot).toEqual({ x: rx, y: ry, dir: "N" });
  });

  it("is pure: does not mutate the input state", () => {
    const s0 = createInitialState();
    const robotRef = s0.robot;
    const snapshot = { x: s0.robot.x, y: s0.robot.y, dir: s0.robot.dir };
    const s1 = withRobot(s0, 3, 3, "S");
    moveForward(s1);
    // original robot object untouched
    expect(s0.robot).toBe(robotRef);
    expect(s0.robot).toEqual(snapshot);
  });
});

describe("turnLeft / turnRight", () => {
  it("turnRight cycles clockwise N->E->S->W->N", () => {
    let s = withRobot(createInitialState(), 3, 3, "N");
    const seq: Dir[] = ["E", "S", "W", "N"];
    for (const expected of seq) {
      s = turnRight(s);
      expect(s.robot.dir).toBe(expected);
    }
  });

  it("turnLeft cycles counter-clockwise N->W->S->E->N", () => {
    let s = withRobot(createInitialState(), 3, 3, "N");
    const seq: Dir[] = ["W", "S", "E", "N"];
    for (const expected of seq) {
      s = turnLeft(s);
      expect(s.robot.dir).toBe(expected);
    }
  });

  it("four turns return to the original direction", () => {
    const dirs: Dir[] = ["N", "E", "S", "W"];
    for (const d of dirs) {
      let r = withRobot(createInitialState(), 3, 3, d);
      let l = withRobot(createInitialState(), 3, 3, d);
      for (let i = 0; i < 4; i++) {
        r = turnRight(r);
        l = turnLeft(l);
      }
      expect(r.robot.dir).toBe(d);
      expect(l.robot.dir).toBe(d);
    }
  });

  it("turnLeft ∘ turnRight is the identity on direction", () => {
    const dirs: Dir[] = ["N", "E", "S", "W"];
    for (const d of dirs) {
      const s = withRobot(createInitialState(), 3, 3, d);
      expect(turnLeft(turnRight(s)).robot.dir).toBe(d);
      expect(turnRight(turnLeft(s)).robot.dir).toBe(d);
    }
  });

  it("turning does not change position and does not mutate input", () => {
    const s0 = withRobot(createInitialState(), 3, 3, "N");
    const before = { ...s0.robot };
    const s1 = turnRight(s0);
    expect(s1.robot.x).toBe(3);
    expect(s1.robot.y).toBe(3);
    expect(s0.robot).toEqual(before); // unchanged
  });
});

describe("canEnter", () => {
  it("is false for walls, blocks, and out-of-bounds; true for empties", () => {
    const w = createWorld();
    expect(canEnter(w, 0, 0)).toBe(false); // wall corner
    expect(canEnter(w, -1, 3)).toBe(false); // OOB
    expect(canEnter(w, GRID_SIZE, 3)).toBe(false); // OOB
    const b = INITIAL_BLOCKS[0];
    expect(canEnter(w, b.x, b.y)).toBe(false); // block
    expect(canEnter(w, INITIAL_ROBOT.x, INITIAL_ROBOT.y)).toBe(true); // empty
  });
});

describe("reset", () => {
  it("returns a fresh initial state equal to createInitialState", () => {
    expect(reset()).toEqual(createInitialState());
  });

  it("after moving/turning, reset() restores the initial pose", () => {
    let s = createInitialState();
    s = turnRight(s);
    s = moveForward(s);
    const fresh = reset();
    expect(fresh.robot).toEqual(INITIAL_ROBOT);
  });
});

describe("castView", () => {
  it("returns exactly VIEW_COLUMNS columns, each with integer distance >= 1", () => {
    const s = createInitialState();
    const view = castView(s);
    expect(view.columns.length).toBe(VIEW_COLUMNS);
    for (const col of view.columns) {
      expect(Number.isInteger(col.distance)).toBe(true);
      expect(col.distance).toBeGreaterThanOrEqual(1);
      expect(["wall", "block"]).toContain(col.hit);
    }
  });

  it("is deterministic: same state yields deep-equal output", () => {
    const s = withRobot(createInitialState(), 3, 3, "E");
    expect(castView(s)).toEqual(castView(s));
  });

  it("center column reports distance 1 when facing directly into an adjacent wall", () => {
    const center = Math.floor(VIEW_COLUMNS / 2);
    // Robot at (1,1) facing North -> wall immediately at (1,0).
    const s = withRobot(createInitialState(), 1, 1, "N");
    const col = castView(s).columns[center];
    expect(col.distance).toBe(1);
    expect(col.hit).toBe("wall");
    expect(col.color).toBe("wall");
  });

  it("center column reports distance 1 when facing directly into an adjacent block", () => {
    const center = Math.floor(VIEW_COLUMNS / 2);
    const b = INITIAL_BLOCKS[0];
    // Stand just south of the block, face North so the block is the next cell.
    const s = withRobot(createInitialState(), b.x, b.y + 1, "N");
    const col = castView(s).columns[center];
    expect(col.distance).toBe(1);
    expect(col.hit).toBe("block");
    expect(col.color).toBe(b.color);
  });

  it("center column reports distance > 1 down an open corridor", () => {
    const center = Math.floor(VIEW_COLUMNS / 2);
    // From (1,1) facing East along row y=1: (2,1),(3,1),(4,1)... open until a
    // wall/block. The suggested layout has a yellow block at (5,1); regardless,
    // the immediate neighbour (2,1) is empty so the center distance must be > 1.
    const base = createInitialState();
    expect(cellAt(base.world, 2, 1).kind).toBe("empty");
    const s = withRobot(base, 1, 1, "E");
    const col = castView(s).columns[center];
    expect(col.distance).toBeGreaterThan(1);
  });
});
