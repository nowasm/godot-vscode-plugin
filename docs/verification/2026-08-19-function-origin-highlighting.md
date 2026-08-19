# Function Origin Highlighting Verification — 2026-08-19

## Environment

- Windows, VS Code `1.133.0` (`a5b500951314efd502d07465bd138dfbd714a960`)
- Godot `4.6.2-stable`
- Godot executable:
  `D:\work_mine\godparty\GodotEditor\Godot_v4.6.2-stable_win64.exe`
- Extension branch: `codex/function-origin-highlighting`
- Package identity: `godparty.godparty-godot-tools@0.1.0`

## Automated verification

Dependencies were installed with the public npm registry because the configured
mirror did not contain every required development package:

```powershell
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
```

The following checks passed:

```powershell
npm run compile
npm run lint
npx mocha --ui tdd "out/utils/extension_identity.test.js" "out/function_highlighting/*.test.js"
npm run test:local
npm run test:function-highlighting:vscode
npm run test:function-highlighting:godparty
npm run esbuild
npm run package
npx vsce ls --tree
```

Results:

- TypeScript compile: pass.
- Biome lint: pass with zero errors; 12 pre-existing upstream
  `noParameterAssign` warnings remain.
- Function-highlighting pure tests: scanner, API cache/fallback, project index,
  classifier, LSP timeout/staleness, manifest, status, and integration fixture pass.
- Complete local VS Code suite: `99 passing`, including upstream formatter
  snapshots and real Godot DAP variable tests.
- Isolated function-highlighting Extension Host suite: `3 passing`.
- GodParty production-workspace smoke suite: `1 passing`.
- VSIX package install into an isolated extensions directory: pass; VS Code lists
  `godparty.godparty-godot-tools@0.1.0`.

The upstream `npm test` launcher attempted to download another 325 MB VS Code
archive even though VS Code was already installed. `npm run test:local` uses the
installed VS Code executable through `@vscode/test-electron` and runs the same
compiled test files without that redundant download.

## Function-origin fixture

Workspace: `test_projects/function-highlighting`

Checked `system_and_project.gd` and `custom_node.gd` for:

- `_ready`, `range`, native `Node.add_child`, and constructors → Godot/system.
- `move_player` declaration/call → project/custom.
- typed `CustomNode.add_child` collision → project/custom.
- `TestManager.change_phase` → project Autoload.
- unresolved dynamic receiver → project/custom fallback.
- local `print` collision → project definition wins over the Godot utility name.

The VS Code host confirmed semantic tokens are emitted, hover text contains the
origin and evidence, and the workspace toggle disables and restores highlighting.
Default colors were verified as system cyan `#4FC3F7` and project gold `#FFD166`.

## GodParty production smoke

Workspace: `D:\work_mine\godparty\GodClient`

Representative file: `scenes/boot.gd`.

Observed classifications:

- `_ready` declaration → `native_virtual_override` (system).
- `preload` and `print` → system.
- `_should_open_font_compare` → project.
- `SceneTransition.change_scene` → `autoload_receiver` (project), including the
  real `.tscn` Autoload entry.

The production document emitted semantic tokens, and existing upstream commands
including `godotTools.openEditor` and `godotTools.debugger.debugCurrentFile`
remained registered. The smoke test only opened/read the project and did not
modify GodParty files.

## Packaged contents

`npx vsce ls --tree` confirmed the package contains:

- minified `out/extension.js`
- `resources/godot_api/godot-4.6.json`
- GDScript/GDResource/GDShader grammars
- README, UPSTREAM attribution, LICENSE, changelog, icon, and runtime resources

Source tests, test projects, development maps, and unrelated generated files are
excluded from the VSIX.

Final artifact:

- File: `godparty-godot-tools-0.1.0.vsix`
- Size: `915699` bytes
- SHA-256: `B5D1BA701475AD3D9F0B930B987E3A23173D6BBB4D9BE5A6809F63FDA3E1B2B9`

## Known classification boundary

When a dynamically typed receiver has no project-index or LSP evidence, the call
is intentionally classified as project/custom. This avoids falsely labeling
user and GDExtension APIs as Godot system APIs. A disconnected LSP now times out
after 750 ms instead of blocking semantic tokens indefinitely.
