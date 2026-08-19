import * as vscode from "vscode";

import { HIGHLIGHT_CONFIG_PREFIX } from "../utils/extension_identity";
import { normalizeDecorationSettings, type FunctionDecorationSettings } from "./decoration_settings";
import type { FunctionHighlightingService } from "./highlighting_service";

function readSettings(): FunctionDecorationSettings {
	const configuration = vscode.workspace.getConfiguration(HIGHLIGHT_CONFIG_PREFIX);
	return normalizeDecorationSettings({
		enabled: configuration.get("enabled"),
		systemColor: configuration.get("systemColor"),
		projectColor: configuration.get("projectColor"),
		systemFontStyle: configuration.get("systemFontStyle"),
		projectFontStyle: configuration.get("projectFontStyle"),
	});
}

function styleOptions(
	color: string,
	style: FunctionDecorationSettings["systemFontStyle"],
): vscode.DecorationRenderOptions {
	return {
		color,
		fontWeight: style.includes("bold") ? "bold" : "normal",
		fontStyle: style.includes("italic") ? "italic" : "normal",
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
	};
}

export class FunctionOriginDecorations implements vscode.Disposable {
	private systemDecoration!: vscode.TextEditorDecorationType;
	private projectDecoration!: vscode.TextEditorDecorationType;
	private settings = readSettings();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly subscriptions: vscode.Disposable[] = [];

	constructor(
		private readonly service: FunctionHighlightingService,
		onFunctionDataChanged?: vscode.Event<void>,
	) {
		this.createDecorationTypes();
		this.subscriptions.push(
			vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.languageId === "gdscript") {
					this.schedule(event.document.uri.toString());
				}
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(HIGHLIGHT_CONFIG_PREFIX)) {
					this.settings = readSettings();
					this.createDecorationTypes();
					this.refreshAll();
				}
			}),
		);
		if (onFunctionDataChanged) {
			this.subscriptions.push(onFunctionDataChanged(() => this.refreshAll()));
		}
		this.refreshAll();
	}

	refreshAll(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			void this.updateEditor(editor);
		}
	}

	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		this.systemDecoration.dispose();
		this.projectDecoration.dispose();
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
	}

	private createDecorationTypes(): void {
		this.systemDecoration?.dispose();
		this.projectDecoration?.dispose();
		this.systemDecoration = vscode.window.createTextEditorDecorationType(
			styleOptions(this.settings.systemColor, this.settings.systemFontStyle),
		);
		this.projectDecoration = vscode.window.createTextEditorDecorationType(
			styleOptions(this.settings.projectColor, this.settings.projectFontStyle),
		);
	}

	private schedule(uri: string): void {
		const existing = this.timers.get(uri);
		if (existing) {
			clearTimeout(existing);
		}
		this.timers.set(
			uri,
			setTimeout(() => {
				this.timers.delete(uri);
				for (const editor of vscode.window.visibleTextEditors) {
					if (editor.document.uri.toString() === uri) {
						void this.updateEditor(editor);
					}
				}
			}, 120),
		);
	}

	private async updateEditor(editor: vscode.TextEditor): Promise<void> {
		if (editor.document.languageId !== "gdscript") {
			return;
		}
		if (!this.settings.enabled) {
			editor.setDecorations(this.systemDecoration, []);
			editor.setDecorations(this.projectDecoration, []);
			return;
		}
		const version = editor.document.version;
		const entries = await this.service.analyze({
			uri: editor.document.uri.toString(),
			version,
			text: editor.document.getText(),
		});
		if (editor.document.version !== version) {
			return;
		}
		const systemRanges: vscode.Range[] = [];
		const projectRanges: vscode.Range[] = [];
		for (const entry of entries) {
			const range = new vscode.Range(
				editor.document.positionAt(entry.token.start),
				editor.document.positionAt(entry.token.end),
			);
			(entry.classification.origin === "system" ? systemRanges : projectRanges).push(range);
		}
		editor.setDecorations(this.systemDecoration, systemRanges);
		editor.setDecorations(this.projectDecoration, projectRanges);
	}
}
