import { strict as assert } from "node:assert";
import sinon from "sinon";
import { RemoteInspector } from "./remote_inspector";

suite("Remote Inspector requests", () => {
	test("coalesces pending requests, decodes categories, and fetches fresh values next time", async () => {
		const send = sinon.spy();
		const inspector = new RemoteInspector(send);
		const first = inspector.inspect(42n);
		assert.equal(inspector.inspect(42n), first);
		assert.equal(send.callCount, 1);
		inspector.resolve([
			42,
			"Button",
			[
				["Control", "", 0, "", 128, null],
				["visible", "", 0, "", 6, true],
			],
		]);
		assert.deepEqual((await first).sub_values, [{ name: "Control/visible", value: true }]);
		const next = inspector.inspect(42n);
		assert.equal(send.callCount, 2);
		inspector.resolve([42, "Button", [["Members/text", "", 0, "", 6, "Updated"]]]);
		assert.equal((await next).sub_values[0].value, "Updated");
	});

	test("handles full unsigned object IDs without losing precision", async () => {
		const inspector = new RemoteInspector(() => {});
		const id = (1n << 64n) - 1n;
		const result = inspector.inspect(id);
		inspector.resolve([-1n, "Object", []]);
		assert.equal((await result).godot_id, id);
	});

	test("rejects requests for removed nodes or disconnected games", async () => {
		const inspector = new RemoteInspector(() => {});
		const removed = assert.rejects(inspector.inspect(1n), /no longer exists/);
		inspector.resolve([]);
		await removed;
		const disconnected = assert.rejects(inspector.inspect(2n), /session has ended/);
		inspector.clear();
		await disconnected;
	});

	test("times out missing replies and permits retry", async () => {
		const clock = sinon.useFakeTimers();
		try {
			const inspector = new RemoteInspector(() => {}, 100);
			const timeout = assert.rejects(inspector.inspect(1n), /did not respond/);
			clock.tick(101);
			await timeout;
			const retry = inspector.inspect(1n);
			inspector.resolve([1, "Control", []]);
			assert.equal((await retry).type, "Control");
		} finally {
			clock.restore();
		}
	});
});
