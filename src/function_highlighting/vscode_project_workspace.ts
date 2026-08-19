import * as vscode from "vscode";

import type { DisposableLike, ProjectWorkspaceAdapter, WorkspaceScriptDocument } from "./project_index_service";

function toDocument(document: vscode.TextDocument): WorkspaceScriptDocument {
	return {
		uri: document.uri.toString(),
		text: document.getText(),
		version: document.version,
	};
}

export class VsCodeProjectWorkspaceAdapter implements ProjectWorkspaceAdapter {
	async findGDScriptFiles(excludes: readonly string[]): Promise<string[]> {
		const exclude = excludes.length > 0 ? `{${excludes.join(",")}}` : undefined;
		return (await vscode.workspace.findFiles("**/*.gd", exclude)).map((uri) => uri.toString());
	}

	async readDocument(uri: string): Promise<WorkspaceScriptDocument> {
		return toDocument(await vscode.workspace.openTextDocument(vscode.Uri.parse(uri)));
	}

	watch(onChange: (document: WorkspaceScriptDocument) => void, onDelete: (uri: string) => void): DisposableLike {
		const watcher = vscode.workspace.createFileSystemWatcher("**/*.gd");
		const updateFromUri = async (uri: vscode.Uri) => {
			try {
				onChange(toDocument(await vscode.workspace.openTextDocument(uri)));
			} catch {
				// A file can disappear between a watcher event and opening it.
			}
		};
		return vscode.Disposable.from(
			watcher,
			watcher.onDidCreate(updateFromUri),
			watcher.onDidChange(updateFromUri),
			watcher.onDidDelete((uri) => onDelete(uri.toString())),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.languageId === "gdscript") {
					onChange(toDocument(event.document));
				}
			}),
		);
	}
}
