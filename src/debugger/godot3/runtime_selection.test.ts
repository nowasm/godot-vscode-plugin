import { strict as assert } from "node:assert";
import * as net from "node:net";
import * as vscode from "vscode";
import { globals } from "../../extension";
import { get_free_port } from "../../utils";
import { GodotDebugSession } from "./debug_session";
import { DebugChannelV2, DebugEnvelopeV2, DebugPacketStreamV2, encodeEnvelopeV2 } from "./protocol_v2";

async function until(check: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for the simulated v2 engine");
}

suite("Godot 3 native selection capability", () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension("godparty.godparty-godot-tools")?.activate();
	});

	async function engine(controlCapability: boolean, dataCapability: boolean, legacyHello = false) {
		const dbg = globals.debug;
		assert(dbg);
		const session = new GodotDebugSession();
		session.sceneTree = dbg.sceneTree;
		session.inspector = dbg.inspector;
		const port = await get_free_port();
		await session.controller.attach({ address: "127.0.0.1", port } as any);
		const requests: DebugEnvelopeV2[] = [];
		const sockets = [DebugChannelV2.Control, DebugChannelV2.Data].map((channel) => {
			const socket = net.connect(port, "127.0.0.1");
			const stream = new DebugPacketStreamV2();
			let sequence = 1n;
			socket.on("data", (chunk) => {
				for (const message of stream.push(chunk)) {
					requests.push(message);
					if (message.type === "scene_snapshot" || message.type === "runtime_node_select") {
						socket.write(
							encodeEnvelopeV2({
								...message,
								sequence: ++sequence,
								type: `${message.type}_result`,
								payload:
									message.type === "scene_snapshot"
										? [1n, [0, "root", "Viewport", 1n]]
										: [message.payload[0], "2d"],
							}),
						);
					}
				}
			});
			socket.on("connect", () => {
				const enabled = channel === DebugChannelV2.Control ? controlCapability : dataCapability;
				const payload: any[] = [123, 250, 100];
				if (!legacyHello) payload.push(enabled ? ["runtime_node_select"] : []);
				socket.write(
					encodeEnvelopeV2({
						sessionId: 123n,
						generation: 1,
						channel,
						sequence: 1n,
						requestId: 1n,
						stopId: 0n,
						type: channel === DebugChannelV2.Control ? "control_hello" : "data_hello",
						payload,
					}),
				);
			});
			return socket;
		});
		await until(() => session.controller.is_connected);
		return {
			controller: session.controller,
			requests,
			close: () => {
				for (const socket of sockets) socket.destroy();
				session.dispose();
				dbg.sceneTree.clear();
			},
		};
	}

	test("old engines keep scene inspection without receiving unsupported selection requests", async () => {
		const peer = await engine(false, false, true);
		try {
			assert.equal(peer.controller.supports_node_highlight, false);
			assert.equal(peer.controller.highlight_node(42n), false);
			await until(() => peer.requests.some((message) => message.type === "scene_snapshot"));
			assert(!peer.requests.some((message) => message.type === "runtime_node_select"));
		} finally {
			peer.close();
		}
	});

	test("requires matching capabilities from both channels", async () => {
		const peer = await engine(true, false);
		try {
			assert.equal(peer.controller.supports_node_highlight, false);
			assert.equal(peer.controller.highlight_node(42n), false);
		} finally {
			peer.close();
		}
	});

	test("new engines receive running select, hide and clear requests with no breakpoint stop ID", async () => {
		const peer = await engine(true, true);
		try {
			assert(peer.controller.supports_node_highlight);
			assert(peer.controller.highlight_node(42n));
			assert(peer.controller.highlight_node(42n, false));
			assert(peer.controller.highlight_node());
			await until(() => peer.requests.filter((message) => message.type === "runtime_node_select").length === 3);
			const selections = peer.requests.filter((message) => message.type === "runtime_node_select");
			assert.deepEqual(
				selections.map((message) => message.payload),
				[
					[42n, true],
					[42n, false],
					[0n, false],
				],
			);
			assert(selections.every((message) => message.stopId === 0n));
		} finally {
			peer.close();
		}
	});
});
