# Project-aware Godot LSP Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Opening a Godot 3 project while a Godot 4 editor is running must not route GDScript diagnostics through the Godot 4 language server.

**Architecture:** Reuse the existing `get_project_version()` project detection. Resolve the editor LSP port once per connection from the project major version, while preserving an explicitly configured `godotTools.lsp.serverPort`. Carry that port through reconnects; headless LSP retains its own dynamic port.

**Tech stack:** TypeScript, VS Code extension API, Mocha tests.

---

### Task 1: Detect project versions and select ports

**Files:** Create `src/lsp/editor_port.ts`, `src/lsp/editor_port.test.ts`, `src/utils/project_version.ts`, and `src/utils/project_version.test.ts`; modify `src/utils/godot_utils.ts`.

1. Add failing cases for Godot 3 -> 6008, Godot 4 -> 6005, explicit custom/standard ports, and unknown project version. Add parser cases for `config_version=4`, `config_version=5`, and explicit feature versions.
2. Run `npm run compile && npx mocha --ui tdd out/lsp/editor_port.test.js` and confirm the cases fail before implementation.
3. Implement small pure port-selection and project-version functions, use the latter in `get_project_version()`, and rerun the tests.

### Task 2: Route editor connections by project version

**Files:** Modify `src/lsp/ClientConnectionManager.ts`, `src/lsp/GDScriptLanguageClient.ts`, and `package.json`.

1. Resolve the project major version and distinguish configured `serverPort` overrides from the manifest default.
2. Supply the selected editor port to the client and retain it when the client is recreated.
3. Remove automatic cross-version fallback between ports 6005 and 6008. Document the default/override behavior in the setting description. Leave headless mode unchanged.
4. Run `npm run compile` and the focused test again.

### Task 3: Verify against the user's project

**Files:** No client-project edits.

1. Confirm `D:\work_open\aistudy\Brotato_recovered\gdproj\project.godot` is detected as Godot 3.
2. Run focused tests and `git diff --check`.
3. Check the VS Code extension integration test if the local test runner is available; report any environment-limited check honestly.
