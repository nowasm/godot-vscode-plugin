# Upstream attribution

GodParty Godot Tools is derived from
[`godotengine/godot-vscode-plugin`](https://github.com/godotengine/godot-vscode-plugin)
at commit `145a0f0ad5a6c726b27b18b517c217a5e1bfa91c`.

The upstream source and this fork are distributed under the MIT License. The
original [`LICENSE`](LICENSE) and [`ThirdPartyNotices.txt`](ThirdPartyNotices.txt)
are retained unchanged.

## GodParty modifications

- A Godot `extension_api.json` loader, versioned cache, and bundled Godot 4.6.2 snapshot.
- A GDScript function scanner and workspace project-symbol index.
- Deterministic Godot/system versus project/custom function classification.
- Semantic token, decoration, hover, command, configuration, and status-bar integration.
- Fork package identity `godparty.godparty-godot-tools`.

Existing upstream `godotTools.*` command and setting identifiers remain unchanged
for workspace compatibility. New function-origin settings and commands use the
`godpartyGodotTools.functionHighlight` namespace.
