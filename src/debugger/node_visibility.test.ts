import { strict as assert } from "node:assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { globals } from "../extension";
import { GodotDebugSession } from "./godot3/debug_session";
import type { InspectedObject } from "./inspector_provider";
import { SceneNode } from "./scene_tree_provider";

suite("Runtime node visibility writes", () => {
	let dbg: NonNullable<typeof globals.debug>;
	let originalSession: typeof dbg.session;
	let inspect: sinon.SinonStub;
	let write: sinon.SinonStub;
	let button: SceneNode;
	const object = (visible: any): InspectedObject => ({
		className: "Button",
		variable: { name: "", value: new Map([["visible", visible]]) },
	});
	suiteSetup(async () => {
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
		assert(globals.debug);
		dbg = globals.debug;
	});
	setup(() => {
		originalSession = dbg.session;
		const session = new GodotDebugSession();
		sinon.stub(session.controller, "is_connected").get(() => true);
		write = sinon.stub(session.controller, "write_object_property").resolves();
		dbg.session = session;
		inspect = sinon.stub(dbg, "inspect_object");
		sinon.stub(dbg, "refresh_scene_tree");
		button = new SceneNode("Button", "Button", 2n, [], undefined, 6);
		dbg.sceneTree.fill_tree(new SceneNode("root", "Viewport", 1n, [button]));
	});
	teardown(() => {
		sinon.restore();
		dbg.session = originalSession;
		dbg.sceneTree.clear();
		dbg.inspector.clear();
	});

	test("toggles the real local state and coalesces repeated clicks", async () => {
		inspect.onFirstCall().resolves(object(true));
		inspect.onSecondCall().resolves(object(false));
		const pending = dbg.set_node_visibility(button);
		assert.equal(dbg.set_node_visibility(button), pending);
		assert(button.visibility_pending);
		await pending;
		assert(write.calledOnceWithExactly(2n, "visible", false));
		assert.equal(button.visibility_pending, false);
	});
	test("rejects unsupported property data and clears the busy indicator", async () => {
		inspect.resolves(object("true"));
		await assert.rejects(dbg.set_node_visibility(button), /boolean visible/);
		assert.equal(write.callCount, 0);
		assert.equal(button.visibility_pending, false);
	});
	test("reports a script overriding the requested value", async () => {
		inspect.resolves(object(true));
		await assert.rejects(dbg.set_node_visibility(button, false), /did not keep/);
		assert.equal(button.visibility_pending, false);
	});
	test("does not write after the active session changes", async () => {
		let resolve!: (value: InspectedObject) => void;
		inspect.returns(
			new Promise<InspectedObject>((res) => {
				resolve = res;
			}),
		);
		const pending = dbg.set_node_visibility(button, false);
		dbg.session = undefined;
		dbg.sceneTree.clear();
		resolve(object(true));
		await pending;
		assert.equal(write.callCount, 0);
	});
	test("ignores root, plain and removed nodes", async () => {
		const root = dbg.sceneTree.getChildren()[0];
		await dbg.set_node_visibility(root, false);
		dbg.sceneTree.fill_tree(new SceneNode("root", "Viewport", 1n, [new SceneNode("Plain", "Node", 3n, [])]));
		await dbg.set_node_visibility(dbg.sceneTree.find_node(3n) as SceneNode, false);
		await dbg.set_node_visibility(button, false);
		assert.equal(inspect.callCount, 0);
		assert.equal(write.callCount, 0);
	});
});
