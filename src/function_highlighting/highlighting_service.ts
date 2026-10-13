import { classifyFunction, classifyFunctionWithLsp, classifyProperty, type FunctionClassification } from "./classifier";
import type { GodotApiIndex } from "./godot_api_index";
import type { LspCancellationToken, LspOriginResolver } from "./lsp_origin_resolver";
import type { ProjectSymbolIndex } from "./project_symbol_index";
import { scanFunctions, scanProperties } from "./scanner";
import type { FunctionToken, PropertyToken } from "./types";

export type FunctionSemanticTokenType = "godotSystemFunction" | "godotProjectFunction";
export const PROPERTY_SEMANTIC_TOKEN_TYPE = "godotSystemProperty";

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

export interface AnalyzedProperty {
	token: PropertyToken;
	owner: string;
}

function positionAt(text: string, offset: number): { line: number; character: number } {
	const before = text.slice(0, offset);
	const lines = before.split(/\r?\n/);
	return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
}

export class FunctionHighlightingService {
	private readonly cache = new Map<string, Promise<readonly AnalyzedFunction[]>>();
	private readonly propertyCache = new Map<string, readonly AnalyzedProperty[]>();

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

	analyzeProperties(document: HighlightDocument): readonly AnalyzedProperty[] {
		if (!this.project.getScript(document.uri)) this.project.update(document.uri, document.text);
		const key = `${document.uri}:${document.version}`;
		const existing = this.propertyCache.get(key);
		if (existing) return existing;
		const context = { uri: document.uri, api: this.api, project: this.project };
		const properties = scanProperties(document.text).flatMap((token) => {
			const owner = classifyProperty(token, context);
			return owner ? [{ token, owner }] : [];
		});
		this.propertyCache.set(key, properties);
		return properties;
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
			this.propertyCache.clear();
			this.resolver?.clear();
			return;
		}
		for (const key of this.cache.keys()) {
			if (key.startsWith(`${uri}:`)) {
				this.cache.delete(key);
			}
		}
		for (const key of this.propertyCache.keys()) {
			if (key.startsWith(`${uri}:`)) this.propertyCache.delete(key);
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
