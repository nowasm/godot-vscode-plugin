import { strictEqual } from "node:assert";

import { resolveEditorLspPort } from "./editor_port";

suite("Godot editor LSP port", () => {
	test("uses the Godot 3 editor port for a Godot 3 project", () => {
		strictEqual(resolveEditorLspPort("3.x", 6008, false), 6008);
		strictEqual(resolveEditorLspPort("3.6", 6008, false), 6008);
	});

	test("uses the Godot 4 editor port for a Godot 4 project", () => {
		strictEqual(resolveEditorLspPort("4.6", 6008, false), 6005);
	});

	test("preserves an explicitly configured port", () => {
		strictEqual(resolveEditorLspPort("3.x", 6005, true), 6005);
		strictEqual(resolveEditorLspPort("4.6", 6008, true), 6008);
		strictEqual(resolveEditorLspPort("4.6", 7000, true), 7000);
	});

	test("uses the configured default when the project version is unknown", () => {
		strictEqual(resolveEditorLspPort(undefined, 6008, false), 6008);
	});
});
