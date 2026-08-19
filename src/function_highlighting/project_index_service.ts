import type { ProjectSymbolIndex } from "./project_symbol_index";

export const DEFAULT_PROJECT_EXCLUDES = [
	"**/.godot/**",
	"**/.git/**",
	"**/build/**",
	"**/dist/**",
] as const;

export interface WorkspaceScriptDocument {
	uri: string;
	text: string;
	version: number;
}

export interface DisposableLike {
	dispose(): void;
}

export interface ProjectWorkspaceAdapter {
	findGDScriptFiles(excludes: readonly string[]): Promise<string[]>;
	readDocument(uri: string): Promise<WorkspaceScriptDocument>;
	watch(
		onChange: (document: WorkspaceScriptDocument) => void,
		onDelete: (uri: string) => void,
	): DisposableLike;
}

export class ProjectIndexService implements DisposableLike {
	private readonly versions = new Map<string, number>();
	private watcher?: DisposableLike;

	constructor(
		readonly index: ProjectSymbolIndex,
		private readonly workspace: ProjectWorkspaceAdapter,
		private readonly excludes: readonly string[] = DEFAULT_PROJECT_EXCLUDES,
	) {}

	async initialize(): Promise<void> {
		const uris = await this.workspace.findGDScriptFiles(this.excludes);
		for (const uri of uris) {
			this.applyDocument(await this.workspace.readDocument(uri));
		}
		this.watcher?.dispose();
		this.watcher = this.workspace.watch(
			(document) => this.applyDocument(document),
			(uri) => this.removeDocument(uri),
		);
	}

	applyDocument(document: WorkspaceScriptDocument): boolean {
		const currentVersion = this.versions.get(document.uri);
		if (currentVersion !== undefined && document.version < currentVersion) {
			return false;
		}
		this.index.update(document.uri, document.text);
		this.versions.set(document.uri, document.version);
		return true;
	}

	removeDocument(uri: string): void {
		this.versions.delete(uri);
		this.index.remove(uri);
	}

	dispose(): void {
		this.watcher?.dispose();
		this.watcher = undefined;
	}
}

