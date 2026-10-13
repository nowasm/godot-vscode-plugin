import { ok, strictEqual } from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

import { globals } from "../extension";

const EXTENSION_ID = "godparty.godparty-godot-tools";
const TOGGLE_COMMAND = "godpartyGodotTools.functionHighlight.toggle";
const REBUILD_COMMAND = "godpartyGodotTools.functionHighlight.rebuildIndex";

suite("GodParty function highlighting in VS Code", () => {
	test("activates and contributes settings and commands", async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		ok(extension, `Extension ${EXTENSION_ID} was not loaded`);
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		strictEqual(commands.includes(TOGGLE_COMMAND), true);
		strictEqual(commands.includes(REBUILD_COMMAND), true);
		const config = vscode.workspace.getConfiguration("godpartyGodotTools.functionHighlight");
		strictEqual(config.get("enabled"), true);
		strictEqual(config.get("systemColor"), "#4FC3F7");
		strictEqual(config.get("propertyColor"), "#C792EA");
		strictEqual(config.get("projectColor"), "#FFD166");
	});

	test("provides semantic tokens and origin hover in a real document", async () => {
		await globals.functionHighlightingRuntime?.initialize();
		const folder = vscode.workspace.workspaceFolders?.[0];
		ok(folder);
		const document = await vscode.workspace.openTextDocument(
			vscode.Uri.file(path.join(folder.uri.fsPath, "system_and_project.gd")),
		);
		await vscode.window.showTextDocument(document);

		const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
			"vscode.provideDocumentSemanticTokens",
			document.uri,
		);
		ok(tokens.data.length >= 5, "Expected function-origin semantic tokens");

		const rangeOffset = document.getText().indexOf("range(");
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			"vscode.executeHoverProvider",
			document.uri,
			document.positionAt(rangeOffset + 1),
		);
		const hoverText = hovers
			.flatMap((hover) => hover.contents)
			.map((content) => (typeof content === "string" ? content : content.value))
			.join("\n");
		ok(hoverText.includes("GodParty function origin"));
		ok(hoverText.includes("Godot system"));
	});

	test("provides a distinct semantic token for engine properties", async () => {
		await globals.functionHighlightingRuntime?.initialize();
		const folder = vscode.workspace.workspaceFolders?.[0];
		ok(folder);
		const document = await vscode.workspace.openTextDocument(
			vscode.Uri.file(path.join(folder.uri.fsPath, "engine_property.gd")),
		);
		const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
			"vscode.provideDocumentSemanticTokens",
			document.uri,
		);
		const propertyLine = document.positionAt(document.getText().indexOf("size = other.size")).line;
		let line = 0;
		let character = 0;
		let propertyTokens = 0;
		for (let index = 0; index < tokens.data.length; index += 5) {
			line += tokens.data[index];
			character = tokens.data[index] ? tokens.data[index + 1] : character + tokens.data[index + 1];
			if (line === propertyLine && tokens.data[index + 2] === 4 && tokens.data[index + 3] === 4) {
				propertyTokens++;
			}
		}
		strictEqual(propertyTokens, 2);
	});

	test("toggles highlighting at workspace scope", async () => {
		await vscode.commands.executeCommand(TOGGLE_COMMAND);
		strictEqual(vscode.workspace.getConfiguration("godpartyGodotTools.functionHighlight").get("enabled"), false);
		await vscode.commands.executeCommand(TOGGLE_COMMAND);
		strictEqual(vscode.workspace.getConfiguration("godpartyGodotTools.functionHighlight").get("enabled"), true);
	});
});
