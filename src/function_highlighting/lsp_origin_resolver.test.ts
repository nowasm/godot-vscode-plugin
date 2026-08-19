import { strictEqual } from "node:assert";

import { LspOriginResolver, type LspRequestClient } from "./lsp_origin_resolver";

class FakeClient implements LspRequestClient {
	readonly calls: string[] = [];
	definition: unknown;
	hover: unknown;
	error?: Error;

	async sendRequest(method: string): Promise<unknown> {
		this.calls.push(method);
		if (this.error) {
			throw this.error;
		}
		return method === "textDocument/definition" ? this.definition : this.hover;
	}
}

suite("LspOriginResolver", () => {
	test("recognizes project definitions and caches by document version", async () => {
		const client = new FakeClient();
		client.definition = [{ uri: "file:///workspace/player.gd" }];
		const resolver = new LspOriginResolver(client, {
			isWorkspaceUri: (uri) => uri.startsWith("file:///workspace/"),
			getDocumentVersion: () => 7,
		});
		const request = { uri: "file:///workspace/caller.gd", version: 7, offset: 12, line: 1, character: 3 };

		strictEqual((await resolver.resolve(request))?.origin, "project");
		strictEqual((await resolver.resolve(request))?.origin, "project");
		strictEqual(client.calls.length, 1);
	});

	test("extracts native owners from Godot documentation locations", async () => {
		const client = new FakeClient();
		client.definition = { targetUri: "gddoc:/Node.gddoc#add_child" };
		const resolver = new LspOriginResolver(client, {
			isWorkspaceUri: () => false,
			getDocumentVersion: () => 2,
		});

		const result = await resolver.resolve({
			uri: "file:///workspace/caller.gd",
			version: 2,
			offset: 4,
			line: 0,
			character: 4,
		});
		strictEqual(result?.origin, "system");
		strictEqual(result?.owner, "Node");
	});

	test("rejects stale results and converts request failures to no refinement", async () => {
		const client = new FakeClient();
		client.definition = { uri: "gddoc:/Node.gddoc" };
		let version = 3;
		const resolver = new LspOriginResolver(client, {
			isWorkspaceUri: () => false,
			getDocumentVersion: () => version,
		});
		version = 4;
		strictEqual(
			await resolver.resolve({ uri: "file:///a.gd", version: 3, offset: 1, line: 0, character: 1 }),
			undefined,
		);

		client.error = new Error("LSP unavailable");
		strictEqual(
			await resolver.resolve({ uri: "file:///a.gd", version: 4, offset: 2, line: 0, character: 2 }),
			undefined,
		);
	});
});
