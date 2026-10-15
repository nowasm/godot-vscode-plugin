import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { globals } from "../extension";
import { SceneNode, SceneTreeProvider } from "./scene_tree_provider";

suite("Remote scene tree", () => {
	let provider: SceneTreeProvider;
	suiteSetup(async () => {
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
		assert(globals.debug);
		provider = globals.debug.sceneTree;
	});
	setup(() => {
		provider.clear();
		provider.set_filter("");
	});
	teardown(() => {
		provider.clear();
		provider.set_filter("");
	});

	function fixture() {
		const button = new SceneNode("PlayButton", "Button", 3, [], undefined, 14);
		const ui = new SceneNode("UI", "Control", 2, [button]);
		const other = new SceneNode("Player", "Node2D", 4, []);
		const root = new SceneNode("root", "Window", 1, [ui, other]);
		provider.fill_tree(root);
		return { root, ui, button, other };
	}

	test("keeps ancestors and expands matching branches when filtering", () => {
		const { root, ui, button } = fixture();
		provider.set_filter("playbutton");
		assert.deepEqual(provider.getChildren(), [root]);
		assert.deepEqual(provider.getChildren(root), [ui]);
		assert.deepEqual(provider.getChildren(ui), [button]);
		assert.equal(provider.getParent(button), ui);
		assert.equal(button.node_path, "/root/UI/PlayButton");
		assert.equal(provider.getTreeItem(ui).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
	});

	test("searches classes and paths and restores all nodes after clearing", () => {
		const { root, ui } = fixture();
		provider.set_filter("Button");
		assert.deepEqual(provider.getChildren(root), [ui]);
		provider.set_filter("/root/UI/");
		assert.equal(provider.getChildren(ui).length, 1);
		provider.set_filter("missing");
		assert.deepEqual(provider.getChildren(), []);
		assert.match(provider.view.message ?? "", /No nodes match/);
		provider.set_filter("");
		assert.equal(provider.getChildren(root).length, 2);
	});

	test("preserves identity after refresh and supplies inspection/path tooltips", () => {
		const { button } = fixture();
		const before = provider.getTreeItem(button) as vscode.TreeItem;
		fixture();
		const updated = provider.find_node(3);
		assert(updated);
		const after = provider.getTreeItem(updated) as vscode.TreeItem;
		assert.equal(before.id, after.id);
		assert.equal(after.command?.command, "godotTools.debugger.inspectNode");
		assert.match(after.tooltip as string, /\/root\/UI\/PlayButton/);
		provider.clear();
		assert.equal(provider.find_node(3), undefined);
	});

	test("distinguishes hidden ancestors from locally visible controls", () => {
		const node = new SceneNode("HiddenUI", "Control", 5, [], undefined, 6);
		provider.fill_tree(node);
		assert.equal(node.is_hidden, true);
		assert.equal(node.local_visible, true, "toggling must use local visibility, not inherited visibility");
		assert.equal(node.effective_visible, false, "displayed scene state must include hidden ancestors");
		assert.match(provider.getTreeItem(node).description as string, /hidden/);
		assert.equal(new SceneNode("Godot3", "Control", 6, []).is_hidden, false);
	});

	test("offers Godot 3 visibility only for native classes with a boolean visible property", () => {
		const nodes = ["Button", "Label", "Node2D", "MeshInstance", "CanvasLayer", "Node", "Viewport"].map(
			(name, index) => new SceneNode(name, name, index + 2, []),
		);
		const root = new SceneNode("root", "Viewport", 1, nodes);
		provider.fill_tree(root);
		assert.deepEqual(
			nodes.map((node) => node.can_change_visibility),
			[true, true, true, true, true, false, false],
		);
		assert.equal(root.can_change_visibility, false);
		assert.equal(nodes[0].local_visible, undefined);
		assert.equal(provider.getTreeItem(nodes[0]).contextValue, "remote_node_unknown");
		provider.confirm_visibility(2, false);
		assert.equal(nodes[0].local_visible, false);
		assert.equal(nodes[0].is_hidden, true);
		provider.fill_tree(new SceneNode("root", "Viewport", 1, [new SceneNode("Button", "Button", 2, [])]));
		assert.equal(provider.find_node(2)?.local_visible, false, "confirmed Godot 3 state survives snapshots");
		provider.clear();
		provider.fill_tree(root);
		assert.equal(nodes[0].local_visible, undefined, "a new session must not inherit visibility");
	});

	test("refreshes Godot 4 flags rather than keeping a stale confirmed value", () => {
		const { button } = fixture();
		provider.confirm_visibility(button.object_id, false);
		assert.equal(button.local_visible, false);
		fixture();
		assert.equal(provider.find_node(button.object_id)?.local_visible, true);
	});

	test("independent CanvasLayers and Windows do not require an inherited-visibility method", () => {
		for (const type of ["CanvasLayer", "Window"]) {
			assert.equal(new SceneNode(type, type, 5n, [], undefined, 6).effective_visible, true);
			assert.equal(new SceneNode(type, type, 5n, [], undefined, 2).effective_visible, false);
		}
	});
});
