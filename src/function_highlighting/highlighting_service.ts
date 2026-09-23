import { classifyFunction, classifyFunctionWithLsp, type FunctionClassification } from "./classifier";
import type { GodotApiIndex } from "./godot_api_index";
import type { LspCancellationToken, LspOriginResolver } from "./lsp_origin_resolver";
import type { ProjectSymbolIndex } from "./project_symbol_index";
import { scanFunctions } from "./scanner";
import type { FunctionToken } from "./types";

export type FunctionSemanticTokenType = "godotSystemFunction" | "godotProjectFunction";

export interface HighlightDocument {
	uri: string;
	version: number;
	text: string;
}

export interface AnalyzedFunction {
	token: FunctionToken;
	classification: FunctionClassification;
	tokenType: FunctionSemanticTokenType;
}

function positionAt(text: string, offset: number): { line: number; character: number } {
	const before = text.slice(0, offset);
	const lines = before.split(/\r?\n/);
	return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
}

export class FunctionHighlightingService {
	private readonly cache = new Map<string, Promise<readonly AnalyzedFunction[]>>();

	constructor(
		private api: GodotApiIndex,
		readonly project: ProjectSymbolIndex,
		private readonly resolver?: LspOriginResolver,
	) {}

	setApi(api: GodotApiIndex): void {
		this.api = api;
		this.invalidate();
	}

	analyze(document: HighlightDocument, cancellation?: LspCancellationToken): Promise<readonly AnalyzedFunction[]> {
		if (!this.project.getScript(document.uri)) {
			this.project.update(document.uri, document.text);
		}
		const key = `${document.uri}:${document.version}`;
		const existing = this.cache.get(key);
		if (existing) {
			return existing;
		}
		const pending = this.analyzeUncached(document, cancellation);
		this.cache.set(key, pending);
		return pending;
	}

	async classificationAt(
		document: HighlightDocument,
		offset: number,
		cancellation?: LspCancellationToken,
	): Promise<AnalyzedFunction | undefined> {
		return (await this.analyze(document, cancellation)).find(
			(entry) => offset >= entry.token.start && offset < entry.token.end,
		);
	}

	invalidate(uri?: string): void {
		if (!uri) {
			this.cache.clear();
			this.resolver?.clear();
			return;
		}
		for (const key of this.cache.keys()) {
			if (key.startsWith(`${uri}:`)) {
				this.cache.delete(key);
			}
		}
		this.resolver?.clear(uri);
	}

	private async analyzeUncached(
		document: HighlightDocument,
		cancellation?: LspCancellationToken,
	): Promise<readonly AnalyzedFunction[]> {
		const tokens = scanFunctions(document.text);
		const context = { uri: document.uri, api: this.api, project: this.project };
		return Promise.all(
			tokens.map(async (token) => {
				let classification = classifyFunction(token, context);
				if (
					this.resolver &&
					classification.reason === "unresolved_defaults_to_project" &&
					!cancellation?.isCancellationRequested
				) {
					const position = positionAt(document.text, token.start);
					classification = await classifyFunctionWithLsp(
						token,
						context,
						this.resolver,
						{
							uri: document.uri,
							version: document.version,
							offset: token.start,
							...position,
						},
						cancellation,
					);
				}
				return {
					token,
					classification,
					tokenType: classification.origin === "system" ? "godotSystemFunction" : "godotProjectFunction",
				} as AnalyzedFunction;
			}),
		);
	}
}
