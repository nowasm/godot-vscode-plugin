import { readFileSync } from "node:fs";
import { strictEqual, deepStrictEqual } from "node:assert";
import * as path from "node:path";

import { GodotApiIndex } from "./godot_api_index";
import { FunctionHighlightingService } from "./highlighting_service";
import { ProjectSymbolIndex } from "./project_symbol_index";
import { scanProperties } from "./scanner";

function snapshot(version: "3.6" | "4.6"): GodotApiIndex {
	return GodotApiIndex.fromJson(
		readFileSync(path.resolve(__dirname, "..", "..", "resources", "godot_api", `godot-${version}.json`), "utf8"),
	);
}

suite("Godot engine property highlighting", () => {
	test("uses the matching engine version for inherited and typed properties", () => {
		const godot3 = snapshot("3.6");
		const godot4 = snapshot("4.6");
		strictEqual(godot3.getNativePropertyOwner("Control", "rect_size"), "Control");
		strictEqual(godot3.getNativePropertyOwner("Control", "size"), undefined);
		strictEqual(godot4.getNativePropertyOwner("Control", "size"), "Control");
		strictEqual(godot4.getNativePropertyOwner("Control", "rect_size"), undefined);
		strictEqual(godot3.getNativePropertyType("Control", "rect_size"), "Vector2");
		strictEqual(godot4.getNativePropertyType("Control", "size"), "Vector2");
		strictEqual(godot3.hasBuiltinProperty("Vector2", "x"), true);
		strictEqual(godot4.hasBuiltinProperty("Vector2", "x"), true);
	});

	test("colors Godot 3 rect_size but leaves project and unknown names alone", () => {
		const uri = "res://panel.gd";
		const text = `extends Control
var custom_size: Vector2
func _reposition(control: Control, rect_size_local: Vector2):
	rect_size = rect_min_size
	control.rect_size = rect_size_local
	unknown.rect_size = custom_size
	var message = "rect_size"
	# rect_size
`;
		const project = new ProjectSymbolIndex();
		project.update(uri, text);
		const service = new FunctionHighlightingService(snapshot("3.6"), project);
		const entries = service.analyzeProperties({ uri, version: 1, text });
		deepStrictEqual(
			entries.map((entry) => [entry.token.name, entry.token.receiver]),
			[
				["rect_size", undefined],
				["rect_min_size", undefined],
				["rect_size", "control"],
			],
		);
		strictEqual(
			entries.every((entry) => entry.owner === "Control"),
			true,
		);
	});

	test("handles Godot 4 renamed properties, native chains, and local shadowing", () => {
		const uri = "res://panel.gd";
		const text = `extends Control
func draw(control: Control):
	control.size = Vector2.ZERO
	self.size = get_viewport_rect().size
	print(get_viewport_rect().size.x)
	var size = 10
	print(size)
	for size in [1, 2]:
		print(size)
	unknown.size = 1
`;
		const project = new ProjectSymbolIndex();
		project.update(uri, text);
		const service = new FunctionHighlightingService(snapshot("4.6"), project);
		const entries = service.analyzeProperties({ uri, version: 1, text });
		deepStrictEqual(
			entries.map((entry) => [entry.token.name, entry.token.receiver]),
			[
				["size", "control"],
				["size", "self"],
				["size", "get_viewport_rect()"],
				["size", "get_viewport_rect()"],
				["x", "get_viewport_rect().size"],
			],
		);
		strictEqual(service.analyzeProperties({ uri, version: 1, text }), entries);
		service.invalidate(uri);
		strictEqual(service.analyzeProperties({ uri, version: 1, text }) === entries, false);
	});

	test("scanner excludes functions, comments, and strings", () => {
		const tokens = scanProperties('rect_size = get_rect().size # rect_size\nprint("rect_size")');
		deepStrictEqual(
			tokens.map((token) => token.name),
			["rect_size", "size"],
		);
	});

	test("does not color a loop variable that shadows an engine property", () => {
		const uri = "res://loop.gd";
		const text = "extends Control\nfunc run():\n\tfor size in [1, 2]:\n\t\tprint(size)\n";
		const project = new ProjectSymbolIndex();
		project.update(uri, text);
		const service = new FunctionHighlightingService(snapshot("4.6"), project);
		strictEqual(service.analyzeProperties({ uri, version: 1, text }).length, 0);
	});
});
