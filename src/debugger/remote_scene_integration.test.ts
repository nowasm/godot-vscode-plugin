import { strict as assert } from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { globals } from "../extension";
import { GodotDebugSession as Godot3Session } from "./godot3/debug_session";
import { GodotDebugSession as Godot4Session } from "./godot4/debug_session";
import { GodotDebugSessionV2 as Godot4SessionV2 } from "./godot4/debug_session_v2";
import type { SceneNode } from "./scene_tree_provider";
import { object_visibility } from "./node_visibility";

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
		await dbg.set_inspector_columns_enabled(false);
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
		assert.equal(dbg.inspectorColumns.isOpen, false, "a disabled workspace must not open columns on launch");
		await dbg.set_inspector_columns_enabled(true);
		await wait_until(() => dbg.inspectorColumns.sceneVisible, "automatic inspector columns");
		await vscode.commands.executeCommand("workbench.view.explorer");
		await wait_until(() => !dbg.sceneTree.view.visible, "hidden debug sidebar tree");
		assert(dbg.session instanceof Godot4Session);
		assert.equal(dbg.session.variables_manager, undefined, "game should be running, without a breakpoint");
		const button = find_node("PlayButton");
		assert.equal(button.node_path, "/root/RemoteUI/Panel/VBox/PlayButton");
		assert.equal(find_node("HiddenLabel").is_hidden, true);
		await dbg.inspect_node(button);
		assert.equal(dbg.inspector.get_top_item()?.label, "PlayButton");
		assert.equal(dbg.inspector.get_top_item()?.description, "Button");
		await dbg.set_node_visibility(button, false);
		await wait_until(() => find_node("PlayButton").is_hidden, "hidden Button");
		assert.equal(object_visibility((await dbg.inspect_object(BigInt(button.object_id))).variable), false);
		await dbg.set_node_visibility(button);
		assert.equal(object_visibility((await dbg.inspect_object(BigInt(button.object_id))).variable), true);
		const panel = find_node("Panel");
		await dbg.set_node_visibility(panel, false);
		await wait_until(() => find_node("PlayButton").is_hidden, "hidden ancestor");
		assert.equal(find_node("PlayButton").local_visible, true);
		await dbg.set_node_visibility(find_node("PlayButton"));
		assert.equal(
			object_visibility((await dbg.inspect_object(BigInt(button.object_id))).variable),
			false,
			"toggle must invert local visibility even when an ancestor is hidden",
		);
		await dbg.set_node_visibility(find_node("PlayButton"), true);
		assert.equal(object_visibility((await dbg.inspect_object(BigInt(panel.object_id))).variable), false);
		await dbg.set_node_visibility(panel, true);
		assert.equal(dbg.inspector.get_top_item()?.label, "PlayButton", "visibility must not change selection");

		const ui = find_node("RemoteUI");
		await dbg.inspect_node(ui);
		const root = dbg.inspector.get_top_item();
		assert(root);
		const references = root.properties.find((property) => property.label.endsWith("object_refs"));
		assert(references, "script Array of object references should be available");
		const reference = references.properties[0];
		assert.equal(reference.contextValue, "remote_object");
		await dbg.inspector.expand_object(reference);
		assert.equal(reference.description, `Button<${button.object_id}>`);
		assert(
			reference.properties.some((property) => /(^|\/)text$/.test(property.label) && property.value === "Play"),
		);
		assert.equal(dbg.inspector.get_top_item(), root, "expansion should not navigate away from RemoteUI");
		await dbg.inspector.expand_object(references.properties[1]);
		assert.match(references.properties[1].properties[0].label, /Circular reference/);
		await dbg.inspector.expand_object(references.properties[2]);
		assert(references.properties[2].properties.some((property) => property.value === "Inspectable resource"));
		const dictionary = root.properties.find((property) => property.label.endsWith("object_dictionary"));
		assert(dictionary);
		await dbg.inspector.expand_object(dictionary.properties[0]);
		assert.match(String(dictionary.properties[0].description), /^Button</);
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
		await dbg.set_inspector_columns_enabled(false);
		await vscode.debug.stopDebugging();
		await wait_until(() => dbg.session === undefined, "termination cleanup");
		assert.deepEqual(dbg.sceneTree.getChildren(), []);
		assert(
			await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
				type: "godot",
				request: "launch",
				name: "Remember closed Inspector",
				debug_protocol_v2: false,
				scene: "RemoteUI.tscn",
				additional_options: "--headless --audio-driver Dummy",
			}),
		);
		const poll = setInterval(() => dbg.refresh_scene_tree(), 250);
		try {
			await wait_until(() => nodes().some((node) => node.label === "PlayButton"), "second debug session");
		} finally {
			clearInterval(poll);
		}
		assert.equal(dbg.inspectorColumns.isOpen, false, "closed columns must stay closed on the next debug session");
	});
});

suite("Remote object inspection - Godot 4 protocol v2", () => {
	test("loads object details while running through the v2 Inspector API", async function () {
		const executable = process.env.GODOT_TOOLS_TEST_GODOT4_V2;
		if (!executable) return this.skip();
		this.timeout(30000);
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
		const dbg = current_debugger();
		const session = new Godot4SessionV2();
		const project = path.resolve(__dirname, "../../test_projects/test-dap-project-godot4");
		session.sceneTree = dbg.sceneTree;
		session.inspector = dbg.inspector;
		session.debug_data.projectPath = project;
		dbg.session = session;
		const poll = setInterval(() => session.controller.request_scene_tree(), 250);
		try {
			await session.controller.launch({
				address: "127.0.0.1",
				port: -1,
				project,
				editor_path: executable,
				scene: "RemoteUI.tscn",
				additional_options: "--headless --audio-driver Dummy",
			} as any);
			await wait_until(() => nodes().some((node) => node.label === "PlayButton"), "Godot 4 v2 UI");
			await dbg.inspect_node(find_node("RemoteUI"));
			const root = dbg.inspector.get_top_item();
			assert(root);
			const references = root.properties.find((property) => property.label.endsWith("object_refs"));
			assert(references);
			await dbg.inspector.expand_object(references.properties[0]);
			assert(references.properties[0].properties.some((property) => property.value === "Play"));
			assert.equal(dbg.inspector.get_top_item(), root);
			const button = find_node("PlayButton");
			await dbg.set_node_visibility(button, false);
			assert.equal(object_visibility((await dbg.inspect_object(BigInt(button.object_id))).variable), false);
			await dbg.set_node_visibility(button, true);
			assert.equal(session.debug_data.last_frames.length, 0);
		} finally {
			clearInterval(poll);
			session.dispose();
			dbg.session = undefined;
			dbg.sceneTree.clear();
			dbg.inspector.clear();
		}
	});
});

// Opt-in smoke test against a real Godot 3 project, without editing its files.
const godot3 = process.env.GODOT_TOOLS_TEST_GODOT3;
const godot3Project = process.env.GODOT_TOOLS_TEST_GODOT3_PROJECT;
suite("Remote UI integration - Godot 3 project", () => {
	test("expands real Godot 3 array/dictionary objects and handles cycles and released objects", async function () {
		if (!godot3) return this.skip();
		this.timeout(30000);
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
		const dbg = current_debugger();
		const session = new Godot3Session();
		const project = path.resolve(__dirname, "../../test_projects/test-dap-project-godot3-v2");
		session.sceneTree = dbg.sceneTree;
		session.inspector = dbg.inspector;
		session.debug_data.projectPath = project;
		dbg.session = session;
		try {
			await session.controller.launch({
				address: "127.0.0.1",
				port: -1,
				project,
				editor_path: godot3,
				scene: "InspectorRefs.tscn",
				additional_options: "--no-window --audio-driver Dummy",
			} as any);
			await wait_until(() => session.controller.is_connected, "Godot 3 fixture connection");
			const poll = setInterval(() => session.controller.request_scene_tree(), 250);
			try {
				await wait_until(() => nodes().some((node) => node.label === "TemporaryLabel"), "Godot 3 fixture tree");
			} finally {
				clearInterval(poll);
			}
			const ui = find_node("InspectorRefs");
			await dbg.inspect_node(ui);
			const root = dbg.inspector.get_top_item();
			assert(root);
			const references = root.properties.find((property) => property.label.endsWith("object_refs"));
			assert(references);
			const reference = references.properties[0];
			await Promise.all([
				dbg.inspector.expand_object(reference),
				dbg.inspector.expand_object(references.properties[1]),
			]);
			assert(reference.properties.some((property) => property.label.endsWith("health") && property.value === 42));
			assert(reference.properties.some((property) => property.value === "Detailed Godot 3 object"));
			const owner = reference.properties.find((property) => property.label.endsWith("owner"));
			assert(owner);
			await dbg.inspector.expand_object(owner);
			assert.match(owner.properties[0].label, /Circular reference/);
			const dictionary = root.properties.find((property) => property.label.endsWith("object_dictionary"));
			assert(dictionary);
			const temporary = find_node("TemporaryLabel");
			await dbg.set_node_visibility(temporary, false);
			assert.equal(object_visibility((await dbg.inspect_object(BigInt(temporary.object_id))).variable), false);
			await dbg.set_node_visibility(temporary, true);
			const canvas = find_node("Canvas");
			await dbg.set_node_visibility(canvas, false);
			await dbg.set_node_visibility(temporary);
			assert.equal(object_visibility((await dbg.inspect_object(BigInt(temporary.object_id))).variable), false);
			assert.equal(object_visibility((await dbg.inspect_object(BigInt(canvas.object_id))).variable), false);
			await dbg.set_node_visibility(canvas, true);
			await session.controller.break();
			await wait_until(() => session.controller.isPaused, "Godot 3 pause");
			await dbg.inspector.expand_object(dictionary.properties[0]);
			assert(dictionary.properties[0].properties.some((property) => property.value === 42));
			await dbg.set_node_visibility(temporary, true);
			assert.equal(object_visibility((await dbg.inspect_object(BigInt(temporary.object_id))).variable), true);
			await session.controller.continue();
			await wait_until(() => !session.controller.isPaused, "Godot 3 resume");
			session.controller.set_object_property(BigInt(ui.object_id), "remove_child", true);
			await new Promise((resolve) => setTimeout(resolve, 200));
			session.controller.request_scene_tree();
			await wait_until(() => !nodes().some((node) => node.label === "TemporaryLabel"), "released object");
			await dbg.inspector.expand_object(references.properties[3]);
			assert.equal(references.properties[3].loadState, "error");
			assert.equal(dbg.inspector.get_top_item(), root);
			assert.equal(session.debug_data.last_frames.length, 0);
		} finally {
			session.dispose();
			dbg.session = undefined;
			dbg.sceneTree.clear();
			dbg.inspector.clear();
		}
	});

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
			assert(dbg.inspectorColumns.sceneVisible, "Godot 3 should also open the full-height columns");
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
