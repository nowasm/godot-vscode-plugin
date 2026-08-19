import { strictEqual } from "node:assert";

import { GodotApiIndex } from "./godot_api_index";
import { classifyFunction } from "./classifier";
import { ProjectSymbolIndex } from "./project_symbol_index";
import { scanFunctions } from "./scanner";

const api = GodotApiIndex.fromObject({
	header: { version_major: 4, version_minor: 6, version_patch: 2 },
	utility_functions: [{ name: "print" }],
	builtin_classes: [{ name: "Array", methods: [{ name: "append" }] }],
	classes: [
		{ name: "Object", methods: [{ name: "connect" }] },
		{
			name: "Node",
			inherits: "Object",
			methods: [
				{ name: "_ready", is_virtual: true },
				{ name: "add_child" },
			],
		},
		{ name: "CharacterBody2D", inherits: "Node", methods: [] },
	],
});

function token(source: string, name: string, occurrence = 0) {
	const found = scanFunctions(source).filter((entry) => entry.name === name)[occurrence];
	if (!found) {
		throw new Error(`token not found: ${name}`);
	}
	return found;
}

suite("FunctionOriginClassifier", () => {
	test("classifies virtual declarations, utilities, native calls, and project calls", () => {
		const index = new ProjectSymbolIndex();
		const uri = "res://player.gd";
		const source = `class_name Player
extends CharacterBody2D
var node: Node
var items: Array
func _ready() -> void:
	print("ready")
	add_child(Node.new())
	move_player()
	node.add_child(Node.new())
	items.append(1)
func move_player() -> void: pass
`;
		index.update(uri, source);

		strictEqual(classifyFunction(token(source, "_ready"), { uri, api, project: index }).reason, "native_virtual_override");
		strictEqual(classifyFunction(token(source, "print"), { uri, api, project: index }).origin, "system");
		strictEqual(classifyFunction(token(source, "add_child"), { uri, api, project: index }).reason, "inherited_native_method");
		strictEqual(classifyFunction(token(source, "move_player", 0), { uri, api, project: index }).origin, "project");
		strictEqual(classifyFunction(token(source, "add_child", 1), { uri, api, project: index }).reason, "typed_native_receiver");
		strictEqual(classifyFunction(token(source, "append"), { uri, api, project: index }).reason, "typed_builtin_receiver");
	});

	test("project definitions win over same-named engine functions", () => {
		const index = new ProjectSymbolIndex();
		index.update(
			"res://custom_node.gd",
			"class_name CustomNode\nextends Node\nfunc add_child(value): pass\n",
		);
		const uri = "res://caller.gd";
		const source = `extends Node
var custom: CustomNode
func print(value): pass
func run():
	print("project")
	custom.add_child(1)
`;
		index.update(uri, source);

		strictEqual(classifyFunction(token(source, "print", 1), { uri, api, project: index }).reason, "project_definition");
		strictEqual(classifyFunction(token(source, "add_child"), { uri, api, project: index }).reason, "project_receiver");
	});

	test("autoloads and unresolved dynamic receivers remain project-owned", () => {
		const index = new ProjectSymbolIndex();
		index.update("res://game_manager.gd", "extends Node\nfunc change_phase(): pass\n");
		index.setAutoload("GameManager", "res://game_manager.gd");
		const uri = "res://caller.gd";
		const source = `extends Node
func run():
	GameManager.change_phase()
	dynamic.call_it()
`;
		index.update(uri, source);

		strictEqual(classifyFunction(token(source, "change_phase"), { uri, api, project: index }).reason, "autoload_receiver");
		strictEqual(classifyFunction(token(source, "call_it"), { uri, api, project: index }).reason, "unresolved_defaults_to_project");
	});

	test("recognizes builtin and native constructors", () => {
		const index = new ProjectSymbolIndex();
		const uri = "res://factory.gd";
		const source = "extends Node\nfunc build():\n\tArray()\n\tNode.new()\n";
		index.update(uri, source);

		strictEqual(classifyFunction(token(source, "Array"), { uri, api, project: index }).reason, "builtin_constructor");
		strictEqual(classifyFunction(token(source, "new"), { uri, api, project: index }).reason, "native_constructor");
	});
});
