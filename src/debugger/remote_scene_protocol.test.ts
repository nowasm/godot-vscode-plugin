import { strict as assert } from "node:assert";
import sinon from "sinon";
import { ServerController } from "./godot4/server_controller";
import { split_buffers as split3 } from "./godot3/helpers";
import { split_buffers as split4 } from "./godot4/helpers";
import { VariantDecoder as Decoder3 } from "./godot3/variables/variant_decoder";
import { VariantDecoder as Decoder4 } from "./godot4/variables/variant_decoder";

suite("Remote scene debugger protocol", () => {
	function controller(version: string) {
		const controller = new ServerController({} as any);
		controller.setProjectVersion(version);
		Object.assign(controller, { socket: { destroyed: false }, threadId: 0 });
		const send = sinon.stub(controller as any, "send_command");
		return { controller, send };
	}

	test("does not send native selection messages to Godot 4.3", () => {
		const { controller: c, send } = controller("4.3");
		assert.equal(c.highlight_node(12), false);
		assert.equal(send.callCount, 0);
	});

	test("uses single-object selection on Godot 4.4 and leaves game input enabled", () => {
		const { controller: c, send } = controller("4.4");
		c.highlight_node(12);
		assert(send.calledWith("scene:runtime_node_select_set_type", [0]));
		assert(send.calledWith("scene:inspect_object", [12n]));
		c.highlight_node(13);
		assert.equal(send.getCalls().filter((call) => call.args[0] === "scene:runtime_node_select_setup").length, 1);
		c.highlight_node();
		assert(send.calledWith("scene:runtime_node_select_set_visible", [false]));
		assert(!send.calledWith("scene:clear_selection"));
	});

	test("uses explicit selection and clearing on Godot 4.5+", () => {
		const { controller: c, send } = controller("4.6.2.stable");
		c.highlight_node(12);
		assert(send.calledWith("scene:inspect_objects", [[12n], true]));
		c.highlight_node(12, false);
		assert(send.calledWith("scene:runtime_node_select_set_visible", [false]));
		c.highlight_node();
		assert(send.calledWith("scene:clear_selection"));
	});

	test("coalesces outstanding scene requests and retries a missing reply", () => {
		const clock = sinon.useFakeTimers();
		try {
			const { controller: c, send } = controller("4.6.2");
			c.request_scene_tree();
			c.request_scene_tree();
			assert.equal(send.callCount, 1);
			clock.tick(5001);
			c.request_scene_tree();
			assert.equal(send.callCount, 2);
		} finally {
			clock.restore();
		}
	});

	for (const [name, split, Decoder] of [
		["Godot 3", split3, Decoder3],
		["Godot 4", split4, Decoder4],
	] as const) {
		test(`${name} buffers a fragmented packet header instead of throwing`, () => {
			const fragment = Buffer.from([20, 0]);
			assert.deepEqual(split(fragment), [fragment]);
			assert.equal(new Decoder().get_dataset(fragment), undefined);
			const complete = Buffer.alloc(8);
			complete.writeUInt32LE(4);
			const combined = Buffer.concat([complete, fragment]);
			assert.deepEqual(split(combined), [complete, fragment]);
		});
	}
});
