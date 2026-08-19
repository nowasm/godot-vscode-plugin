import { ok, strictEqual } from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

import { globals } from "../extension";

suite("GodParty workspace smoke", () => {
	test("classifies representative production GDScript without changing the project", async () => {
		const extension = vscode.extensions.getExtension("godparty.godparty-godot-tools");
		ok(extension);
		await extension.activate();
		const runtime = globals.functionHighlightingRuntime;
		ok(runtime);
		if (runtime.status.kind === "indexing") {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("Function index did not become ready")), 30_000);
				const subscription = runtime.onDidStatusChange((status) => {
					if (status.kind !== "indexing") {
						clearTimeout(timer);
						subscription.dispose();
						resolve();
					}
				});
			});
		}

		const folder = vscode.workspace.workspaceFolders?.[0];
		ok(folder);
		const document = await vscode.workspace.openTextDocument(
			vscode.Uri.file(path.join(folder.uri.fsPath, "scenes", "boot.gd")),
		);
		const entries = await runtime.service.analyze({
			uri: document.uri.toString(),
			version: document.version,
			text: document.getText(),
		});
		ok(entries && entries.length > 20);
		const find = (name: string, kind: "declaration" | "call", receiver?: string) =>
			entries.find(
				(entry) =>
					entry.token.name === name &&
					entry.token.kind === kind &&
					(receiver === undefined || entry.token.receiver === receiver),
			);

		strictEqual(find("_ready", "declaration")?.classification.reason, "native_virtual_override");
		strictEqual(find("preload", "call")?.classification.origin, "system");
		strictEqual(find("print", "call")?.classification.origin, "system");
		strictEqual(find("_should_open_font_compare", "call")?.classification.origin, "project");
		strictEqual(find("change_scene", "call", "SceneTransition")?.classification.reason, "autoload_receiver");

		const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
			"vscode.provideDocumentSemanticTokens",
			document.uri,
		);
		ok(tokens.data.length > 20);
		const commands = await vscode.commands.getCommands(true);
		strictEqual(commands.includes("godotTools.openEditor"), true);
		strictEqual(commands.includes("godotTools.debugger.debugCurrentFile"), true);
	});
});
