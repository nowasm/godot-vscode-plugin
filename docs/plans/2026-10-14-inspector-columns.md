# Inspector Columns Implementation Plan

> **For Codex:** Implement and verify the following steps in this session.

**Goal:** Give the runtime scene tree and selected node properties their own full-height columns next to the debug sidebar.

**Architecture:** Two reusable WebviewPanels share the existing scene and inspector providers and debugger commands. Insert editor groups before the existing source group without closing or moving its tabs. Keep the native sidebar views as a fallback, and refresh the scene while either tree presentation is visible.

**Tech Stack:** TypeScript, VS Code editor groups and WebviewPanel API, theme-aware HTML/CSS/JavaScript, Mocha in a real VS Code extension host.

## Decisions

- Native TreeViews cannot become editor tabs. Moving them to a separate activity-bar container still stacks them vertically; using the secondary sidebar adds only one column. Two editor webviews provide the requested layout: Debug | Scene Tree | Node Properties | Code.
- Add an explicit open command and enable automatic opening on Godot debug-session start, configurable with `godotTools.debugger.openInspectorColumnsOnStart`.
- Keep the original providers authoritative. Resolve incoming node/property IDs against the current model before invoking inspection or editing; never accept arbitrary command names or HTML from the game.
- Preserve expanded branches, selection, scroll and keyboard navigation across refreshes. Use VS Code theme colors and fonts and a compact, utilitarian hierarchy/table layout.
- Reopening reuses panels; closing one can recreate it beside its sibling. Leave open source tabs and their unsaved buffers intact. Session termination clears stale data in both panels.

## Tasks

1. Create `src/debugger/inspector_columns.ts` for panel lifecycle, safe snapshots and message handling; add static webview assets under `media/remote-inspector/`.
2. Update `src/debugger/debugger.ts` to register open/close commands, auto-open on debug start, synchronize selection, and refresh while the new scene panel is visible. Add manifest commands/settings and conditional sidebar fallback.
3. Add extension-host tests for layout insertion with an unsaved source tab, repeated/partial reopen, visible-panel refresh, tree filtering, selection/property updates, stale IDs, and disconnect cleanup. Exercise Brotato Godot 3 v2 with the panels visible and the sidebar hidden.
4. Compile, lint changed modules, run targeted regressions, build/package version 0.1.6, validate package assets, and install it in the user's VS Code. Keep all source work in `codex/godot4-debug-protocol-v2`; `master` stays clean.

## References

- https://code.visualstudio.com/api/extension-guides/webview
- https://code.visualstudio.com/api/references/commands

## Validation

- TypeScript compilation, JavaScript syntax checking and lint for changed modules passed.
- Extension-host layout tests preserve an unsaved source buffer, insert two distinct columns, reuse them on repeated opens, recreate a closed sibling, and keep ordinary source navigation out of the locked inspector groups.
- Model/message tests cover shared scene filtering, current node/property resolution, edits, stale IDs and session cleanup.
- Real Brotato Godot 3 v2 session: 2079 runtime nodes; selected /root/TitleScreen. Browser DOM checks in the isolated VS Code test window verified that both webviews load, clicking a node updates the Inspector, property filtering works, and collapsed branches survive automatic refresh. A screenshot was reviewed.
- Final targeted regression run: 19 passed, one opt-in Godot 3 VS Code test skipped in the Godot 4 test workspace (covered separately by the Brotato validation above). Godot 4 live inspection and runtime mutation refresh pass with the debug sidebar hidden.
- The existing language-server startup/reconnect warnings also appear in the isolated test window; debugger/column tests pass. The unrelated Godot 4 manual-pause/breakpoint smoke attempt was not added to the suite: its source-stop behavior was inconsistent in the headless fixture, outside the column lifecycle checks.
- Packaged GodParty Godot Tools 0.1.6; verified the bundled extension and both webview assets in the VSIX and installed extension. Installed 0.1.6 through the user's VS Code CLI. The current window must reload to activate it. VSIX SHA256: `439A65E9D77333D803540FA9FB2A1613D36F9921C35433D5226F00A0E03BFF97`.
