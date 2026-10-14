# Inline Inspector object details

Expand an Object reference in the Inspector to fetch its real properties in place, including references nested in arrays and dictionaries. Support the custom Godot 3 protocol v2, standard Godot 4, and Godot 4 protocol v2 without engine changes.

1. Recognize Object references across the separate Variant decoder classes; keep RIDs and null references separate. Preserve 64-bit IDs.
2. Share asynchronous inspection between root selection and lazy expansion. Coalesce simultaneous expansion of the same object, display loading/errors, and discard responses from a previous Inspector tree.
3. Wire both the editor column and sidebar tree to lazy expansion. Keep the scene selection and outline intact. Reopen failed branches to retry; stop circular paths at the ancestor reference.
4. Verify decoder classes, nested containers, ownership of editable object fields, stale responses, errors and cycles. Exercise real Godot 3/Brotato and Godot 4 sessions plus the rendered webview. Package and install the update on the existing v2 branch; keep master clean.

The Inspector filter searches properties already loaded. Object expansion is explicit, so an object graph is never recursively fetched in full.
