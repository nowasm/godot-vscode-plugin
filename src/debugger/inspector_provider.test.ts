import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { globals } from "../extension";
import { ObjectId as SharedObjectId } from "./debug_runtime";
import { ObjectId as Object3, RawObject as Raw3 } from "./godot3/variables/variants";
import { ObjectId as Object4, RID } from "./godot4/variables/variants";
import type { InspectedObject, RemoteProperty } from "./inspector_provider";

function object(className: string, entries: [string, any][]): InspectedObject {
	const value = new Raw3(className);
	for (const [name, property] of entries) value.set(name, property);
	return { className, variable: { name: "", value } };
}

suite("Inspector object reference expansion", () => {
	let dbg: NonNullable<typeof globals.debug>;
	let original: (typeof dbg)["inspect_object"];
	const calls: bigint[] = [];
	let load: (id: bigint) => Promise<InspectedObject>;
	const fill = (entries: [string, any][], id = 1n) => {
		const data = object("Control", entries);
		dbg.inspector.fill_tree("UI", data.className, id, data.variable);
		return dbg.inspector.get_top_item() as RemoteProperty;
	};

	suiteSetup(async () => {
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
		assert(globals.debug);
		dbg = globals.debug;
	});
	setup(() => {
		calls.length = 0;
		original = dbg.inspect_object;
		load = async () =>
			object("Resource", [
				["health", 42],
				["name", "Detailed object"],
			]);
		dbg.inspect_object = async (id) => {
			calls.push(id);
			return load(id);
		};
	});
	teardown(() => {
		dbg.inspector.clear();
		dbg.inspect_object = original;
	});

	for (const [version, ObjectType] of [
		["Godot 3", Object3],
		["Godot 4", Object4],
		["shared", SharedObjectId],
	] as const) {
		test(`${version} objects inside arrays and dictionaries expand inline with the correct property owner`, async () => {
			const id = 9007199254740999n;
			const root = fill([["items", [new Map([["reference", new ObjectType(id)]])]]]);
			const reference = root.properties[0].properties[0].properties[0];
			assert.equal(reference.contextValue, "remote_object");
			assert.equal(reference.object_id, id);
			assert.equal(reference.loadState, "unloaded");
			assert.deepEqual(calls, [], "building rows must not eagerly fetch the object graph");
			const rows = dbg.inspectorColumns.propertyRows();
			await dbg.inspectorColumns.receive("properties", {
				type: "expand",
				id: rows[0].children[0].children[0].children[0].id,
			});
			assert.equal(dbg.inspector.get_top_item(), root, "expansion must keep the selected node");
			assert.deepEqual(calls, [id]);
			assert.equal(reference.description, `Resource<${id}>`);
			assert.deepEqual(
				reference.properties.map((property) => property.label),
				["health", "name"],
			);
			assert.equal(reference.properties[0].object_id, id);
			assert.equal(reference.properties[0].contextValue, "editable_value");
			assert.equal(reference.properties[0].parent, reference);
		});
	}

	test("coalesces simultaneous references and sidebar expansion also loads properties", async () => {
		let resolve!: (data: InspectedObject) => void;
		load = () =>
			new Promise((res) => {
				resolve = res;
			});
		const root = fill([
			["first", new Object3(9n)],
			["second", new Object4(9n)],
		]);
		const [first, second] = root.properties;
		dbg.inspector.getChildren(first);
		const pending = dbg.inspector.expand_object(second);
		await Promise.resolve();
		assert.deepEqual(calls, [9n]);
		assert.equal(first.loadState, "loading");
		assert.equal(second.loadState, "loading");
		resolve(object("Resource", [["count", 7]]));
		await pending;
		await first.loading;
		assert.equal(first.properties[0].value, 7);
		assert.equal(second.properties[0].value, 7);
		assert.notEqual(first.properties[0], second.properties[0], "each path needs its own parent links");
	});

	test("does not inspect null objects or RIDs", () => {
		const root = fill([
			["empty3", new Object3(0n)],
			["empty4", new Object4(0n)],
			["nil", null],
			["rid", new RID(9n)],
		]);
		for (const property of root.properties.slice(0, 3)) {
			assert.equal(property.description, "null");
			assert.equal(property.collapsibleState, vscode.TreeItemCollapsibleState.None);
		}
		assert.notEqual(root.properties[3].contextValue, "remote_object");
		assert.deepEqual(calls, []);
	});

	test("stops circular paths without fetching ancestors again", async () => {
		load = async () =>
			object("Resource", [
				["self", new Object3(9n)],
				["owner", new Object4(1n)],
			]);
		const root = fill([["resource", new Object3(9n)]]);
		const reference = root.properties[0];
		await dbg.inspector.expand_object(reference);
		for (const cycle of reference.properties) {
			await dbg.inspector.expand_object(cycle);
			assert.match(cycle.properties[0].label, /Circular reference/);
			assert.equal(cycle.properties[0].contextValue, undefined);
		}
		assert.deepEqual(calls, [9n]);
	});

	test("keeps released-object errors inside the branch and allows a retry", async () => {
		load = async () => {
			throw new Error("The remote object no longer exists.");
		};
		const root = fill([["resource", new Object3(9n)]]);
		const reference = root.properties[0];
		await dbg.inspector.expand_object(reference);
		assert.equal(reference.loadState, "error");
		assert.match(reference.properties[0].label, /no longer exists/);
		assert.equal(dbg.inspector.get_top_item(), root);
		load = async () => object("Resource", [["reloaded", true]]);
		await dbg.inspector.expand_object(reference);
		assert.equal(reference.properties[0].label, "reloaded");
		assert.equal(reference.loadState, "loaded");
	});

	for (const clear of [false, true]) {
		test(`discards a pending result after ${clear ? "disconnect" : "selecting another node"}`, async () => {
			let resolve!: (data: InspectedObject) => void;
			load = () =>
				new Promise((res) => {
					resolve = res;
				});
			const reference = fill([["resource", new Object3(9n)]]).properties[0];
			const pending = dbg.inspector.expand_object(reference);
			await Promise.resolve();
			if (clear) dbg.inspector.clear();
			else fill([["new_value", 88]], 2n);
			resolve(object("Resource", [["stale", true]]));
			await pending;
			assert(!reference.properties.some((property) => property.label === "stale"));
			assert.equal(dbg.inspector.get_top_item()?.properties[0].label, clear ? undefined : "new_value");
		});
	}
});
