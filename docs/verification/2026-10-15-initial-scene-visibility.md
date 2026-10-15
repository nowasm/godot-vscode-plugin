# Initial scene visibility verification — 2026-10-15

Delivered GodParty Godot Tools **0.1.10** with the custom Godot 3 engine's optional snapshot visibility metadata. The initial bug was caused by representing missing visibility as an open eye and retaining only explicit Inspector confirmations.

## Checks

- TypeScript compilation, changed-file Biome lint, webview JavaScript syntax and Git whitespace checks passed.
- Targeted VS Code 1.96.4 extension-host suite: **46 passed**, one optional Brotato workspace test skipped in the Godot 4 fixture workspace. Separate Brotato rendered-UI test passed.
- Coverage includes optional Godot 3 metadata parsing, full-precision IDs, old/malformed snapshots, initial hidden/inherited/visible states, independent CanvasLayers and Windows, and existing Inspector, toggle, visibility-write and native-highlight functionality.
- Real custom Godot 3 fixture: initial states are correct without Inspector requests; game-script visibility changes are picked up on subsequent snapshots. Hidden parent and CanvasLayer descendants, top-level CanvasItems, Spatial inheritance and paused property changes all passed.
- Standard Godot 4 and custom Godot 4 v2 integration remained passing.
- Complete custom Godot 3 debugger regression: **14 gates passed**, including the custom editor and 100-step VS Code DAP test. Engine report: `D:\devlib\godot\godot-debug-v2\bin\scene-visibility-integration.json`.

## Brotato evidence

Used the recovered project without editing project source/configuration. The initial snapshot covered 2,079 nodes and reported 1,839 effectively hidden nodes in the captured state. Before any inspection/click on the test nodes, the rendered tree correctly showed:

- `.../AbyssalTerrorsTitleScreenBackground/Logo`: own visibility false, effective visibility false, closed eye and hidden row.
- `.../Logo/TextureRect`: own visibility true, effective visibility false, closed eye and **hidden by ancestor** description.

Native object inspection afterward confirmed those local values, independently of the snapshot display. No unknown-eye markers appeared with the new engine. Screenshot: `.vscode-test/initial-visibility.png` (local ignored test artifact).

## Installed artifacts

- `D:\devlib\godot\godot-debug-v2\bin\godot.windows.opt.tools.64.exe`: `3.6.3.stable.custom_build.6fbcb49b7`, SHA-256 `86283E96CBFF66F322C03F401A89D5D88D341EAD92D01FA85B4E0B52D573361D`.
- Previous engine backup: `bin/backups/godot.windows.opt.tools.64.before-scene-visibility-20261015-114352.exe` in the engine checkout.
- `godparty-godot-tools-0.1.10.vsix` installed in the normal VS Code extensions directory. Manifest, extension bundle, webview JavaScript and CSS were verified against the build.
- VSIX SHA-256: `D246FF4E5464E8A275486D53C7F664091F5A2ED2DA667E2C3AF2DBD5EC4FCE5C`.
- Master checkout kept clean. Reload VS Code and restart debugging to use both updated components.
