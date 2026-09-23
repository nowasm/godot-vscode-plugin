import { strictEqual } from "node:assert";

import { ProjectSymbolIndex } from "./project_symbol_index";

suite("ProjectSymbolIndex", () => {
	test("indexes classes, functions, inheritance, types, and script aliases", () => {
		const index = new ProjectSymbolIndex();
		index.update(
			"res://base_actor.gd",
			`class_name BaseActor
extends Node
func shared_action() -> void: pass
`,
		);
		index.update(
			"res://enemy.gd",
			`class_name Enemy
extends CharacterBody2D
func attack() -> void: pass
`,
		);
		index.update(
			"res://player.gd",
			`class_name Player
extends BaseActor
const EnemyScript = preload("res://enemy.gd")
var target_node: Node
static func create_player() -> Player: return Player.new()
func move_player(target: Vector2, enemy: Enemy) -> void:
	var timer: Timer
	enemy.attack()
`,
		);

		strictEqual(index.resolveClassMethod("Player", "move_player")?.uri, "res://player.gd");
		strictEqual(index.resolveClassMethod("Player", "shared_action")?.uri, "res://base_actor.gd");
		strictEqual(index.resolveClassMethod("Player", "create_player")?.isStatic, true);
		strictEqual(index.resolveVariableType("res://player.gd", "target_node"), "Node");
		strictEqual(index.resolveVariableType("res://player.gd", "enemy", "move_player"), "Enemy");
		strictEqual(index.resolveVariableType("res://player.gd", "timer", "move_player"), "Timer");
		strictEqual(index.resolveScriptAlias("res://player.gd", "EnemyScript"), "res://enemy.gd");
	});

	test("treats autoload and addon scripts as project-owned", () => {
		const index = new ProjectSymbolIndex();
		index.update("res://src/autoload/game_manager.gd", "extends Node\nfunc change_phase() -> void: pass\n");
		index.update(
			"res://addons/example/tool.gd",
			"class_name AddonTool\nextends RefCounted\nfunc execute() -> void: pass\n",
		);
		index.setAutoload("GameManager", "res://src/autoload/game_manager.gd");

		strictEqual(index.resolveAutoload("GameManager"), "res://src/autoload/game_manager.gd");
		strictEqual(
			index.resolveScriptMethod("res://src/autoload/game_manager.gd", "change_phase")?.uri,
			"res://src/autoload/game_manager.gd",
		);
		strictEqual(index.resolveClassMethod("AddonTool", "execute")?.uri, "res://addons/example/tool.gd");
	});

	test("indexes the native base in an inline class_name declaration", () => {
		const index = new ProjectSymbolIndex();
		const script = index.update(
			"res://safe_area.gd",
			"class_name SafeArea extends Control\nfunc _ready(): get_viewport_rect()\n",
		);

		strictEqual(script.className, "SafeArea");
		strictEqual(script.extendsName, "Control");
	});

	test("replaces and removes one file atomically", () => {
		const index = new ProjectSymbolIndex();
		index.update("res://changing.gd", "class_name Changing\nfunc before(): pass\n");
		index.update("res://changing.gd", "class_name Changing\nfunc after(): pass\n");

		strictEqual(index.resolveClassMethod("Changing", "before"), undefined);
		strictEqual(index.resolveClassMethod("Changing", "after")?.uri, "res://changing.gd");
		index.remove("res://changing.gd");
		strictEqual(index.resolveClassMethod("Changing", "after"), undefined);
	});
});
