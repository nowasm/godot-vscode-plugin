import { deepStrictEqual, strictEqual } from "node:assert";

import {
	DEFAULT_PROJECT_EXCLUDES,
	ProjectIndexService,
	type ProjectWorkspaceAdapter,
	type WorkspaceScriptDocument,
} from "./project_index_service";
import { ProjectSymbolIndex } from "./project_symbol_index";

class FakeWorkspace implements ProjectWorkspaceAdapter {
	readonly documents = new Map<string, WorkspaceScriptDocument>();
	requestedExcludes: readonly string[] = [];
	private changeListener?: (document: WorkspaceScriptDocument) => void;
	private deleteListener?: (uri: string) => void;

	async findGDScriptFiles(excludes: readonly string[]): Promise<string[]> {
		this.requestedExcludes = excludes;
		return [...this.documents.keys()];
	}

	async readDocument(uri: string): Promise<WorkspaceScriptDocument> {
		const document = this.documents.get(uri);
		if (!document) {
			throw new Error(`missing ${uri}`);
		}
		return document;
	}

	watch(onChange: (document: WorkspaceScriptDocument) => void, onDelete: (uri: string) => void) {
		this.changeListener = onChange;
		this.deleteListener = onDelete;
		return { dispose() {} };
	}

	emitChange(document: WorkspaceScriptDocument) {
		this.changeListener?.(document);
	}

	emitDelete(uri: string) {
		this.deleteListener?.(uri);
	}
}

suite("ProjectIndexService", () => {
	test("loads workspace files using default exclusions", async () => {
		const workspace = new FakeWorkspace();
		workspace.documents.set("res://player.gd", {
			uri: "res://player.gd",
			text: "class_name Player\nfunc move(): pass\n",
			version: 1,
		});
		const index = new ProjectSymbolIndex();
		const service = new ProjectIndexService(index, workspace);

		await service.initialize();

		deepStrictEqual(workspace.requestedExcludes, DEFAULT_PROJECT_EXCLUDES);
		strictEqual(index.resolveClassMethod("Player", "move")?.uri, "res://player.gd");
		service.dispose();
	});

	test("ignores stale versions and handles deletes", async () => {
		const workspace = new FakeWorkspace();
		const index = new ProjectSymbolIndex();
		const service = new ProjectIndexService(index, workspace);
		await service.initialize();

		workspace.emitChange({
			uri: "res://changing.gd",
			text: "class_name Changing\nfunc newest(): pass\n",
			version: 4,
		});
		workspace.emitChange({
			uri: "res://changing.gd",
			text: "class_name Changing\nfunc stale(): pass\n",
			version: 3,
		});

		strictEqual(index.resolveClassMethod("Changing", "newest")?.uri, "res://changing.gd");
		strictEqual(index.resolveClassMethod("Changing", "stale"), undefined);
		workspace.emitDelete("res://changing.gd");
		strictEqual(index.resolveClassMethod("Changing", "newest"), undefined);
		service.dispose();
	});
});
