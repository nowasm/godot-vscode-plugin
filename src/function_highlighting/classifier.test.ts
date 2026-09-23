import { strictEqual } from "node:assert";

import { GodotApiIndex } from "./godot_api_index";
import { classifyFunction } from "./classifier";
import { ProjectSymbolIndex } from "./project_symbol_index";
import { scanFunctions } from "./scanner";

const api = GodotApiIndex.fromObject({
	header: { version_major: 4, version_minor: 6, version_patch: 2 },
	utility_functions: [{ name: "print" }],
	builtin_classes: [
		{ name: "Array", methods: [{ name: "append" }] },
		{ name: "String", methods: [{ name: "is_empty" }] },
		{ name: "Signal", methods: [{ name: "connect" }, { name: "is_connected" }] },
	],
	classes: [
		{ name: "Object", methods: [{ name: "connect" }] },
		{
			name: "Node",
			inherits: "Object",
			methods: [
				{ name: "_ready", is_virtual: true },
				{ name: "add_child" },
				{ name: "get_viewport", return_value: { type: "Viewport" } },
				{ name: "get_tree", return_value: { type: "SceneTree" } },
			],
		},
		{ name: "Viewport", inherits: "Node", signals: [{ name: "size_changed" }], methods: [] },
		{ name: "SceneTree", inherits: "Node", methods: [{ name: "create_timer", return_value: { type: "SceneTreeTimer" } }] },
		{ name: "SceneTreeTimer", inherits: "RefCounted", signals: [{ name: "timeout" }], methods: [] },
		{ name: "CharacterBody2D", inherits: "Node", methods: [] },
		{ name: "CanvasItem", inherits: "Node", signals: [{ name: "visibility_changed" }], methods: [{ name: "get_viewport_rect" }] },
		{ name: "Control", inherits: "CanvasItem", methods: [] },
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

		strictEqual(
			classifyFunction(token(source, "_ready"), { uri, api, project: index }).reason,
			"native_virtual_override",
		);
		strictEqual(classifyFunction(token(source, "print"), { uri, api, project: index }).origin, "system");
		strictEqual(
			classifyFunction(token(source, "add_child"), { uri, api, project: index }).reason,
			"inherited_native_method",
		);
		strictEqual(classifyFunction(token(source, "move_player", 0), { uri, api, project: index }).origin, "project");
		strictEqual(
			classifyFunction(token(source, "add_child", 1), { uri, api, project: index }).reason,
			"typed_native_receiver",
		);
		strictEqual(
			classifyFunction(token(source, "append"), { uri, api, project: index }).reason,
			"typed_builtin_receiver",
		);
	});

	test("project definitions win over same-named engine functions", () => {
		const index = new ProjectSymbolIndex();
		index.update("res://custom_node.gd", "class_name CustomNode\nextends Node\nfunc add_child(value): pass\n");
		const uri = "res://caller.gd";
		const source = `extends Node
var custom: CustomNode
func print(value): pass
func run():
	print("project")
	custom.add_child(1)
`;
		index.update(uri, source);

		strictEqual(
			classifyFunction(token(source, "print", 1), { uri, api, project: index }).reason,
			"project_definition",
		);
		strictEqual(
			classifyFunction(token(source, "add_child"), { uri, api, project: index }).reason,
			"project_receiver",
		);
	});

	test("classifies unqualified inherited calls from inline class_name declarations", () => {
		const index = new ProjectSymbolIndex();
		const uri = "res://safe_area.gd";
		const source = "class_name SafeArea extends Control\nfunc _ready():\n\tget_viewport_rect()\n\t_refit()\nfunc _refit(): pass\n";
		index.update(uri, source);

		strictEqual(classifyFunction(token(source, "_ready"), { uri, api, project: index }).reason, "native_virtual_override");
		strictEqual(classifyFunction(token(source, "get_viewport_rect"), { uri, api, project: index }).origin, "system");
		strictEqual(classifyFunction(token(source, "_refit", 0), { uri, api, project: index }).origin, "project");
	});

	test("classifies methods on a native signal reached through an inferred local", () => {
		const index = new ProjectSymbolIndex();
		const uri = "res://safe_area.gd";
		const source = `class_name SafeArea extends Control
func _ready():
	var vp := get_viewport()
	if not vp.size_changed.is_connected(_refit):
		vp.size_changed.connect(_refit)
func _refit(): pass
`;
		index.update(uri, source);

		strictEqual(classifyFunction(token(source, "is_connected"), { uri, api, project: index }).owner, "Signal");
		strictEqual(classifyFunction(token(source, "connect"), { uri, api, project: index }).origin, "system");
		strictEqual(classifyFunction(token(source, "_refit", 0), { uri, api, project: index }).origin, "project");
	});

	test("does not label an unresolved signal-like chain as native", () => {
		const index = new ProjectSymbolIndex();
		const uri = "res://unknown.gd";
		const source = "extends Node\nfunc run():\n\tunknown.size_changed.is_connected(callback)\n";
		index.update(uri, source);

		strictEqual(classifyFunction(token(source, "is_connected"), { uri, api, project: index }).origin, "project");
	});

	test("classifies native methods through chained return types and signals", () => {
		const index = new ProjectSymbolIndex();
		const uri = "res://timers.gd";
		const source = "extends Node\nfunc run():\n\tget_tree().create_timer(0.5).timeout.connect(_done)\n\tget_viewport().size_changed.is_connected(_done)\nfunc _done(): pass\n";
		index.update(uri, source);

		strictEqual(classifyFunction(token(source, "create_timer"), { uri, api, project: index }).owner, "SceneTree");
		strictEqual(classifyFunction(token(source, "connect"), { uri, api, project: index }).owner, "Signal");
		strictEqual(classifyFunction(token(source, "is_connected"), { uri, api, project: index }).owner, "Signal");
	});

	test("classifies methods on native and project signals without a variable prefix", () => {
		const index = new ProjectSymbolIndex();
		const uri = "res://signals.gd";
		const source = "extends Control\nsignal custom_changed\nfunc run():\n\tvisibility_changed.is_connected(_done)\n\tcustom_changed.connect(_done)\nfunc _done(): pass\n";
		index.update(uri, source);

		strictEqual(classifyFunction(token(source, "is_connected"), { uri, api, project: index }).owner, "Signal");
		strictEqual(classifyFunction(token(source, "connect"), { uri, api, project: index }).owner, "Signal");
	});

	test("classifies String methods through declared project return types and inferred locals", () => {
		const index = new ProjectSymbolIndex();
		const uri = "res://boot.gd";
		const source = `extends Node
func _get_cli_value(flag: String) -> String: return ""
func run():
	var spectate_room := _get_cli_value("--spectate-room")
	spectate_room.is_empty()
	_get_cli_value("--patch-url").is_empty()
	var literal := ""
	literal.is_empty()
`;
		index.update(uri, source);

		for (const call of scanFunctions(source).filter((entry) => entry.name === "is_empty")) {
			strictEqual(classifyFunction(call, { uri, api, project: index }).owner, "String");
		}
	});

	test("classifies String methods on typed Autoload properties and return values", () => {
		const index = new ProjectSymbolIndex();
		const autoloadUri = "res://player_data.gd";
		index.update(autoloadUri, "extends Node\nvar pending_room_id: String = \"\"\nfunc device_id() -> String: return \"abc\"\n");
		index.setAutoload("PlayerData", autoloadUri);
		const uri = "res://caller.gd";
		const source = `extends Node
func run():
	var did := PlayerData.device_id()
	did.is_empty()
	PlayerData.pending_room_id.is_empty()
	PlayerData.device_id().is_empty()
`;
		index.update(uri, source);

		for (const call of scanFunctions(source).filter((entry) => entry.name === "is_empty")) {
			strictEqual(classifyFunction(call, { uri, api, project: index }).owner, "String");
		}
	});

	test("keeps unknown and project is_empty methods project-owned", () => {
		const index = new ProjectSymbolIndex();
		index.update("res://box.gd", "class_name Box extends Node\nfunc is_empty(): return false\n");
		const uri = "res://caller.gd";
		const source = "extends Node\nvar box: Box\nfunc run():\n\tbox.is_empty()\n\tunknown.is_empty()\n";
		index.update(uri, source);
		for (const call of scanFunctions(source).filter((entry) => entry.name === "is_empty")) {
			strictEqual(classifyFunction(call, { uri, api, project: index }).origin, "project");
		}
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

		strictEqual(
			classifyFunction(token(source, "change_phase"), { uri, api, project: index }).reason,
			"autoload_receiver",
		);
		strictEqual(
			classifyFunction(token(source, "call_it"), { uri, api, project: index }).reason,
			"unresolved_defaults_to_project",
		);
	});

	test("recognizes builtin and native constructors", () => {
		const index = new ProjectSymbolIndex();
		const uri = "res://factory.gd";
		const source = "extends Node\nfunc build():\n\tArray()\n\tNode.new()\n";
		index.update(uri, source);

		strictEqual(
			classifyFunction(token(source, "Array"), { uri, api, project: index }).reason,
			"builtin_constructor",
		);
		strictEqual(classifyFunction(token(source, "new"), { uri, api, project: index }).reason, "native_constructor");
	});
});
