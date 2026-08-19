import * as vscode from "vscode";
import {
	Uri,
	Position,
	Range,
	TextDocument,
	CancellationToken,
	ExtensionContext,
	DocumentSemanticTokensProvider,
	SemanticTokens,
	SemanticTokensLegend,
	SemanticTokensBuilder,
	EventEmitter,
	Event,
} from "vscode";
import { createLogger } from "../utils";
import { HIGHLIGHT_CONFIG_PREFIX } from "../utils/extension_identity";
import type { FunctionHighlightingService } from "../function_highlighting";

const log = createLogger("providers.tokens");

export class GDSemanticTokensProvider implements DocumentSemanticTokensProvider {
	private readonly changeEmitter = new EventEmitter<void>();
	readonly onDidChangeSemanticTokens: Event<void> = this.changeEmitter.event;

	private legend = new SemanticTokensLegend(
		[
			"nodePath",
			"%",
			"godotSystemFunction",
			"godotProjectFunction",
		],
		["test"],
	);

	constructor(
		private context: ExtensionContext,
		private readonly functionService: FunctionHighlightingService,
		onFunctionDataChanged?: Event<void>,
	) {
		const selector = [
			{ language: "gdresource", scheme: "file" },
			{ language: "gdscene", scheme: "file" },
			{ language: "gdscript", scheme: "file" },
		];

		context.subscriptions.push(
			vscode.languages.registerDocumentSemanticTokensProvider(selector, this, this.legend),
			this.changeEmitter,
		);
		if (onFunctionDataChanged) {
			context.subscriptions.push(
				onFunctionDataChanged(() => this.changeEmitter.fire()),
			);
		}
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(HIGHLIGHT_CONFIG_PREFIX)) {
					this.changeEmitter.fire();
				}
			}),
		);
	}

	async provideDocumentSemanticTokens(document: TextDocument, token: CancellationToken): Promise<SemanticTokens> {
		log.debug("provideDocumentSemanticTokens");
		const builder = new SemanticTokensBuilder(this.legend);
		const text = document.getText();

		const pattern = /(?<=(?:get_node|has_node|find_node|get_node_or_null|has_node_and_resource)\(\s?)(("|')((?!\2).)*\2)(?=\s?\))/g;
		for (const match of text.matchAll(pattern)) {
			const r = this.create_range(document, match);
			builder.push(r, "nodePath", []);
		}

		if (
			document.languageId === "gdscript" &&
			vscode.workspace
				.getConfiguration(HIGHLIGHT_CONFIG_PREFIX)
				.get("enabled", true)
		) {
			try {
				const functions = await this.functionService.analyze(
					{
						uri: document.uri.toString(),
						version: document.version,
						text,
					},
					token,
				);
				for (const entry of functions) {
					builder.push(
						new Range(
							document.positionAt(entry.token.start),
							document.positionAt(entry.token.end),
						),
						entry.tokenType,
						[],
					);
				}
			} catch (error) {
				log.warn(`Could not classify GDScript functions: ${String(error)}`);
			}
		}

		return builder.build();
	}

	private create_range(document: TextDocument, match: RegExpMatchArray) {
		const startIndex = match.index ?? 0;
		const start = document.positionAt(startIndex);
		const end = document.positionAt(startIndex + match[0].length);
		const r = new Range(start, end);
		return r;
	}
}
