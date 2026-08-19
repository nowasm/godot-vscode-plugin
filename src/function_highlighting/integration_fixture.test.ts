import { readFileSync } from "node:fs";
import { strictEqual } from "node:assert";
import * as path from "node:path";

import { classifyFunction } from "./classifier";
import { GodotApiIndex } from "./godot_api_index";
import { ProjectSymbolIndex } from "./project_symbol_index";
import { scanFunctions } from "./scanner";

suite("GodParty integration fixture", () => {
	test("covers system, project, Autoload, collision, and dynamic calls", () => {
		const root = path.resolve(__dirname, "..", "..");
		const fixture = path.join(root, "test_projects", "function-highlighting");
		const api = GodotApiIndex.fromJson(
			readFileSync(path.join(root, "resources", "godot_api", "godot-4.6.json"), "utf8"),
		);
		const project = new ProjectSymbolIndex();
		for (const file of ["custom_node.gd", "test_manager.gd", "system_and_project.gd"]) {
			project.update(`res://${file}`, readFileSync(path.join(fixture, file), "utf8"));
		}
		project.setAutoload("TestManager", "res://test_manager.gd");

		const uri = "res://system_and_project.gd";
		const source = readFileSync(path.join(fixture, "system_and_project.gd"), "utf8");
		const calls = scanFunctions(source).filter((token) => token.kind === "call");
		const classify = (name: string, receiver?: string) => {
			const token = calls.find((candidate) => candidate.name === name && candidate.receiver === receiver);
			if (!token) {
				throw new Error(`Fixture call not found: ${receiver ? `${receiver}.` : ""}${name}`);
			}
			return classifyFunction(token, { uri, api, project });
		};

		strictEqual(classify("range").origin, "system");
		strictEqual(classify("add_child", "native_node").reason, "typed_native_receiver");
		strictEqual(classify("move_player").origin, "project");
		strictEqual(classify("add_child", "custom_node").reason, "project_receiver");
		strictEqual(classify("change_phase", "TestManager").reason, "autoload_receiver");
		strictEqual(classify("call_it", "dynamic_target").reason, "unresolved_defaults_to_project");
		strictEqual(classify("print").reason, "project_definition");
	});
});
