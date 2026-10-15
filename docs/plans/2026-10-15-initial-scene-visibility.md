# Initial scene visibility fix

Godot 3 protocol v2 scene snapshots currently omit visibility. The frontend displays an open eye for an undefined value and retains only values read during an explicit inspection/toggle. This makes hidden nodes appear visible initially and misses script changes after the last inspection.

1. Add an optional third field to the custom Godot 3 `scene_snapshot_result`: a flat `[object_id, flags, ...]` array. Keep the existing revision and four-field node records unchanged for older clients. Read native CanvasItem, CanvasLayer and Spatial local/effective visibility without script calls or full-object inspection requests.
2. Parse this optional metadata in the plugin before publishing a scene tree. Fresh flags override old inspection confirmations; old engines remain supported with explicit unknown visibility.
3. Show the effective visibility in the eye and row style while keeping toggles tied to the real local `visible` property. Distinguish hidden ancestors and unknown state, in both the editor column and native sidebar.
4. Regress initial hidden controls, inherited hiding, hidden CanvasLayers, visible top-level CanvasItems, and Spatial inheritance. Verify script-only show/hide changes update from snapshots without inspecting or clicking those nodes. Verify optional metadata compatibility and fragmented v2 delivery.
5. Compile the engine to a separate candidate, validate it with the plugin and Brotato, back up and replace the configured binary without stopping unrelated user processes, install the updated VSIX, and commit both changes on their existing v2 branches. Keep master and Brotato source/configuration untouched.
