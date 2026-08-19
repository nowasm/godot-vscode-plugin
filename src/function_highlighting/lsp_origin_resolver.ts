export interface LspRequestClient {
	sendRequest(method: string, params: unknown): Promise<unknown>;
}

export interface LspCancellationToken {
	readonly isCancellationRequested: boolean;
}

export interface LspOriginRequest {
	uri: string;
	version: number;
	offset: number;
	line: number;
	character: number;
}

export interface LspOriginResolution {
	origin: "system" | "project";
	owner?: string;
}

export interface LspOriginResolverOptions {
	isWorkspaceUri(uri: string): boolean;
	getDocumentVersion(uri: string): number | undefined;
}

function definitionUris(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.flatMap(definitionUris);
	}
	if (!value || typeof value !== "object") {
		return [];
	}
	const location = value as { uri?: unknown; targetUri?: unknown };
	return [location.uri, location.targetUri].filter((uri): uri is string => typeof uri === "string");
}

function documentationOwner(uri: string): string | undefined {
	if (!uri.startsWith("gddoc:")) {
		return undefined;
	}
	const match = decodeURIComponent(uri).match(/\/([^/#]+)\.gddoc(?:#|$)/);
	return match?.[1];
}

function hoverText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(hoverText).join("\n");
	}
	if (!value || typeof value !== "object") {
		return "";
	}
	const object = value as { contents?: unknown; value?: unknown };
	return hoverText(object.contents ?? object.value);
}

export class LspOriginResolver {
	private readonly cache = new Map<string, Promise<LspOriginResolution | undefined>>();

	constructor(
		private readonly client: LspRequestClient,
		private readonly options: LspOriginResolverOptions,
	) {}

	resolve(request: LspOriginRequest, cancellation?: LspCancellationToken): Promise<LspOriginResolution | undefined> {
		if (cancellation?.isCancellationRequested || this.options.getDocumentVersion(request.uri) !== request.version) {
			return Promise.resolve(undefined);
		}
		const key = `${request.uri}:${request.version}:${request.offset}`;
		const existing = this.cache.get(key);
		if (existing) {
			return existing;
		}
		const pending = this.resolveUncached(request, cancellation);
		this.cache.set(key, pending);
		return pending;
	}

	clear(uri?: string): void {
		if (!uri) {
			this.cache.clear();
			return;
		}
		for (const key of this.cache.keys()) {
			if (key.startsWith(`${uri}:`)) {
				this.cache.delete(key);
			}
		}
	}

	private async resolveUncached(
		request: LspOriginRequest,
		cancellation?: LspCancellationToken,
	): Promise<LspOriginResolution | undefined> {
		const params = {
			textDocument: { uri: request.uri },
			position: { line: request.line, character: request.character },
		};
		try {
			const definition = await this.client.sendRequest("textDocument/definition", params);
			if (!this.isCurrent(request, cancellation)) {
				return undefined;
			}
			for (const uri of definitionUris(definition)) {
				if (uri.endsWith(".gd") && this.options.isWorkspaceUri(uri)) {
					return { origin: "project" };
				}
				const owner = documentationOwner(uri);
				if (owner) {
					return { origin: "system", owner };
				}
			}

			const hover = await this.client.sendRequest("textDocument/hover", params);
			if (!this.isCurrent(request, cancellation)) {
				return undefined;
			}
			const owner = hoverText(hover).match(/\b(?:native\s+class|class)\s+([A-Za-z_]\w*)/)?.[1];
			return owner ? { origin: "system", owner } : undefined;
		} catch {
			return undefined;
		}
	}

	private isCurrent(request: LspOriginRequest, cancellation?: LspCancellationToken): boolean {
		return (
			!cancellation?.isCancellationRequested && this.options.getDocumentVersion(request.uri) === request.version
		);
	}
}
