# Inspector object details verification — 2026-10-14

Delivered GodParty Godot Tools 0.1.8 on `codex/godot4-debug-protocol-v2`. No engine source or binary changes were required.

## Automated checks

- TypeScript compilation and Biome lint for all changed TypeScript files passed.
- Targeted VS Code 1.96.4 extension host suite: **33 passed**, one optional Brotato VS Code-session test skipped in the Godot 4 workspace. The independent Brotato VS Code-session webview check below ran successfully.
- Object-reference tests cover the Godot 3, Godot 4 and shared Variant classes, references inside arrays/dictionaries, full 64-bit IDs, lazy loading, concurrent request sharing, null/RID distinction, per-object property ownership, circular paths, errors/retry, and stale responses after a new selection or clear.
- Real standard Godot 4.6.2 session: expanded Button and Resource objects from an array, expanded a dictionary reference, retained the root selection, and followed dynamic UI creation/deletion.
- Real custom Godot 4 protocol v2 session: expanded a Button reference in place while running.
- Real custom Godot 3.6.3 protocol v2 session: expanded Reference objects in arrays and dictionaries, inspected while running and paused, resumed, detected a circular owner path, and handled an object released after the parent snapshot.
- Existing scene tree, editor-column layout, remote inspection timeout, protocol fragmentation and native Godot 3 highlight capability checks passed.

The isolated extension host logged the pre-existing language-client startup/stop diagnostics when its editor LSP was unavailable. Debugger assertions and the test runner completed successfully.

## Brotato webview check

Used `D:\work_open\aistudy\Brotato_recovered\gdproj` and the existing custom Godot 3 binary without editing the project's source or configuration. In a separate VS Code test window, selected `/root/ItemService`, expanded `Members/items`, then expanded array element **57** using the rendered webview controls.

The object returned **44 properties**, including `my_id = item_glasses`, `name = ITEM_GLASSES`, `tier = 0`, `value = 20`, `effects = Array[1]`, and `resource_path = res://items/all/glasses/glasses_data.tres`. The object details remained under element 57 and the scene selection remained ItemService. Refresh restored the expanded object branch and retained scroll position. Scene collapse/polling, Inspector filtering infrastructure and native outline controls continued to work. The VS Code-session check passed and cleaned up its own debug session.

## Delivery

- VSIX: `godparty-godot-tools-0.1.8.vsix`, SHA-256 `CD90E345DE29E4400798AE082575E25101CB39ABB88E77622277221CC7E9C7F1`.
- Installed in the user's normal VS Code extensions directory as `godparty.godparty-godot-tools-0.1.8`.
- Installed extension bundle and Inspector webview JavaScript hashes match the packaged build.
- Reload the normal VS Code window and restart the Godot debug session to activate the updated extension host.
- Property filtering searches already loaded properties. Unexpanded objects are fetched only on expansion; a failed branch can be closed and reopened to retry.
