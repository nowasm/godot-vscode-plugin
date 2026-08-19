import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { get_configuration, get_project_dir, get_project_version, verify_godot_version } from "../utils";
import { createLogger } from "../utils";
import { HIGHLIGHT_CONFIG_PREFIX } from "../utils/extension_identity";
import { FunctionHighlightingService } from "./highlighting_service";
import { GodotApiIndex } from "./godot_api_index";
import { loadGodotApi } from "./godot_api_loader";
import { LspOriginResolver, type LspRequestClient } from "./lsp_origin_resolver";
import { DEFAULT_PROJECT_EXCLUDES, ProjectIndexService } from "./project_index_service";
import { ProjectSymbolIndex } from "./project_symbol_index";
import type { FunctionIndexStatus } from "./status";
import { VsCodeProjectWorkspaceAdapter } from "./vscode_project_workspace";

const log = createLogger("function_highlighting.runtime");

export class FunctionHighlightingRuntime implements vscode.Disposable {
	readonly project = new ProjectSymbolIndex();
	readonly service: FunctionHighlightingService;

	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;
	private readonly statusEmitter = new vscode.EventEmitter<FunctionIndexStatus>();
	readonly onDidStatusChange = this.statusEmitter.event;
	status: FunctionIndexStatus = { kind: "indexing" };
	private readonly projectService: ProjectIndexService;

	constructor(
		private readonly context: vscode.ExtensionContext,
		lspClient: LspRequestClient,
	) {
		const bundledSnapshotPath = vscode.Uri.joinPath(
			context.extensionUri,
			"resources",
			"godot_api",
			"godot-4.6.json",
		).fsPath;
		const fallbackApi = GodotApiIndex.fromJson(fs.readFileSync(bundledSnapshotPath, "utf8"));
		const resolver = new LspOriginResolver(lspClient, {
			isWorkspaceUri: (uri) => {
				try {
					return vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(uri)) !== undefined;
				} catch {
					return false;
				}
			},
			getDocumentVersion: (uri) =>
				vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri)?.version,
		});
		this.service = new FunctionHighlightingService(fallbackApi, this.project, resolver);
		this.projectService = new ProjectIndexService(
			this.project,
			new VsCodeProjectWorkspaceAdapter(),
			undefined,
			(uri) => {
				this.service.invalidate(uri);
				this.changeEmitter.fire();
			},
		);
	}

	async initialize(): Promise<void> {
		this.setStatus({ kind: "indexing" });
		try {
			const configuredExcludes = vscode.workspace
				.getConfiguration(HIGHLIGHT_CONFIG_PREFIX)
				.get<string[]>("exclude", []);
			this.projectService.setExcludes([...new Set([...DEFAULT_PROJECT_EXCLUDES, ...configuredExcludes])]);
			await this.projectService.initialize();
			await this.loadAutoloads();
			this.service.invalidate();
			this.changeEmitter.fire();
		} catch (error) {
			log.warn(`Could not build project function index: ${String(error)}`);
		}

		const bundledSnapshotPath = vscode.Uri.joinPath(
			this.context.extensionUri,
			"resources",
			"godot_api",
			"godot-4.6.json",
		).fsPath;
		try {
			const projectVersion = await get_project_version();
			const settingName = `editorPath.godot${projectVersion?.[0] ?? "4"}`;
			const configuredPath = get_configuration(settingName);
			const verification =
				typeof configuredPath === "string" && projectVersion
					? verify_godot_version(configuredPath, projectVersion[0])
					: undefined;
			const result = await loadGodotApi({
				cacheDir: path.join(this.context.globalStorageUri.fsPath, "godot-api"),
				bundledSnapshotPath,
				godotPath: verification?.status === "SUCCESS" ? verification.godotPath : undefined,
				godotVersion: verification?.status === "SUCCESS" ? verification.version : projectVersion,
			});
			this.service.setApi(result.index);
			this.changeEmitter.fire();
			this.setStatus(
				result.source === "fallback"
					? { kind: "fallback", version: result.index.version }
					: { kind: "ready", version: result.index.version },
			);
			log.info(`Function API index ready: ${result.index.version} (${result.source})`);
			if (result.warning) {
				log.warn(result.warning);
			}
		} catch (error) {
			log.warn(`Using bundled function API index: ${String(error)}`);
			this.setStatus({ kind: "error", message: String(error) });
		}
	}

	dispose(): void {
		this.projectService.dispose();
		this.changeEmitter.dispose();
		this.statusEmitter.dispose();
	}

	refresh(): void {
		this.service.invalidate();
		this.changeEmitter.fire();
	}

	private setStatus(status: FunctionIndexStatus): void {
		this.status = status;
		this.statusEmitter.fire(status);
	}

	private async loadAutoloads(): Promise<void> {
		const projectDir = await get_project_dir();
		if (!projectDir) {
			return;
		}
		const projectFile = path.join(projectDir, "project.godot");
		const source = await fs.promises.readFile(projectFile, "utf8");
		const pattern = /^([A-Za-z_]\w*)\s*=\s*["']\*?(res:\/\/[^"']+\.gd)["']/gm;
		for (const match of source.matchAll(pattern)) {
			const filePath = path.join(projectDir, match[2].slice("res://".length));
			this.project.setAutoload(match[1], vscode.Uri.file(filePath).toString());
		}
	}
}
