# Remote Scene Inspector Implementation Plan

> **For Codex:** Implement and verify the following steps in this session.

**Goal:** Make the running UI hierarchy readable in VS Code and outline a selected node in the running game.

**Architecture:** Extend the existing debug SceneTreeProvider rather than introducing another tree. Refresh the remote scene tree while its view is visible, preserve identity by object ID, and retain ancestors when filtering by name, class or path. Use Godot's native RuntimeNodeSelect debugger messages for outlines on Godot 4.4+, leaving input picking disabled. Keep remote inspector requests separate from breakpoint-scoped variable caches so inspection also works while the game runs.

**Tech Stack:** TypeScript, VS Code TreeView API, Godot remote debugger protocol, Mocha/Sinon, Godot 4.6.2 integration fixture.

## Decisions

- Reuse the existing remote tree and native runtime selection. Alternative: inject an overlay/autoload into projects; rejected because it changes projects and duplicates engine geometry handling. Alternative: implement only a static scene preview; insufficient for dynamically instantiated UI.
- Keep the entire runtime hierarchy, including UI, CanvasLayers and their structural ancestors. Search narrows it without guessing inheritance from custom class names.
- Support trees/inspection on existing Godot versions; gate native highlighting to 4.4+. For 4.4 inspect_object selects the node, whereas 4.5+ requires inspect_objects with update_selection=true.
- Preserve the existing breakpoint VariablesManager and provide independently timed remote inspection requests. Ignore stale selections and cancel pending requests on disconnect.
- Use the current clean checkout; do not change the Godot engine or game projects to enable the feature.
- User clarification: Godot 3 is required for Brotato_recovered. Provide tree/search/inspection on Godot 3; omit outlines there, as explicitly requested when native selection is unavailable. Smoke-test the existing project without changing its files.
- Integration finding: the configured Godot 3 executable speaks the custom two-channel v2 protocol. The existing GodParty implementation lives in GodotTools-debug-v2, so port the shared UI there and extend its existing v2 controllers with connection state, initial snapshots and coalesced refreshes. Preserve both existing v2 adapters and the fork identity. Standard Godot 4 connections provide native outlines; custom v2 connections expose tree/inspection only.

## Validation results

- TypeScript compilation and lint for the changed UI/request/test modules passed.
- 16 remote scene/request/protocol tests passed, including Godot 4.6.2 runtime UI mutation and Godot 3 v2 live inspection.
- A separate real VS Code session against Brotato_recovered passed: 110 running nodes, /root/Pause/ColorRect inspected without a breakpoint, termination cleared the tree.
- 18 existing Godot 3/4 v2 protocol and session-state tests passed.
- All 8 existing Godot 4 DAP variable-scope integration tests passed.
- Both existing Godot 3 v2 stepping integration tests passed, including 100 acknowledged steps.
- Existing limitation: the Godot 4 custom v2 integration test completes its paging/20-step phase but fails its later breakpoint continuation with "No debugger available" after the game exits. Re-running with the HEAD version of the Godot 4 v2 controller reproduces the failure. This is separate from the tested Godot 3/Brotato workflow and standard Godot 4 runtime inspection.
- The Brotato checkout retained its pre-existing changes; no project code/configuration was edited for this feature.

## Task 1: Runtime tree interaction

Modify src/debugger/scene_tree_provider.ts and package.json. Add stable IDs, parent/path indexing, useful tooltips and hidden-node indicators. Add search/clear-search, copy-path and highlight controls. Click nodes to inspect them. Validate filtering, retained ancestor branches, stable IDs, parent lookup and visibility flags with src/debugger/scene_tree_provider.test.ts.

## Task 2: Runtime inspection and outlines

Create src/debugger/godot4/remote_inspector.ts and its tests. Implement request coalescing, object decoding, timeout/disconnect rejection. Update src/debugger/godot4/server_controller.ts to service runtime requests independently of stopped-stack variables, initialize native selection with input picking disabled, and select/clear nodes using version-specific commands. Verify protocol payloads for 4.3, 4.4 and 4.5+.

## Task 3: Connection lifecycle

Update src/debugger/debugger.ts and controllers. Request trees after connection, poll only while the view is visible (configurable interval, 0 disables polling), and stop on termination. Inspect clicked nodes while running; prevent delayed responses from replacing a newer selection. Reject removed nodes gracefully. Preserve Godot 3 behavior.

## Task 4: End-to-end validation and documentation

Add a UI fixture with nested controls and runtime-created/removed controls under test_projects/test-dap-project-godot4. Verify initial loading without a breakpoint, search, inspection during execution, selection protocol, refresh after mutation and disconnect cleanup. Run npm run compile, targeted Mocha/VS Code tests, existing DAP regression tests, and npm run esbuild. Document usage and version limits in README.md. Package a VSIX for local installation if validation succeeds.

## Acceptance

- A running debug session exposes the actual node tree without needing a breakpoint.
- Searching a control name/type/path keeps its hierarchy understandable.
- Clicking a node populates Inspector while running and outlines supported visible CanvasItems on Godot 4.4+.
- Highlighting can be disabled or cleared without intercepting game input.
- Refresh preserves expansion; disconnect clears stale UI and cancels timers/requests.
- No project autoload or engine fork is required.
