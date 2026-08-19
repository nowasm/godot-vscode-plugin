import { deepStrictEqual } from "node:assert";

import { parseProjectAutoloads } from "./project_file";

suite("Godot project file", () => {
	test("parses script and scene Autoload entries", () => {
		deepStrictEqual(
			parseProjectAutoloads(`[autoload]
GameManager="*res://src/autoload/game_manager.gd"
SceneTransition = "res://src/autoload/scene_transition.tscn"

[display]
mode=2
`),
			[
				{ name: "GameManager", resourcePath: "res://src/autoload/game_manager.gd" },
				{ name: "SceneTransition", resourcePath: "res://src/autoload/scene_transition.tscn" },
			],
		);
	});
});
