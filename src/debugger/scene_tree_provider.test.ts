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
		assert.match(provider.getTreeItem(node).description as string, /hidden/);
		assert.equal(new SceneNode("Godot3", "Control", 6, []).is_hidden, false);
	});
});
