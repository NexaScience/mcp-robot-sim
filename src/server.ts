import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  createInitialState,
  moveForward,
  turnLeft,
  turnRight,
  reset,
  castView,
  type SimState,
} from "./sim.js";

// --- Module-scope state ----------------------------------------------------
// src/index.ts runs in STATELESS Streamable HTTP mode and calls getServer()
// once per POST. The robot must persist across requests, so its state lives at
// MODULE scope (NOT inside getServer()); otherwise every call would reset it.
// Identical rationale to the mcp-research foundation.
let state: SimState = createInitialState();

const UI_RESOURCE_URI = "ui://robot/view.html";

// structuredContent payload returned by every robot tool (DESIGN §4.2).
const result = (s: SimState): CallToolResult => {
  const view = castView(s);
  const { x, y, dir } = s.robot;
  return {
    content: [
      {
        type: "text",
        text: `Robot at (${x}, ${y}) facing ${dir}. ` +
          `Center view: ${view.columns[Math.floor(view.columns.length / 2)]?.hit ?? "?"} ` +
          `at distance ${view.columns[Math.floor(view.columns.length / 2)]?.distance ?? "?"}.`,
      },
    ],
    structuredContent: {
      world: s.world,
      robot: s.robot,
      view,
    } as unknown as Record<string, unknown>,
  };
};

// HTML-escape for any server-rendered text (XSS-safe fallback for non-UI hosts).
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;"
      : c === "<" ? "&lt;"
      : c === ">" ? "&gt;"
      : c === '"' ? "&quot;"
      : "&#39;",
  );

// Server-render the robot widget: a first-person pseudo-3D <canvas> view plus a
// small top-down minimap, with inline vanilla JS only (no imports / no CDN —
// claude.ai CSP-safe). The widget renders from the PUSHED tool-result
// structuredContent ({ world, robot, view }); buttons drive the robot live via
// tools/call and re-draw from the returned structuredContent.
//
// FOOTGUN: the browser JS lives inside this backtick template. Any backtick or
// `${` that must reach the browser VERBATIM is escaped as \` and \${.
const renderViewHtml = (): string => {
  const initialPose = escapeHtml(
    `(${state.robot.x}, ${state.robot.y}) facing ${state.robot.dir}`,
  );
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Robot Simulator</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 8px; }
  #stage { position: relative; width: 100%; max-width: 400px; margin: 0 auto; }
  #view { display: block; width: 100%; aspect-ratio: 16 / 9; background: #111; border-radius: 10px; }
  #minimap { position: absolute; right: 8px; bottom: 8px; width: 96px; height: 96px; border: 1px solid rgba(255,255,255,0.4); border-radius: 6px; background: rgba(0,0,0,0.35); }
  #pose { text-align: center; color: #888; font-size: 0.8rem; margin: 6px 0 2px; }
  #controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; max-width: 400px; margin: 6px auto 0; }
  #controls button { padding: 8px 6px; border: 1px solid #c8c8c8; border-radius: 8px; background: rgba(127,127,127,0.08); cursor: pointer; font: inherit; font-size: 1rem; }
  #controls button:hover { background: rgba(127,127,127,0.18); border-color: #888; }
  #controls button:disabled { opacity: 0.5; cursor: default; }
  #btn-forward { grid-column: 2; }
  #btn-left { grid-column: 1; grid-row: 2; }
  #btn-reset { grid-column: 2; grid-row: 2; }
  #btn-right { grid-column: 3; grid-row: 2; }
  #status { text-align: center; color: #2e7d32; font-size: 0.78rem; margin-top: 6px; min-height: 1em; }
</style>
</head>
<body>
  <div id="stage">
    <canvas id="view" width="480" height="270"></canvas>
    <canvas id="minimap" width="96" height="96"></canvas>
  </div>
  <div id="pose">Robot ${initialPose}</div>
  <div id="controls">
    <button id="btn-forward" type="button" title="前進">↑ 前進</button>
    <button id="btn-left" type="button" title="左回転">⟲ 左</button>
    <button id="btn-reset" type="button" title="リセット">⟳ リセット</button>
    <button id="btn-right" type="button" title="右回転">⟳ 右</button>
  </div>
  <div id="status"></div>
  <script>
  (function () {
    "use strict";
    // SEP-1865 MCP Apps view<->host postMessage JSON-RPC bridge. Everything
    // below runs in the browser (sandboxed iframe): INLINE vanilla JS, NO
    // imports / NO external scripts (claude.ai CSP-safe). The authoritative
    // render comes from the PUSHED ui/notifications/tool-result; button clicks
    // drive the robot via tools/call and re-draw from the returned result.
    try {
      var nextId = 1;
      var pending = new Map();

      function post(msg) { window.parent.postMessage(msg, "*"); }

      function request(method, params) {
        return new Promise(function (resolve, reject) {
          var id = nextId++;
          pending.set(id, { resolve: resolve, reject: reject });
          post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
        });
      }

      function notify(method, params) {
        post({ jsonrpc: "2.0", method: method, params: params || {} });
      }

      // SEP-1865 sizing: tell the host the widget's natural height so it fits
      // inline WITHOUT a scrollbar (the canvas + controls below it must be fully
      // visible). Mirrors ext-apps' setupSizeChangedNotifications: temporarily
      // set documentElement height to "max-content" to measure the true content
      // height, then emit ui/notifications/size-changed { width, height } in px.
      function sendSize() {
        var el = document.documentElement;
        var prev = el.style.height;
        el.style.height = "max-content";
        var h = Math.ceil(el.getBoundingClientRect().height);
        el.style.height = prev;
        notify("ui/notifications/size-changed", {
          width: Math.ceil(window.innerWidth),
          height: h,
        });
      }

      // Debounce size emission to once per animation frame so the burst of
      // ResizeObserver callbacks during layout/canvas sizing collapses into a
      // single notification per frame.
      var sizePending = false;
      function scheduleSize() {
        if (sizePending) return;
        sizePending = true;
        requestAnimationFrame(function () {
          sizePending = false;
          sendSize();
        });
      }

      window.addEventListener("message", function (e) {
        var msg = e.data;
        if (!msg || msg.jsonrpc !== "2.0") return;
        if (msg.id != null && pending.has(msg.id)) {
          var p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error((msg.error && msg.error.message) || "RPC error"));
          else p.resolve(msg.result);
          return;
        }
        // PRIMARY data source: host pushes the spawning tool call's RESULT to
        // THIS widget instance. params.structuredContent = { world, robot, view }
        // bound to this exact call — NO shared server state, correct under
        // horizontal scaling. May arrive before OR after the handshake.
        if (msg.method === "ui/notifications/tool-result") {
          var sc = msg.params && msg.params.structuredContent;
          if (sc && sc.view && sc.world && sc.robot) draw(sc);
          return;
        }
      });

      function callTool(name, args) {
        return request("tools/call", { name: name, arguments: args || {} });
      }

      var statusEl = document.getElementById("status");
      function setStatus(s) { if (statusEl) statusEl.textContent = s; }
      var poseEl = document.getElementById("pose");

      var DIR_LABEL = { N: "北", E: "東", S: "南", W: "西" };

      // Map a hit color to an RGB base for wall slices.
      function baseColor(col) {
        switch (col.color) {
          case "red": return [210, 70, 70];
          case "green": return [70, 180, 90];
          case "blue": return [80, 110, 220];
          case "yellow": return [220, 200, 70];
          default: return [150, 150, 160]; // wall (grey)
        }
      }

      // Shade an RGB triple by a 0..1 factor (distance attenuation).
      function shade(rgb, factor) {
        var r = Math.round(rgb[0] * factor);
        var g = Math.round(rgb[1] * factor);
        var b = Math.round(rgb[2] * factor);
        return "rgb(" + r + "," + g + "," + b + ")";
      }

      // Render the first-person pseudo-3D view (Wolfenstein-style raycast
      // columns) + the top-down minimap from { world, robot, view }.
      function draw(sc) {
        var view = sc.view, world = sc.world, robot = sc.robot;
        if (poseEl) {
          poseEl.textContent = "Robot (" + robot.x + ", " + robot.y + ") facing " +
            (DIR_LABEL[robot.dir] || robot.dir);
        }
        drawFirstPerson(view);
        drawMinimap(world, robot);
        enableControls();
        // Content (canvas + controls) is now laid out — re-report height.
        scheduleSize();
      }

      function drawFirstPerson(view) {
        var canvas = document.getElementById("view");
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext("2d");
        var W = canvas.width, H = canvas.height;
        // Sky / ceiling.
        ctx.fillStyle = "#2b3a55";
        ctx.fillRect(0, 0, W, H / 2);
        // Floor.
        ctx.fillStyle = "#3a3530";
        ctx.fillRect(0, H / 2, W, H / 2);

        var cols = (view && view.columns) || [];
        if (cols.length === 0) return;
        var colW = W / cols.length;
        for (var i = 0; i < cols.length; i++) {
          var c = cols[i];
          var dist = Math.max(1, c.distance);
          // Wall slice height scales with 1/distance.
          var sliceH = Math.min(H, (H * 0.9) / dist);
          var top = (H - sliceH) / 2;
          // Distance attenuation: closer = brighter.
          var factor = Math.max(0.25, 1 - (dist - 1) * 0.16);
          ctx.fillStyle = shade(baseColor(c), factor);
          ctx.fillRect(Math.floor(i * colW), top, Math.ceil(colW) + 1, sliceH);
        }
      }

      function drawMinimap(world, robot) {
        var canvas = document.getElementById("minimap");
        if (!canvas || !canvas.getContext || !world || !world.cells) return;
        var ctx = canvas.getContext("2d");
        var W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        var n = world.width;
        var cs = W / n;
        for (var y = 0; y < world.cells.length; y++) {
          for (var x = 0; x < world.cells[y].length; x++) {
            var cell = world.cells[y][x];
            var color = "rgba(255,255,255,0.06)"; // empty
            if (cell.kind === "wall") color = "#666";
            else if (cell.kind === "block") {
              color = cell.color === "red" ? "#d24646"
                : cell.color === "green" ? "#46b45a"
                : cell.color === "blue" ? "#506edc"
                : cell.color === "yellow" ? "#dcc846" : "#999";
            }
            ctx.fillStyle = color;
            ctx.fillRect(x * cs + 0.5, y * cs + 0.5, cs - 1, cs - 1);
          }
        }
        // Robot marker (a triangle pointing along dir).
        var cx = robot.x * cs + cs / 2;
        var cy = robot.y * cs + cs / 2;
        var d = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[robot.dir] || [0, -1];
        var perp = [-d[1], d[0]];
        var r = cs * 0.45;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(cx + d[0] * r, cy + d[1] * r);
        ctx.lineTo(cx + perp[0] * r * 0.7 - d[0] * r * 0.5, cy + perp[1] * r * 0.7 - d[1] * r * 0.5);
        ctx.lineTo(cx - perp[0] * r * 0.7 - d[0] * r * 0.5, cy - perp[1] * r * 0.7 - d[1] * r * 0.5);
        ctx.closePath();
        ctx.fill();
      }

      var controls = [
        ["btn-forward", "move_forward"],
        ["btn-left", "turn_left"],
        ["btn-right", "turn_right"],
        ["btn-reset", "reset"],
      ];

      function setControlsDisabled(disabled) {
        for (var i = 0; i < controls.length; i++) {
          var el = document.getElementById(controls[i][0]);
          if (el) el.disabled = disabled;
        }
      }
      function enableControls() { setControlsDisabled(false); }

      function wireControls() {
        for (var i = 0; i < controls.length; i++) {
          (function (id, tool) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener("click", function () {
              setControlsDisabled(true);
              setStatus("");
              callTool(tool, {}).then(function (res) {
                var sc = res && res.structuredContent;
                if (sc && sc.view && sc.world && sc.robot) draw(sc);
                else enableControls();
              }).catch(function () {
                setStatus("操作に失敗しました。");
                enableControls();
              });
            });
          })(controls[i][0], controls[i][1]);
        }
      }

      wireControls();

      // Handshake. The authoritative render comes from the pushed
      // ui/notifications/tool-result (handled above). If none arrives, fall back
      // to an explicit look call so the widget still paints.
      request("ui/initialize", {
        protocolVersion: "2026-01-26",
        // claude.ai's host expects appInfo here (NOT clientInfo); sending
        // clientInfo fails ui/initialize with params.appInfo invalid_type.
        appInfo: { name: "robot-sim-widget", version: "1.0.0" },
        capabilities: {},
        appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
      }).then(function () {
        notify("ui/notifications/initialized", {});
        // Report initial height immediately so the host sizes the inline frame
        // before the first paint (avoids a transient scrollbar on open).
        sendSize();
        // Continuously keep the host's frame height in sync with the content
        // (canvas reflow on resize, theme/font changes, etc.). Debounced to one
        // emission per animation frame.
        if (typeof ResizeObserver === "function") {
          var ro = new ResizeObserver(function () { scheduleSize(); });
          ro.observe(document.documentElement);
          ro.observe(document.body);
        }
        // Fallback paint if no tool-result was pushed.
        return callTool("look", {}).then(function (res) {
          var sc = res && res.structuredContent;
          if (sc && sc.view && sc.world && sc.robot) draw(sc);
        });
      }).catch(function () {
        // No host / non-supporting client: controls remain wired but inert.
      });
    } catch (err) {
      // Never throw uncaught.
    }
  })();
  </script>
</body>
</html>`;
};

// zod shapes for input ({}) and output ({ world, robot, view }).
const emptyInput = {} as const;

const cellSchema = z.union([
  z.object({ kind: z.literal("empty") }),
  z.object({ kind: z.literal("wall") }),
  z.object({
    kind: z.literal("block"),
    color: z.enum(["red", "green", "blue", "yellow"]),
  }),
]);

const robotToolOutput = {
  world: z.object({
    width: z.number(),
    height: z.number(),
    cells: z.array(z.array(cellSchema)),
  }),
  robot: z.object({
    x: z.number(),
    y: z.number(),
    dir: z.enum(["N", "E", "S", "W"]),
  }),
  view: z.object({
    columns: z.array(
      z.object({
        distance: z.number(),
        hit: z.enum(["wall", "block"]),
        color: z.enum(["wall", "red", "green", "blue", "yellow"]),
      }),
    ),
  }),
};

export const getServer = (): McpServer => {
  const server = new McpServer(
    { name: "mcp-robot-sim-server", version: "1.0.0" },
    { capabilities: {} },
  );

  const uiMeta = { ui: { resourceUri: UI_RESOURCE_URI } };

  // look: read-only — returns the current pose and first-person view.
  registerAppTool(
    server,
    "look",
    {
      title: "Look",
      description:
        "Returns the robot's current first-person pseudo-3D view and full world " +
        "state, and renders the interactive robot widget. Does not move the robot.",
      inputSchema: emptyInput,
      outputSchema: robotToolOutput,
      _meta: uiMeta,
    },
    async (): Promise<CallToolResult> => result(state),
  );

  // move_forward: advance one cell along the robot's facing (collision => no-op).
  registerAppTool(
    server,
    "move_forward",
    {
      title: "Move Forward",
      description:
        "Moves the robot one cell forward in its current facing direction. If a " +
        "wall or colored block is directly ahead, the robot stays in place.",
      inputSchema: emptyInput,
      outputSchema: robotToolOutput,
      _meta: uiMeta,
    },
    async (): Promise<CallToolResult> => {
      state = moveForward(state);
      return result(state);
    },
  );

  // turn_left: rotate 90° counter-clockwise (N->W->S->E->N).
  registerAppTool(
    server,
    "turn_left",
    {
      title: "Turn Left",
      description: "Rotates the robot 90° counter-clockwise. Position unchanged.",
      inputSchema: emptyInput,
      outputSchema: robotToolOutput,
      _meta: uiMeta,
    },
    async (): Promise<CallToolResult> => {
      state = turnLeft(state);
      return result(state);
    },
  );

  // turn_right: rotate 90° clockwise (N->E->S->W->N).
  registerAppTool(
    server,
    "turn_right",
    {
      title: "Turn Right",
      description: "Rotates the robot 90° clockwise. Position unchanged.",
      inputSchema: emptyInput,
      outputSchema: robotToolOutput,
      _meta: uiMeta,
    },
    async (): Promise<CallToolResult> => {
      state = turnRight(state);
      return result(state);
    },
  );

  // reset: restore the robot to its initial pose and world.
  registerAppTool(
    server,
    "reset",
    {
      title: "Reset",
      description: "Resets the robot to its initial position and facing.",
      inputSchema: emptyInput,
      outputSchema: robotToolOutput,
      _meta: uiMeta,
    },
    async (): Promise<CallToolResult> => {
      state = reset();
      return result(state);
    },
  );

  registerAppResource(
    server,
    "Robot Simulator UI",
    UI_RESOURCE_URI,
    { description: "Interactive first-person pseudo-3D view of the robot world" },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: renderViewHtml(),
        },
      ],
    }),
  );

  return server;
};
