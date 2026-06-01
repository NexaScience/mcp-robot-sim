# CURRENT_TASK

- task_id: robot-sim-mcp-001
- system_type: content_gen (toy MCP server)
- summary: シミュレーション空間のロボット一人称視点を MCP Apps ウィジェットに表示し、ロボットへ指示も出せるトイMCP
- goal: Alpic にデプロイ可能な TypeScript / Streamable HTTP の MCP サーバを作る。MCP Apps（SEP-1865）のインタラクティブウィジェットに、グリッド世界のロボット一人称疑似3Dビューを描画し、widget 内のボタンとエージェント経由の両方でロボットを操作できる。

## success_criteria（観測可能・テスト可能）
- `npm run build`（tsc）が成功し `dist/` を生成する。
- `npm test`（vitest）が全 green。純粋シミュレーション(sim)ロジックの単体テスト＋サーバ配線のスモークテストを含む。
- MCP サーバが Streamable HTTP `POST /mcp` で起動し、`initialize`→`tools/list` に応答する。
- ツール群: `look`（現在の一人称ビュー＋状態を返す）, `move_forward`, `turn_left`, `turn_right`, `reset`。各ツールは structuredContent に world+robot 状態を含めて返し、UI ウィジェット `ui://robot/view.html` に結びつく。
- ウィジェットは push された tool-result(structuredContent) からロボット一人称疑似3Dビューを `<canvas>` 描画する。`ui/initialize` は **appInfo**（clientInfo ではない）で握手。inline JS のみ（CDN/外部import禁止、CSP準拠）。
- ウィジェット内ボタン（前進 / 左回転 / 右回転 / リセット）でロボットをその場で操作できる（live）。
- Alpic に REST API でデプロイし `*.alpic.live/mcp` で MCP 応答を確認する。

## scenarios
1. エージェントが `look` を呼ぶ → ウィジェットが出て一人称ビューが表示される。
2. ユーザがウィジェットの「前進」を押す → ロボットが1マス前進し、壁/障害物があれば停止。ビューが即時更新。
3. エージェントが `turn_left`→`move_forward` を順に呼ぶ → 向きと位置が更新され、structuredContent と描画が一致。
4. `reset` でロボットが初期位置・初期向きに戻る。

## allowed_paths
- /Users/kumacmini/mcp-robot-sim/**（新規リポジトリ。NexaScience/mcp-robot-sim として公開予定）

## out_of_scope
- 物理エンジン、連続値の関節制御、複数ロボット、永続DB。
- 認証・マルチユーザ。状態は module-scope（トイ。Alpic マルチレプリカ間の厳密整合は非目標。ウィジェットは pushed result から描画して整合を担保）。

## 設計メモ（参照: NexaScience/mcp-research を土台に流用）
- 世界 = 固定グリッド（例 7×7、外周は壁）。数個の色付き障害物ブロックを配置。
- ロボット自由度 = 位置(セル) + 向き(N/E/S/W) のみ。move_forward は1マス、turn は90°。衝突時は移動しない。
- 一人称ビュー = グリッド上のレイキャスト風疑似3D（Wolfenstein風）。canvas にinline JSで描画。距離で壁を陰影付け、障害物は色で表現。任意で小さなトップダウンのミニマップを併記。
- sim ロジックは純粋関数として `src/sim.ts` に分離し単体テスト可能にする。
- transport/handshake/postMessageブリッジ/appInfo/「pushed tool-resultから描画」は mcp-research の作法を踏襲。
