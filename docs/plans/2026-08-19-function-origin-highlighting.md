# Function Origin Highlighting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a GodParty fork of Godot Tools that gives every detected GDScript function declaration and call a clear Godot-system or project-custom visual classification.

**Architecture:** Keep the upstream Godot Tools LSP/debugger stack and add a pure TypeScript analysis core for scanning, indexing, and classification. A VS Code integration service feeds cached Godot API data and project symbols into semantic tokens, decorations, hover text, commands, and status feedback, with safe fallback when Godot or the LSP is unavailable.

**Tech Stack:** TypeScript 5.9, VS Code Extension API 1.96, Godot 4.6 `extension_api.json`, `vscode-languageclient`, Mocha/Chai, Biome, esbuild, VSCE.

---

### Task 1: Establish the fork identity without breaking upstream features

**Files:**
- Modify: `package.json`
- Modify: `src/utils/vscode_utils.ts`
- Modify: `src/extension.ts`
- Create: `src/utils/extension_identity.ts`
- Create: `src/utils/extension_identity.test.ts`

**Step 1: Write the failing identity test**

Create a pure helper test that asserts the fork ID and compatibility namespaces:

```ts
import { strictEqual } from "node:assert";
import { EXTENSION_ID, HIGHLIGHT_CONFIG_PREFIX, UPSTREAM_COMMAND_PREFIX } from "./extension_identity";

suite("extension identity", () => {
	test("uses a fork ID while preserving upstream commands", () => {
		strictEqual(EXTENSION_ID, "godparty.godparty-godot-tools");
		strictEqual(HIGHLIGHT_CONFIG_PREFIX, "godpartyGodotTools.functionHighlight");
		strictEqual(UPSTREAM_COMMAND_PREFIX, "godotTools");
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `npm ci && npm run compile && npm test -- --grep "extension identity"`

Expected: compilation fails because `extension_identity.ts` does not exist.

**Step 3: Implement the fork identity**

Add the constants, rename the package to `godparty-godot-tools`, set display name to `GodParty Godot Tools`, publisher to `godparty`, and start the version at `0.1.0`. Preserve the existing `godotTools.*` command and configuration IDs so current workspace settings continue to work. Update `get_extension_uri()` to resolve `EXTENSION_ID` instead of the hard-coded upstream ID.

**Step 4: Run focused verification**

Run: `npm run compile && npm test -- --grep "extension identity"`

Expected: PASS; extension code compiles with the renamed ID.

**Step 5: Commit**

```bash
git add package.json src/utils/extension_identity.ts src/utils/extension_identity.test.ts src/utils/vscode_utils.ts src/extension.ts
git commit -m "chore: establish GodParty Godot Tools fork"
```

### Task 2: Build a GDScript function scanner

**Files:**
- Create: `src/function_highlighting/types.ts`
- Create: `src/function_highlighting/scanner.ts`
- Create: `src/function_highlighting/scanner.test.ts`
- Create: `src/function_highlighting/index.ts`

**Step 1: Write failing scanner tests**

Cover declarations, calls, receivers, multiline calls, comments, strings, annotations, lambdas, and exact offsets:

```ts
suite("GDScriptFunctionScanner", () => {
	test("finds declarations and calls but skips comments and strings", () => {
		const source = `
func _ready() -> void:
	print("move_player()")
	player.move_player(
		Vector2.ZERO
	)
	# queue_free()
`;
		const tokens = scanFunctions(source);
		deepStrictEqual(tokens.map(({ name, kind, receiver }) => ({ name, kind, receiver })), [
			{ name: "_ready", kind: "declaration", receiver: undefined },
			{ name: "print", kind: "call", receiver: undefined },
			{ name: "move_player", kind: "call", receiver: "player" },
		]);
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `npm run compile && npm test -- --grep "GDScriptFunctionScanner"`

Expected: FAIL because scanner exports are missing.

**Step 3: Implement the scanner**

Implement a single-pass lexer state machine for normal text, line comments, single/double/triple strings, and escaped characters. Emit immutable `FunctionToken` values containing name, kind, receiver text, start/end offsets, declaration modifiers, and enclosing function. Do not attempt origin classification in this module.

**Step 4: Expand edge-case tests**

Add fixtures for `static func`, typed return values, `Callable(self, "name")` exclusion, annotations, nested calls, `super.method()`, `$Node.method()`, `%Node.method()`, and identifiers adjacent to keywords.

**Step 5: Run tests**

Run: `npm run compile && npm test -- --grep "GDScriptFunctionScanner"`

Expected: all scanner cases PASS.

**Step 6: Commit**

```bash
git add src/function_highlighting
git commit -m "feat: scan GDScript function declarations and calls"
```

### Task 3: Parse and cache the exact Godot API

**Files:**
- Create: `src/function_highlighting/godot_api_index.ts`
- Create: `src/function_highlighting/godot_api_index.test.ts`
- Create: `src/function_highlighting/godot_api_loader.ts`
- Create: `src/function_highlighting/godot_api_loader.test.ts`
- Create: `tools/generate_godot_api_snapshot.ts`
- Create: `resources/godot_api/godot-4.6.json`
- Modify: `package.json`
- Modify: `.vscodeignore`

**Step 1: Write the failing API-index test**

Use a minimal inline `extension_api.json` fixture:

```ts
const api = {
	header: { version_major: 4, version_minor: 6, version_patch: 2, version_status: "stable" },
	utility_functions: [{ name: "print" }],
	builtin_classes: [{ name: "Array", methods: [{ name: "append" }] }],
	classes: [
		{ name: "Object", inherits: "", methods: [{ name: "connect" }] },
		{ name: "Node", inherits: "Object", methods: [{ name: "_ready", is_virtual: true }, { name: "add_child" }] },
	],
};
```

Assert that `print`, `Array.append`, inherited `Node.connect`, `Node.add_child`, and virtual `Node._ready` are indexed, while an unknown method is not.

**Step 2: Run the test to verify it fails**

Run: `npm run compile && npm test -- --grep "GodotApiIndex"`

Expected: FAIL because the index does not exist.

**Step 3: Implement the pure API index**

Parse only fields needed for classification. Store utility functions, builtin methods, native methods, inheritance, and virtual methods in `Set`/`Map` structures. Add cycle-safe inherited-method lookup and a normalized full-version cache key.

**Step 4: Write failing loader tests**

Inject filesystem and process-runner interfaces. Verify these cases without launching Godot:

- Valid versioned cache is reused.
- Missing cache runs Godot in a dedicated cache directory with `--headless --dump-extension-api`.
- Invalid/missing executable returns the bundled 4.6 snapshot.
- A failed generation removes no user project file and returns a non-fatal warning result.

**Step 5: Implement the loader and snapshot generator**

Use `ExtensionContext.globalStorageUri` as the process working directory, create it before launch, and atomically rename the generated JSON to `extension-api-<version>.json`. Never run the dump in the project directory. Add `npm run generate-api-snapshot -- --godot <path>` and generate the bundled snapshot from `Godot_v4.6.2-stable_win64_console.exe`.

**Step 6: Verify the real snapshot**

Run:

```powershell
npm run generate-api-snapshot -- --godot "D:\work_mine\godparty\GodotEditor\Godot_v4.6.2-stable_win64_console.exe"
npm run compile
npm test -- --grep "GodotApi"
```

Expected: snapshot exists, reports Godot 4.6.2, and all API tests PASS.

**Step 7: Commit**

```bash
git add package.json .vscodeignore tools/generate_godot_api_snapshot.ts resources/godot_api src/function_highlighting
git commit -m "feat: index Godot native function API"
```

### Task 4: Build the project symbol index

**Files:**
- Create: `src/function_highlighting/project_symbol_index.ts`
- Create: `src/function_highlighting/project_symbol_index.test.ts`
- Create: `src/function_highlighting/project_index_service.ts`
- Create: `src/function_highlighting/project_index_service.test.ts`

**Step 1: Write failing pure-index tests**

Use three script fixtures to verify `class_name`, `extends`, member functions, static functions, explicit member/local/parameter types, inherited project functions, and duplicate names. Include an Autoload mapping fixture and assert it remains project-owned.

```ts
index.update("res://player.gd", `
class_name Player
extends CharacterBody2D
func move_player(target: Vector2) -> void: pass
`);
strictEqual(index.resolveClassMethod("Player", "move_player")?.uri, "res://player.gd");
```

**Step 2: Run the test to verify it fails**

Run: `npm run compile && npm test -- --grep "ProjectSymbolIndex"`

Expected: FAIL because project index exports are missing.

**Step 3: Implement the pure index**

Reuse scanner lexical masks so declarations inside comments/strings are ignored. Track functions, classes, script inheritance, type annotations, `preload()` script aliases, and autoload names. Make `update(uri, text)` replace one file atomically and `remove(uri)` clear all reverse mappings.

**Step 4: Implement and test VS Code synchronization**

Inject workspace adapters around `findFiles`, `openTextDocument`, and file watchers. Default exclusions: `**/.godot/**`, `**/.git/**`, `**/build/**`, `**/dist/**`, and user settings. Verify create/change/delete events and stale document-version rejection.

**Step 5: Run tests**

Run: `npm run compile && npm test -- --grep "Project.*Index"`

Expected: all project index tests PASS.

**Step 6: Commit**

```bash
git add src/function_highlighting/project_symbol_index.ts src/function_highlighting/project_symbol_index.test.ts src/function_highlighting/project_index_service.ts src/function_highlighting/project_index_service.test.ts
git commit -m "feat: index project GDScript functions"
```

### Task 5: Implement deterministic function-origin classification

**Files:**
- Create: `src/function_highlighting/classifier.ts`
- Create: `src/function_highlighting/classifier.test.ts`
- Create: `src/function_highlighting/lsp_origin_resolver.ts`
- Create: `src/function_highlighting/lsp_origin_resolver.test.ts`

**Step 1: Write the failing classification matrix**

Table-drive the required precedence:

```ts
const cases = [
	["print()", "print", "system", "utility_function"],
	["func _ready():", "_ready", "system", "native_virtual_override"],
	["node.add_child(child)", "add_child", "system", "typed_native_receiver"],
	["move_player()", "move_player", "project", "project_definition"],
	["custom.add_child(child)", "add_child", "project", "project_definition"],
	["dynamic.call_it()", "call_it", "project", "unresolved_defaults_to_project"],
] as const;
```

Add explicit cases for project-over-system name collisions, project inheritance, builtin types, `self`, `super`, Autoloads, addons, and GDExtension symbols.

**Step 2: Run the test to verify it fails**

Run: `npm run compile && npm test -- --grep "FunctionOriginClassifier"`

Expected: FAIL because classifier exports are missing.

**Step 3: Implement synchronous classification**

Return `{ origin, owner, reason, confidence }`. Apply the exact eight-step priority from the approved design. The synchronous path must classify all recognized function tokens; unresolved values default to `project`.

**Step 4: Add the cached LSP resolver**

Wrap `globals.lsp.client.sendRequest("textDocument/definition", ...)` and hover/native-symbol fallback behind an injected interface. Cache by URI, document version, and offset. Accept cancellation and reject results from stale versions. A workspace `.gd` URI means project; a `gddoc`/native symbol means system; missing/error means no refinement.

**Step 5: Run tests**

Run: `npm run compile && npm test -- --grep "Origin"`

Expected: precedence and LSP fallback tests PASS.

**Step 6: Commit**

```bash
git add src/function_highlighting/classifier.ts src/function_highlighting/classifier.test.ts src/function_highlighting/lsp_origin_resolver.ts src/function_highlighting/lsp_origin_resolver.test.ts
git commit -m "feat: classify system and project functions"
```

### Task 6: Integrate semantic tokens, visible decorations, and hover evidence

**Files:**
- Modify: `src/providers/semantic_tokens.ts`
- Modify: `src/providers/hover.ts`
- Modify: `src/providers/index.ts`
- Create: `src/function_highlighting/highlighting_service.ts`
- Create: `src/function_highlighting/highlighting_service.test.ts`
- Create: `src/function_highlighting/decorations.ts`
- Create: `src/function_highlighting/decorations.test.ts`
- Modify: `src/extension.ts`

**Step 1: Write failing provider/service tests**

Assert that analyzed ranges become `godotSystemFunction` or `godotProjectFunction`, decorations receive the same ranges, a setting change recreates decoration types, and hover output includes evidence without replacing existing LSP hover content.

**Step 2: Run the test to verify it fails**

Run: `npm run compile && npm test -- --grep "Function highlighting"`

Expected: FAIL because the service and token types do not exist.

**Step 3: Extend the existing semantic-token provider**

Keep existing node-path behavior, add both function token types to its legend, enable the provider in `extension.ts`, and expose `onDidChangeSemanticTokens`. Use the central service so token and decoration results cannot disagree.

**Step 4: Add configurable decorations**

Create light/dark `TextEditorDecorationType` values using configured system/project colors and font styles. Apply them only to visible GDScript editors, clear them when disabled, and dispose/recreate them on relevant setting changes. Default system color: `#4FC3F7`; default project color: `#FFD166`.

**Step 5: Add hover evidence**

For a classified function range, return a short Markdown section such as:

```text
GodParty function origin: Godot system
Owner: Node.add_child
Reason: typed native receiver
```

Let VS Code combine this provider result with the normal Godot LSP hover rather than querying or duplicating complete API documentation.

**Step 6: Run focused tests**

Run: `npm run compile && npm test -- --grep "Function highlighting|Semantic|Decoration"`

Expected: all provider and lifecycle cases PASS.

**Step 7: Commit**

```bash
git add src/providers src/function_highlighting src/extension.ts
git commit -m "feat: highlight function origins in GDScript"
```

### Task 7: Add settings, commands, status, and attribution

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `UPSTREAM.md`
- Create: `src/function_highlighting/status.ts`
- Create: `src/function_highlighting/status.test.ts`
- Modify: `src/extension.ts`

**Step 1: Write manifest/status checks**

Test or validate that the manifest contributes:

- `godpartyGodotTools.functionHighlight.toggle`
- `godpartyGodotTools.functionHighlight.rebuildIndex`
- enabled, systemColor, projectColor, systemFontStyle, projectFontStyle, and exclude settings
- semantic token scopes for `godotSystemFunction` and `godotProjectFunction`

Verify status transitions `indexing -> ready`, `fallback`, and `error`, with `ready` hidden.

**Step 2: Implement configuration and commands**

Register commands directly with the fork namespace. Toggle the setting at workspace scope, rebuild both indexes on demand, and refresh semantic tokens/decorations afterward. Display status only during indexing or degraded/error states.

**Step 3: Document the fork**

Rewrite the README introduction and installation section while retaining relevant upstream feature documentation. State that the official Godot Tools extension must be disabled, document colors and settings, and link the upstream repository. Keep `LICENSE` unchanged and add `UPSTREAM.md` with the baseline commit and modified areas.

**Step 4: Run checks**

Run: `npm run compile && npm run lint && npm test -- --grep "status|manifest"`

Expected: PASS with no Biome diagnostics.

**Step 5: Commit**

```bash
git add package.json README.md CHANGELOG.md UPSTREAM.md src/function_highlighting/status.ts src/function_highlighting/status.test.ts src/extension.ts
git commit -m "docs: configure and document function highlighting"
```

### Task 8: Verify against GodParty and package the VSIX

**Files:**
- Create: `test_projects/function-highlighting/project.godot`
- Create: `test_projects/function-highlighting/system_and_project.gd`
- Create: `test_projects/function-highlighting/custom_node.gd`
- Create: `docs/verification/2026-08-19-function-origin-highlighting.md`
- Modify: `.vscode-test.js` if a second test workspace is required

**Step 1: Add the integration fixture**

Include examples for every accepted category and collision:

```gdscript
extends Node

func _ready() -> void:
	print("system")
	add_child(Node.new())
	move_player()

func move_player() -> void:
	pass
```

Add a project class that defines its own `add_child()` and confirm calls on that typed class remain project-custom.

**Step 2: Run all automated verification**

Run:

```powershell
npm ci
npm run compile
npm run lint
npm test
npm run esbuild
npm run package
```

Expected: every command exits 0 and a `godparty-godot-tools-0.1.0.vsix` is produced.

**Step 3: Verify the packaged contents**

Run: `npx vsce ls --tree`

Expected: bundled API snapshot, compiled extension, grammar, resources, README, UPSTREAM, and LICENSE are present; source tests and unrelated generated files are excluded.

**Step 4: Perform a real GodParty smoke test**

Launch an Extension Development Host using `D:\work_mine\godparty\GodClient` as the workspace and configure Godot 4 path to `D:\work_mine\godparty\GodotEditor\Godot_v4.6.2-stable_win64.exe`. Inspect representative GDScript files and verify:

- system and custom colors are visibly different;
- `_ready`, native calls, project calls, Autoload calls, and same-name collisions match the rules;
- hover evidence is correct;
- toggling the feature restores original Godot Tools rendering;
- normal completion, go-to-definition, formatting, and debugger activation still work.

Record exact files checked, observed results, test output, VSIX name, and any known dynamic-typing limitation in the verification document.

**Step 5: Check repository state and commit verification**

Run: `git status --short && git diff --check && git log --oneline -10`

Expected: only the intended verification document and integration fixture are uncommitted before the final commit.

```bash
git add test_projects/function-highlighting docs/verification/2026-08-19-function-origin-highlighting.md .vscode-test.js
git commit -m "test: verify function origin highlighting"
```

**Step 6: Final handoff**

Provide the absolute VSIX path, branch name, commit list, test summary, installation command, and the instruction to disable the official `geequlim.godot-tools` extension before enabling the fork.

