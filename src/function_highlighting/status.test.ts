import { deepStrictEqual } from "node:assert";

import { describeFunctionIndexStatus } from "./status";

suite("Function index status", () => {
	test("shows progress while indexing", () => {
		deepStrictEqual(describeFunctionIndexStatus({ kind: "indexing" }), {
			visible: true,
			text: "$(sync~spin) Godot functions",
			tooltip: "Indexing Godot and project functions…",
		});
	});

	test("hides a ready exact index", () => {
		deepStrictEqual(describeFunctionIndexStatus({ kind: "ready", version: "4.6.2-stable" }), {
			visible: false,
			text: "$(check) Godot functions",
			tooltip: "Function origin index ready for Godot 4.6.2-stable.",
		});
	});

	test("keeps fallback and errors visible", () => {
		deepStrictEqual(describeFunctionIndexStatus({ kind: "fallback", version: "4.6.2-stable" }), {
			visible: true,
			text: "$(warning) Godot functions",
			tooltip:
				"Using the bundled Godot 4.6.2-stable API snapshot. Run Rebuild Function Index after configuring the Godot executable.",
		});
		deepStrictEqual(describeFunctionIndexStatus({ kind: "error", message: "boom" }), {
			visible: true,
			text: "$(error) Godot functions",
			tooltip: "Function origin index failed: boom",
		});
	});
});
