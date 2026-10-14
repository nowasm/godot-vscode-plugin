import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { globals } from "../extension";
import { GodotDebugSession as Godot3Session } from "./godot3/debug_session";
import { GodotDebugSession as Godot4Session } from "./godot4/debug_session";
import type { SceneNode } from "./scene_tree_provider";

function current_debugger() {
	assert(globals.debug);
	return globals.debug;
}

function nodes(): SceneNode[] {
	const provider = current_debugger().sceneTree;
	const visit = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(visit)];
	return provider.getChildren().flatMap(visit);
}

function find_node(label: string): SceneNode {
	const node = nodes().find((node) => node.label === label);
	assert(node, `Expected a runtime node named ${label}`);
	return node;
}

async function wait_until(check: () => boolean, description: string, timeout = 15000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

suite("Remote UI integration - Godot 4", () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
	});
	teardown(async () => {
		if (vscode.debug.activeDebugSession) {
			await vscode.debug.stopDebugging();
			await wait_until(() => current_debugger().session === undefined, "debugger cleanup");
		}
	});

	test("loads and inspects UI without a breakpoint, follows runtime mutations, and cleans up", async function () {
		this.timeout(45000);
		const dbg = current_debugger();
		dbg.set_scene_tree_filter("");
		await vscode.commands.executeCommand("godotTools.activeSceneTree.focus");
		assert(
			await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
				type: "godot",
				request: "launch",
				name: "Remote UI integration",
				debug_protocol_v2: false,
				scene: "RemoteUI.tscn",
				additional_options: "--headless --audio-driver Dummy",
			}),
		);
		await wait_until(() => nodes().some((node) => node.label === "PlayButton"), "initial runtime UI tree");
		assert(dbg.session instanceof Godot4Session);
		assert.equal(dbg.session.variables_manager, undefined, "game should be running, without a breakpoint");
		const button = find_node("PlayButton");
		assert.equal(button.node_path, "/root/RemoteUI/Panel/VBox/PlayButton");
		assert.equal(find_node("HiddenLabel").is_hidden, true);
		await dbg.inspect_node(button);
		assert.equal(dbg.inspector.get_top_item()?.label, "PlayButton");
		assert.equal(dbg.inspector.get_top_item()?.description, "Button");

		const ui = find_node("RemoteUI");
		dbg.session.controller.set_object_property(BigInt(ui.object_id), "show_dynamic_child", true);
		await wait_until(
			() => nodes().some((node) => node.label === "RuntimeLabel"),
			"automatic refresh after adding a control",
		);
		await dbg.inspect_node(find_node("RuntimeLabel"));
		assert.equal(dbg.inspector.get_top_item()?.label, "RuntimeLabel");
		dbg.session.controller.set_object_property(BigInt(ui.object_id), "show_dynamic_child", false);
		await wait_until(
			() => !nodes().some((node) => node.label === "RuntimeLabel"),
			"automatic refresh after removing a control",
		);
		assert.equal(dbg.inspector.get_top_item(), undefined, "removed selections should be cleared");
		dbg.set_node_highlight(false);
		dbg.set_node_highlight(true);
		await vscode.debug.stopDebugging();
		await wait_until(() => dbg.session === undefined, "termination cleanup");
		assert.deepEqual(dbg.sceneTree.getChildren(), []);
	});
});

// Opt-in smoke test against a real Godot 3 project, without editing its files.
const godot3 = process.env.GODOT_TOOLS_TEST_GODOT3;
const godot3Project = process.env.GODOT_TOOLS_TEST_GODOT3_PROJECT;
suite("Remote UI integration - Godot 3 project", () => {
	test("uses the VS Code session to inspect the game's UI and clean up", async function () {
		if (!godot3 || !godot3Project || process.env.GODOT_TOOLS_TEST_GODOT3_VSCODE !== "true") return this.skip();
		this.timeout(60000);
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
		const dbg = current_debugger();
		dbg.set_scene_tree_filter("");
		await vscode.commands.executeCommand("godotTools.activeSceneTree.focus");
		try {
			assert(
				await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
					type: "godot",
					request: "launch",
					name: "Brotato runtime UI test",
					project: godot3Project,
					editor_path: godot3,
					scene: "main",
					debug_protocol_v2: true,
					additional_options: "--no-window --audio-driver Dummy",
				}),
			);
			const prefix = process.env.GODOT_TOOLS_TEST_GODOT3_UI_PATH ?? "/root";
			const find_ui = () =>
				nodes().find(
					(node) =>
						node.node_path.startsWith(`${prefix}/`) &&
						/Button|Label|TextureRect|ColorRect/.test(node.class_name),
				);
			await wait_until(() => !!find_ui(), "the game's main UI", 45000);
			const ui = find_ui();
			assert(ui);
			assert(dbg.session instanceof Godot3Session);
			await dbg.inspect_node(ui);
			await wait_until(() => dbg.inspector.get_top_item()?.label === ui.label, "click-to-inspect while running");
			assert.equal(dbg.inspector.get_top_item()?.description, ui.class_name);
			assert.equal(dbg.session.debug_data.last_frames.length, 0);
			console.log(`Godot 3 VS Code session: ${nodes().length} runtime nodes; inspected ${ui.node_path}`);
		} finally {
			if (vscode.debug.activeDebugSession) await vscode.debug.stopDebugging();
			await wait_until(() => dbg.session === undefined, "Godot 3 session cleanup");
		}
		assert.deepEqual(dbg.sceneTree.getChildren(), []);
	});

	test("loads the running project's tree and inspects a UI node without a breakpoint", async function () {
		if (!godot3 || !godot3Project) return this.skip();
		this.timeout(60000);
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
		const dbg = current_debugger();
		dbg.set_scene_tree_filter("");
		dbg.sceneTree.clear();
		const session = new Godot3Session();
		session.sceneTree = dbg.sceneTree;
		session.inspector = dbg.inspector;
		session.debug_data.projectPath = godot3Project;
		try {
			await session.controller.launch({
				address: "127.0.0.1",
				port: -1,
				project: godot3Project,
				editor_path: godot3,
				scene: "main",
				additional_options: "--no-window --audio-driver Dummy",
			} as any);
			const timer = setInterval(() => session.controller.request_scene_tree(), 1000);
			try {
				await wait_until(
					() => nodes().some((node) => /Button|Label/.test(node.class_name)),
					"Godot 3 UI tree",
					45000,
				);
			} finally {
				clearInterval(timer);
			}
			const ui = nodes().find((node) => /Button|Label/.test(node.class_name));
			assert(ui);
			assert.match(ui.node_path, /^\/root\//);
			console.log(
				`Godot 3 project: ${nodes().length} runtime nodes; inspecting ${ui.node_path} (${ui.class_name})`,
			);
			const inspected = new Promise<string>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error("Godot 3 Inspector timed out")), 5000);
				session.inspect_callbacks.set(BigInt(ui.object_id), (class_name, variable) => {
					clearTimeout(timeout);
					dbg.inspector.fill_tree(ui.label, class_name, Number(ui.object_id), variable);
					resolve(class_name);
				});
			});
			session.controller.request_inspect_object(BigInt(ui.object_id));
			assert.equal(await inspected, ui.class_name);
			assert.equal(dbg.inspector.get_top_item()?.label, ui.label);
			assert.equal(session.debug_data.last_frames.length, 0);
		} finally {
			session.dispose();
			dbg.sceneTree.clear();
			dbg.inspector.clear();
		}
	});
});
