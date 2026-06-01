import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getServer } from "../../src/server.js";

// ---------------------------------------------------------------------------
// Smoke / wiring test (integration). RED until src/server.ts is rewritten to
// the robot domain per DESIGN.md (§4). Exercises the real McpServer over an
// in-memory transport pair: tools/list must expose the 5 robot tools, and a
// `look` call must return structuredContent with world + robot + view.
//
// NOTE: getServer() holds robot state at MODULE scope, so tests that mutate
// state (move/reset) call `reset` first to normalize, and we connect a fresh
// client per test against a fresh server instance.
// ---------------------------------------------------------------------------

const EXPECTED_TOOLS = ["look", "move_forward", "turn_left", "turn_right", "reset"];

async function connectClient() {
  const server = getServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client };
}

describe("getServer wiring", () => {
  let client: Client;

  beforeEach(async () => {
    ({ client } = await connectClient());
    // Normalize module-scope robot state for deterministic assertions.
    await client.callTool({ name: "reset", arguments: {} });
  });

  it("tools/list exposes all 5 robot tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  it("look returns structuredContent with world, robot, and view", async () => {
    const res = await client.callTool({ name: "look", arguments: {} });
    const sc = res.structuredContent as
      | { world?: unknown; robot?: unknown; view?: unknown }
      | undefined;
    expect(sc).toBeDefined();
    expect(sc!.world).toBeDefined();
    expect(sc!.robot).toBeDefined();
    expect(sc!.view).toBeDefined();

    const robot = sc!.robot as { x: number; y: number; dir: string };
    expect(robot).toMatchObject({ x: 1, y: 1, dir: "N" });

    const world = sc!.world as { width: number; height: number; cells: unknown[][] };
    expect(world.width).toBe(7);
    expect(world.height).toBe(7);
    expect(world.cells.length).toBe(7);

    const view = sc!.view as { columns: unknown[] };
    expect(Array.isArray(view.columns)).toBe(true);
    expect(view.columns.length).toBeGreaterThan(0);
  });

  it("turn_left then move_forward updates pose consistently in structuredContent", async () => {
    await client.callTool({ name: "reset", arguments: {} });
    // From (1,1,N): turn_left -> facing W -> (0,1) is wall -> no move.
    // Instead turn_left from N goes to W; to get a real move, turn_left twice
    // would face S? N->W->S. From (1,1) facing S -> (1,2) is empty -> moves.
    await client.callTool({ name: "turn_left", arguments: {} }); // N -> W
    const afterTurn = await client.callTool({ name: "turn_left", arguments: {} }); // W -> S
    const scTurn = afterTurn.structuredContent as { robot: { dir: string } };
    expect(scTurn.robot.dir).toBe("S");

    const afterMove = await client.callTool({ name: "move_forward", arguments: {} });
    const scMove = afterMove.structuredContent as {
      robot: { x: number; y: number; dir: string };
    };
    // (1,1) facing S -> (1,2), still empty interior cell.
    expect(scMove.robot).toMatchObject({ x: 1, y: 2, dir: "S" });
  });

  it("reset restores the initial pose in structuredContent", async () => {
    await client.callTool({ name: "turn_right", arguments: {} });
    const res = await client.callTool({ name: "reset", arguments: {} });
    const sc = res.structuredContent as { robot: { x: number; y: number; dir: string } };
    expect(sc.robot).toMatchObject({ x: 1, y: 1, dir: "N" });
  });
});
