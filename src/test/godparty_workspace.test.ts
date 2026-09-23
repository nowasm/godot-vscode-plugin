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
		strictEqual(find("create_timer", "call", "get_tree()")?.classification.owner, "SceneTree");
		strictEqual(find("is_empty", "call", "spectate_room")?.classification.owner, "String");

		const safeArea = await vscode.workspace.openTextDocument(
			vscode.Uri.file(path.join(folder.uri.fsPath, "src", "ui", "common", "safe_area.gd")),
		);
		const safeAreaEntries = await runtime.service.analyze({
			uri: safeArea.uri.toString(),
			version: safeArea.version,
			text: safeArea.getText(),
		});
		const safeAreaCall = (name: string) =>
			safeAreaEntries?.find((entry) => entry.token.kind === "call" && entry.token.name === name);
		strictEqual(safeAreaCall("is_connected")?.classification.owner, "Signal");
		strictEqual(safeAreaCall("connect")?.classification.owner, "Signal");
		strictEqual(safeAreaCall("_refit")?.classification.origin, "project");
		const safeAreaSemantic = await vscode.commands.executeCommand<vscode.SemanticTokens>(
			"vscode.provideDocumentSemanticTokens",
			safeArea.uri,
		);
		ok(safeAreaSemantic);
		const hasSystemTokenAt = (document: vscode.TextDocument, tokens: vscode.SemanticTokens, name: string) => {
			const expected = document.positionAt(document.getText().indexOf(`${name}(`));
			let line = 0;
			let character = 0;
			for (let offset = 0; offset < tokens.data.length; offset += 5) {
				line += tokens.data[offset];
				character = tokens.data[offset] === 0 ? character + tokens.data[offset + 1] : tokens.data[offset + 1];
				if (line === expected.line && character === expected.character && tokens.data[offset + 3] === 2) {
					return true;
				}
			}
			return false;
		};
		strictEqual(hasSystemTokenAt(safeArea, safeAreaSemantic, "is_connected"), true);
		strictEqual(hasSystemTokenAt(safeArea, safeAreaSemantic, "connect"), true);

		const loadingScreen = await vscode.workspace.openTextDocument(
			vscode.Uri.file(path.join(folder.uri.fsPath, "src", "ui", "tex", "loading_screen.gd")),
		);
		const loadingEntries = await runtime.service.analyze({
			uri: loadingScreen.uri.toString(),
			version: loadingScreen.version,
			text: loadingScreen.getText(),
		});
		strictEqual(
			loadingEntries.find((entry) => entry.token.name === "is_connected" && entry.token.receiver === "get_viewport().size_changed")
				?.classification.owner,
			"Signal",
		);
		strictEqual(
			loadingEntries.find((entry) => entry.token.name === "connect" && entry.token.receiver === "NetworkManager.room_joined")
				?.classification.owner,
			"Signal",
		);

		const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
			"vscode.provideDocumentSemanticTokens",
			document.uri,
		);
		ok(tokens.data.length > 20);
		strictEqual(hasSystemTokenAt(document, tokens, "is_empty"), true);
		const commands = await vscode.commands.getCommands(true);
		strictEqual(commands.includes("godotTools.openEditor"), true);
		strictEqual(commands.includes("godotTools.debugger.debugCurrentFile"), true);
	});
});
