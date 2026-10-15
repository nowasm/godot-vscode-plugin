# Inspector toggle and node visibility implementation plan

**Goal:** Reclaim editor space with one persistent switch for both Inspector columns, and show/hide runtime nodes directly from the scene tree on Godot 3 and 4.

**Architecture:** Keep the existing scene/Inspector providers and add a workspace-local display preference. Use the existing remote inspection/property APIs for visibility, validating the node and its boolean `visible` property before writing. Godot 4 supplies local/inherited visibility flags; Godot 3 supplies no such flags, so read visibility on demand and retain confirmed local state until the next inspection or session reset.

**Tech stack:** TypeScript VS Code extension, webview JavaScript/CSS, existing standard Godot 4 and Godot 3/4 v2 transports.

1. Update `src/debugger/inspector_columns.ts`, `src/debugger/debugger.ts`, and `package.json`: add toggle command, toolbar/status entry, close button, default off, and workspace preference. Serialize open/close actions, remove only empty Inspector groups, and preserve source tabs/unsaved buffers and preference during extension disposal.
2. Update `src/debugger/scene_tree_provider.ts` and add `src/debugger/node_visibility.ts`: determine visibility support from flags or the bundled Godot 3 class hierarchy; track local state separately from inherited hidden state. Never expose viewport/root visibility controls or assume that arbitrary `Node` objects have a visible property.
3. Update both v2 controllers to expose acknowledged property writes; leave existing fire-and-forget editing callers intact. Standard Godot 4 writes are followed by a fresh inspect request to confirm the result. Validate the active session/current node after awaits, serialize writes per node, and report failures without changing selection.
4. Wire visibility actions into `src/debugger/inspector_columns.ts`, `media/remote-inspector/columns.js`, and sidebar menus. Distinguish own hidden state from a hidden ancestor; offer explicit Show/Hide actions and refresh selected Inspector values after a confirmed change.
5. Add meaningful tests to `src/debugger/inspector_columns.test.ts`, `src/debugger/scene_tree_provider.test.ts`, and `src/debugger/remote_scene_integration.test.ts`: reclaim groups safely, remember toggle state, preserve dirty source, validate messages/unsupported nodes, toggle hidden children under hidden parents, and verify real Godot 3/4 writes while running/paused. Run compile/lint and the targeted VS Code extension-host suite; validate rendered controls against Brotato.
6. Update README/CHANGELOG and version, package/install the VSIX, record verification, and commit on the existing v2 branch. Keep master clean and do not edit Brotato project files.

Alternatives considered: a settings-only switch is too difficult to reach during debugging; two separate visibility panes add unnecessary state. Extending/rebuilding the Godot 3 engine only for tree flags is avoidable because its existing Inspector API already exposes visibility.
