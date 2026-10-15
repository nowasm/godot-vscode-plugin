# Inspector toggle and runtime visibility verification — 2026-10-15

GodParty Godot Tools 0.1.9, on `codex/godot4-debug-protocol-v2`.

## Checks

- TypeScript compilation and Biome lint for all changed TypeScript files passed.
- Targeted VS Code 1.96.4 extension-host suite: **42 passed**, one optional Brotato workspace test skipped because this suite runs in the Godot 4 fixture workspace. A separate real Brotato VS Code-session/UI test passed below.
- The toggle tests opened/closed both columns, retained a dirty source buffer, reclaimed the original group count with `workbench.editor.closeEmptyGroups = false`, remembered the disabled choice, and serialized rapid toggles. The standard Godot 4 integration launched a second debug session to verify the columns stayed closed.
- Visibility tests covered real local state under hidden parents, coalesced clicks, unsupported/non-boolean property data, a game rejecting the requested state, no writes after session changes, and rejection of root/plain/removed nodes. Godot 3 cached state survives tree refreshes and clears between sessions; fresh Godot 4 flags supersede cached confirmations.
- Standard Godot 4.6.2: hid/showed a Button and its Panel ancestor, toggled a locally visible child under a hidden ancestor without showing the ancestor, retained Inspector selection, and verified property readback.
- Custom Godot 4 protocol v2: hid/showed a real Button and verified readback through acknowledged writes.
- Custom Godot 3.6.3 protocol v2: hid/showed a Label and Control parent, preserved the parent's hidden state when toggling its child, and showed the Label while paused before resuming. Existing nested-object, freed-object and native-outline tests passed.

The isolated extension host emits the existing editor language-client startup/stop diagnostics when no matching LSP is available. Debugger assertions and the runner completed successfully.

## Brotato rendered controls

Used `D:\work_open\aistudy\Brotato_recovered\gdproj` with the existing `D:\devlib\godot\godot-debug-v2\bin\godot.windows.opt.tools.64.exe` in an isolated VS Code test window. No engine rebuild or project source/configuration edits were required.

- Debug launch with the workspace toggle off kept the columns closed.
- Opened both columns and inspected `/root/TitleScreen` in the 2,079-node live scene.
- Clicked the rendered eye button twice; verified hidden and visible states, completed requests, and preserved the selected path.
- Clicked the Inspector's Hide-both button; verified `Godot UI: Off` and one source editor group.
- Clicked the rendered status-bar entry; verified `Godot UI: On`, three editor groups, and the retained TitleScreen Inspector.
- Confirmed the native `visible` property was restored to true, closed the columns, and stopped the test session.
- Visual check screenshot: `.vscode-test/toggle-visibility.png` (local ignored test artifact).

## Delivery

- Packaged and installed `godparty-godot-tools-0.1.9.vsix`; installed manifest reports version 0.1.9.
- VSIX SHA-256: `5FB81E73B9E3A67A7838185847517AAA4D315A69D3996B07CEDA4AC91AE3E63E`.
- Installed extension bundle, Inspector webview JavaScript and CSS hashes match the packaged build.
- The master checkout and custom Godot 3 engine checkout remain clean.
- Reload VS Code and restart debugging to activate the new extension host. Runtime visibility changes affect the live instance, not scene files.
