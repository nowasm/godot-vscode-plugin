import { strictEqual } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

import { GodotApiIndex } from "./godot_api_index";

const API_FIXTURE = {
	header: {
		version_major: 4,
		version_minor: 6,
		version_patch: 2,
		version_status: "stable",
	},
	utility_functions: [{ name: "print" }],
	builtin_classes: [{ name: "Array", methods: [{ name: "append" }] }],
	classes: [
		{ name: "Object", inherits: "", methods: [{ name: "connect" }] },
		{
			name: "Node",
			inherits: "Object",
			methods: [
				{ name: "_ready", is_virtual: true },
				{ name: "add_child" },
			],
		},
	],
};

suite("GodotApiIndex", () => {
	test("indexes utilities, builtins, native inheritance, and virtual methods", () => {
		const index = GodotApiIndex.fromObject(API_FIXTURE);

		strictEqual(index.version, "4.6.2-stable");
		strictEqual(index.cacheKey, "4.6.2-stable");
		strictEqual(index.hasUtilityFunction("print"), true);
		strictEqual(index.hasBuiltinMethod("Array", "append"), true);
		strictEqual(index.hasNativeMethod("Node", "add_child"), true);
		strictEqual(index.hasNativeMethod("Node", "connect"), true);
		strictEqual(index.getNativeMethodOwner("Node", "connect"), "Object");
		strictEqual(index.hasVirtualMethod("Node", "_ready"), true);
		strictEqual(index.hasNativeMethod("Node", "missing"), false);
	});

	test("stops safely when malformed inheritance contains a cycle", () => {
		const index = GodotApiIndex.fromObject({
			header: API_FIXTURE.header,
			classes: [
				{ name: "A", inherits: "B", methods: [] },
				{ name: "B", inherits: "A", methods: [{ name: "safe" }] },
			],
		});

		strictEqual(index.hasNativeMethod("A", "safe"), true);
		strictEqual(index.hasNativeMethod("A", "missing"), false);
	});

	test("loads the bundled Godot 4.6 snapshot", () => {
		const snapshot = fs.readFileSync(
			path.join(process.cwd(), "resources", "godot_api", "godot-4.6.json"),
			"utf8",
		);
		const index = GodotApiIndex.fromJson(snapshot);

		strictEqual(index.version, "4.6.2-stable");
		strictEqual(index.hasUtilityFunction("print"), true);
		strictEqual(index.hasBuiltinMethod("Array", "append"), true);
		strictEqual(index.hasNativeMethod("Node", "add_child"), true);
		strictEqual(index.hasVirtualMethod("Node", "_ready"), true);
	});
});
