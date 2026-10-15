import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { globals } from "../extension";
import { InspectorColumns } from "./inspector_columns";
import { SceneNode } from "./scene_tree_provider";

const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
async function until(check: () => boolean) {
	for (let i = 0; i < 50; i++) {
		if (check()) return;
		await pause();
	}
	throw new Error("Timed out waiting for inspector editor groups");
}
function column(kind: "remoteSceneColumn" | "nodePropertiesColumn") {
	for (const group of vscode.window.tabGroups.all) {
		const tab = group.tabs.find(
			(tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(kind),
		);
		if (tab) return { group, tab };
	}
}

suite("Inspector editor columns", () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
		assert(globals.debug);
	});
	teardown(async () => {
		await globals.debug?.set_inspector_columns_enabled(false);
		globals.debug?.sceneTree.clear();
		globals.debug?.set_scene_tree_filter("");
		globals.debug?.inspector.clear();
	});

	test("inserts two independent columns before source tabs and reuses them", async function () {
		this.timeout(15000);
		const dbg = globals.debug;
		assert(dbg);
		await dbg.inspectorColumns.close();
		await until(() => !column("remoteSceneColumn") && !column("nodePropertiesColumn"));
		const doc = await vscode.workspace.openTextDocument({
			content: "# unsaved source buffer",
			language: "gdscript",
		});
		await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
		assert(doc.isDirty);
		const before = vscode.window.tabGroups.all.length;
		await vscode.commands.executeCommand("godotTools.debugger.openInspectorColumns");
		await until(() => !!column("remoteSceneColumn") && !!column("nodePropertiesColumn"));
		assert.equal(column("remoteSceneColumn")?.group.viewColumn, 1);
		assert.equal(column("nodePropertiesColumn")?.group.viewColumn, 2);
		assert.equal(vscode.window.tabGroups.all.length, before + 2);
		assert.equal(vscode.window.activeTextEditor?.document, doc, "source focus must be restored");
		assert.equal(vscode.window.activeTextEditor?.viewColumn, 3);
		assert.equal(doc.getText(), "# unsaved source buffer");
		assert(doc.isDirty);
		assert(dbg.inspectorColumns.sceneVisible);
		await Promise.all([dbg.inspectorColumns.open(), dbg.inspectorColumns.open()]);
		assert.equal(vscode.window.tabGroups.all.length, before + 2, "reopen must not add groups");
		const propertiesColumn = column("nodePropertiesColumn");
		assert(propertiesColumn);
		await vscode.window.tabGroups.close(propertiesColumn.tab);
		await until(() => !column("nodePropertiesColumn"));
		await dbg.inspectorColumns.open();
		await until(() => !!column("nodePropertiesColumn"));
		assert.equal(column("nodePropertiesColumn")?.group.viewColumn, 2);
		assert.equal(column("remoteSceneColumn")?.group.viewColumn, 1);
		assert.equal(doc.getText(), "# unsaved source buffer");
		const source = await vscode.workspace.openTextDocument(
			vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0].uri ?? vscode.Uri.file("."), "RemoteUI.gd"),
		);
		await vscode.window.showTextDocument(source, vscode.ViewColumn.Three);
		await vscode.window.showTextDocument(doc, vscode.ViewColumn.Three);
		await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
		await vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
		const anotherSource = await vscode.workspace.openTextDocument(
			vscode.Uri.joinPath(source.uri, "..", "ScopeVars.gd"),
		);
		const sourceEditor = await vscode.window.showTextDocument(anotherSource);
		assert.equal(sourceEditor.viewColumn, 3, "source navigation must avoid the inspector groups");
	});

	test("toggles both columns, remembers the choice, and reclaims empty groups without closing dirty source", async function () {
		this.timeout(15000);
		const dbg = globals.debug;
		assert(dbg);
		await dbg.set_inspector_columns_enabled(false);
		const config = vscode.workspace.getConfiguration("workbench.editor");
		const previous = config.inspect<boolean>("closeEmptyGroups")?.globalValue;
		await config.update("closeEmptyGroups", false, vscode.ConfigurationTarget.Global);
		const doc = await vscode.workspace.openTextDocument({
			content: "# preserved dirty source",
			language: "gdscript",
		});
		try {
			await vscode.window.showTextDocument(doc);
			const before = vscode.window.tabGroups.all.length;
			await vscode.commands.executeCommand("godotTools.debugger.toggleInspectorColumns");
			assert(dbg.inspectorColumns.isOpen);
			assert(dbg.inspector_columns_enabled);
			await until(() => !!column("remoteSceneColumn") && !!column("nodePropertiesColumn"));
			await vscode.commands.executeCommand("godotTools.debugger.toggleInspectorColumns");
			assert.equal(dbg.inspectorColumns.isOpen, false);
			assert.equal(dbg.inspector_columns_enabled, false);
			await until(() => vscode.window.tabGroups.all.length === before);
			assert(doc.isDirty);
			assert.equal(doc.getText(), "# preserved dirty source");
			await Promise.all([dbg.toggle_inspector_columns(), dbg.toggle_inspector_columns()]);
			assert.equal(dbg.inspectorColumns.isOpen, false, "rapid toggles must be serialized");
			assert.equal(dbg.inspector_columns_enabled, false);
		} finally {
			await dbg.set_inspector_columns_enabled(false);
			await config.update("closeEmptyGroups", previous, vscode.ConfigurationTarget.Global);
			await vscode.window.showTextDocument(doc);
			await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
		}
	});

	test("validates visibility messages and never treats them as node selection", async () => {
		const dbg = globals.debug;
		assert(dbg);
		const changed: string[] = [];
		const panels = new InspectorColumns(dbg.sceneTree, dbg.inspector, {
			inspect: async () => {
				throw new Error("Visibility must not select a node");
			},
			edit: async () => {},
			filter: () => {},
			refreshScene: () => {},
			refreshInspector: async () => {},
			visibility: async (node, visible) => {
				changed.push(`${node.object_id}:${visible}`);
			},
		});
		try {
			const button = new SceneNode("Button", "Button", 2n, [], undefined, 14);
			dbg.sceneTree.fill_tree(
				new SceneNode("root", "Viewport", 1n, [button, new SceneNode("Plain", "Node", 3n, [])]),
			);
			const row = panels.sceneRows()[0].children[0];
			assert(row.canChangeVisibility);
			assert.equal(row.visible, true);
			await panels.receive("scene", { type: "visibility", id: "2", visible: false });
			await panels.receive("scene", { type: "visibility", id: "2" });
			await panels.receive("scene", { type: "visibility", id: "2", visible: "false" });
			await panels.receive("scene", { type: "visibility", id: "1" });
			await panels.receive("scene", { type: "visibility", id: "3" });
			dbg.sceneTree.clear();
			await panels.receive("scene", { type: "visibility", id: "2" });
			assert.deepEqual(changed, ["2:false", "2:undefined"]);
		} finally {
			panels.dispose();
		}
	});

	test("shares filtered scene data, validates selected IDs and rejects removed nodes", async () => {
		const dbg = globals.debug;
		assert(dbg);
		const selected: SceneNode[] = [];
		const panels = new InspectorColumns(dbg.sceneTree, dbg.inspector, {
			inspect: async (node) => {
				if (node instanceof SceneNode) selected.push(node);
			},
			edit: async () => {},
			filter: (query) => dbg.set_scene_tree_filter(query),
			refreshScene: () => {},
			refreshInspector: async () => {},
		});
		try {
			const button = new SceneNode("PlayButton", "Button", 3n, []);
			dbg.sceneTree.fill_tree(
				new SceneNode("root", "Viewport", 1n, [
					new SceneNode("UI", "Control", 2n, [button]),
					new SceneNode("Player", "Node2D", 4n, []),
				]),
			);
			await panels.receive("scene", { type: "filter", query: "playbutton" });
			assert.equal(panels.sceneRows()[0].children.length, 1);
			assert.equal(panels.sceneRows()[0].children[0].children[0].path, "/root/UI/PlayButton");
			await panels.receive("scene", { type: "select", id: "3" });
			assert.deepEqual(selected, [button]);
			await panels.receive("scene", { type: "select", id: "../3" });
			await panels.receive("scene", { type: "select", id: "999" });
			dbg.sceneTree.clear();
			await panels.receive("scene", { type: "select", id: "3" });
			assert.equal(selected.length, 1);
			assert.deepEqual(panels.sceneRows(), []);
		} finally {
			panels.dispose();
		}
	});

	test("edits current properties and rejects stale property messages after clearing", async () => {
		const dbg = globals.debug;
		assert(dbg);
		const edited: string[] = [];
		const panels = new InspectorColumns(dbg.sceneTree, dbg.inspector, {
			inspect: async () => {},
			edit: async (property) => {
				edited.push(property.label);
			},
			filter: () => {},
			refreshScene: () => {},
			refreshInspector: async () => {},
		});
		try {
			dbg.inspector.fill_tree("Button", "Button", 10, { name: "", value: new Map([["text", "Play <safe>"]]) });
			const rows = panels.propertyRows();
			const text = rows[0].children[0];
			assert.equal(text.description, "Play <safe>");
			assert(text.editable);
			await panels.receive("properties", { type: "edit", id: text.id });
			assert.deepEqual(edited, ["text"]);
			dbg.inspector.clear();
			await panels.receive("properties", { type: "edit", id: text.id });
			assert.equal(edited.length, 1);
			assert.deepEqual(panels.propertyRows(), []);
		} finally {
			panels.dispose();
		}
	});
});
