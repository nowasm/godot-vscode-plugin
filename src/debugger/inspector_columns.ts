import { randomBytes } from "node:crypto";
import {
	commands,
	Disposable,
	env,
	EventEmitter,
	TabInputText,
	Uri,
	ViewColumn,
	Webview,
	WebviewPanel,
	window,
} from "vscode";
import { get_extension_uri, set_context } from "../utils";
import { InspectorProvider, RemoteProperty } from "./inspector_provider";
import { SceneNode, SceneTreeProvider } from "./scene_tree_provider";

type ColumnKind = "scene" | "properties";

export interface InspectorColumnActions {
	inspect(node: SceneNode | RemoteProperty): Promise<void>;
	edit(property: RemoteProperty): Promise<void>;
	filter(query: string): void;
	refreshScene(): void;
	refreshInspector(): Promise<void>;
	highlight?(enabled: boolean): void;
}

export interface ColumnRow {
	id: string;
	label: string;
	description: string;
	path?: string;
	hidden?: boolean;
	icon?: string;
	editable?: boolean;
	inspectable?: boolean;
	loadState?: RemoteProperty["loadState"];
	children: ColumnRow[];
}

/** Editor presentations of the existing debug providers; they never own remote state. */
export class InspectorColumns implements Disposable {
	private panels = new Map<ColumnKind, WebviewPanel>();
	private subscriptions: Disposable[] = [];
	private properties = new Map<string, RemoteProperty>();
	private opening?: Promise<void>;
	private selectedId?: string;
	private connected = false;
	private canHighlight = false;
	private highlightEnabled = true;
	private visibilityEvent = new EventEmitter<void>();
	public onDidChangeVisibility = this.visibilityEvent.event;

	constructor(
		private scene: SceneTreeProvider,
		private inspector: InspectorProvider,
		private actions: InspectorColumnActions,
	) {
		set_context("debugger.sceneColumnOpen", false);
		set_context("debugger.propertiesColumnOpen", false);
		this.subscriptions.push(
			scene.onDidChangeTreeData(() => this.update("scene")),
			inspector.onDidChangeTreeData(() => this.update("properties")),
		);
	}

	public get sceneVisible() {
		return this.panels.get("scene")?.visible === true;
	}

	public open(): Promise<void> {
		if (!this.opening) {
			this.opening = this.openColumns().finally(() => {
				this.opening = undefined;
			});
		}
		return this.opening;
	}

	private async openColumns() {
		if (this.panels.size === 2) {
			for (const panel of this.panels.values()) panel.reveal(undefined, true);
			return;
		}
		if (window.tabGroups.all.length + 2 - this.panels.size > 9) {
			void window.showWarningMessage("Close an editor group before opening the Godot inspector columns.");
			return;
		}
		const previousEditor = window.activeTextEditor;
		const singleSourceGroup = this.panels.size === 0 && window.tabGroups.all.length === 1;
		if (!this.panels.size) {
			await commands.executeCommand("workbench.action.focusFirstEditorGroup");
			await commands.executeCommand("workbench.action.newGroupLeft");
			this.createPanel("scene");
			await commands.executeCommand("workbench.action.lockEditorGroup");
			await commands.executeCommand("workbench.action.newGroupRight");
			this.createPanel("properties");
			await commands.executeCommand("workbench.action.lockEditorGroup");
		} else if (this.panels.has("scene")) {
			this.panels.get("scene")?.reveal(undefined, false);
			await commands.executeCommand("workbench.action.newGroupRight");
			this.createPanel("properties");
			await commands.executeCommand("workbench.action.lockEditorGroup");
		} else {
			this.panels.get("properties")?.reveal(undefined, false);
			await commands.executeCommand("workbench.action.newGroupLeft");
			this.createPanel("scene");
			await commands.executeCommand("workbench.action.lockEditorGroup");
		}
		if (singleSourceGroup) {
			await commands.executeCommand("vscode.setEditorLayout", {
				orientation: 0,
				groups: [{ size: 0.24 }, { size: 0.28 }, { size: 0.48 }],
			});
		}
		if (previousEditor) {
			const group = window.tabGroups.all.find((group) =>
				group.tabs.some(
					(tab) =>
						tab.input instanceof TabInputText &&
						tab.input.uri.toString() === previousEditor.document.uri.toString(),
				),
			);
			await window.showTextDocument(previousEditor.document, {
				viewColumn: group?.viewColumn,
				selection: previousEditor.selection,
			});
		}
		this.actions.refreshScene();
	}

	private createPanel(kind: ColumnKind) {
		const panel = window.createWebviewPanel(
			`godotTools.${kind === "scene" ? "remoteSceneColumn" : "nodePropertiesColumn"}`,
			kind === "scene" ? "Godot Scene Tree" : "Godot Inspector",
			ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					get_extension_uri("media", "remote-inspector"),
					get_extension_uri("resources", "godot_icons"),
				],
			},
		);
		panel.iconPath = get_extension_uri("resources", "godot_icon.svg");
		this.panels.set(kind, panel);
		set_context(`debugger.${kind === "scene" ? "scene" : "properties"}ColumnOpen`, true);
		const subscriptions = [
			panel.webview.onDidReceiveMessage((message) => {
				void this.receive(kind, message).catch((error) => {
					void window.showErrorMessage(
						`Godot Inspector: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
			}),
			panel.onDidChangeViewState(() => {
				this.update(kind);
				this.visibilityEvent.fire();
			}),
			panel.onDidDispose(() => {
				this.panels.delete(kind);
				for (const subscription of subscriptions) subscription.dispose();
				set_context(`debugger.${kind === "scene" ? "scene" : "properties"}ColumnOpen`, false);
				this.visibilityEvent.fire();
			}),
		];
		panel.webview.html = this.html(panel.webview, kind);
		this.visibilityEvent.fire();
	}

	public setConnected(connected: boolean) {
		this.connected = connected;
		this.update("scene");
		this.update("properties");
	}

	public select(node?: SceneNode) {
		this.selectedId = node?.object_id.toString();
		this.update("scene");
	}

	public setHighlight(available: boolean, enabled: boolean) {
		if (this.canHighlight === available && this.highlightEnabled === enabled) return;
		this.canHighlight = available;
		this.highlightEnabled = enabled;
		this.update("scene");
	}

	public sceneRows(webview?: Webview): ColumnRow[] {
		const visit = (node: SceneNode): ColumnRow => ({
			id: node.object_id.toString(),
			label: node.label,
			description: node.class_name,
			path: node.node_path,
			hidden: node.is_hidden,
			icon: webview
				?.asWebviewUri(
					Uri.joinPath(get_extension_uri("resources", "godot_icons", "dark"), `${node.class_name}.svg`),
				)
				.toString(),
			children: this.scene.getChildren(node).map(visit),
		});
		return this.scene.getChildren().map(visit);
	}

	public propertyRows(): ColumnRow[] {
		this.properties.clear();
		const visit = (property: RemoteProperty, id: string): ColumnRow => {
			this.properties.set(id, property);
			return {
				id,
				label: property.label,
				description: String(property.description ?? ""),
				editable: property.contextValue === "editable_value",
				inspectable: property.contextValue === "remote_object",
				loadState: property.loadState,
				children: property.properties.map((child, index) => visit(child, `${id}/${index}:${child.label}`)),
			};
		};
		return this.inspector.getChildren().map((root) => visit(root, `${root.object_id}:${root.label}`));
	}

	private update(kind: ColumnKind) {
		const panel = this.panels.get(kind);
		if (!panel) return;
		void panel.webview.postMessage({
			type: "snapshot",
			kind,
			connected: this.connected,
			revision: this.inspector.revision,
			rows: kind === "scene" ? this.sceneRows(panel.webview) : this.propertyRows(),
			filter: this.scene.filter,
			selectedId: this.selectedId,
			selectedPath: this.selectedId ? this.scene.find_node(BigInt(this.selectedId))?.node_path : undefined,
			canHighlight: this.canHighlight,
			highlightEnabled: this.highlightEnabled,
		});
	}

	/** Only opaque IDs from the current model can initiate debugger actions. */
	public async receive(kind: ColumnKind, message: unknown) {
		if (!message || typeof message !== "object") return;
		const { type, id, query, enabled } = message as {
			type?: unknown;
			id?: unknown;
			query?: unknown;
			enabled?: unknown;
		};
		if (type === "ready") this.update(kind);
		else if (type === "refresh") {
			if (kind === "scene") this.actions.refreshScene();
			else await this.actions.refreshInspector();
		} else if (type === "filter" && kind === "scene" && typeof query === "string") {
			this.actions.filter(query.slice(0, 1024));
		} else if (type === "highlight" && kind === "scene" && this.canHighlight && typeof enabled === "boolean") {
			this.actions.highlight?.(enabled);
		} else if (typeof id === "string") {
			if (kind === "scene" && /^\d{1,20}$/.test(id)) {
				const node = this.scene.find_node(BigInt(id));
				if (!node) return;
				if (type === "select") await this.actions.inspect(node);
				else if (type === "copyPath") await env.clipboard.writeText(node.node_path);
			} else if (kind === "properties") {
				this.propertyRows();
				const property = this.properties.get(id);
				if (!property) return;
				if (type === "edit" && property.contextValue === "editable_value") await this.actions.edit(property);
				else if (type === "expand" && property.contextValue === "remote_object")
					await this.inspector.expand_object(property);
				else if (type === "inspect" && property.contextValue === "remote_object")
					await this.actions.inspect(property);
			}
		}
	}

	private html(webview: Webview, kind: ColumnKind) {
		const nonce = randomBytes(18).toString("base64");
		const asset = (name: string) => webview.asWebviewUri(get_extension_uri("media", "remote-inspector", name));
		return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset("columns.css")}"></head>
<body data-kind="${kind}">
<header><div class="heading"><span id="title">${kind === "scene" ? "SCENE TREE" : "NODE PROPERTIES"}</span><span id="count"></span>
<div class="tools"><button id="highlight" hidden title="Toggle selected node outline" aria-label="Toggle selected node outline" aria-pressed="true">◎</button><button id="collapse" title="Collapse all branches" aria-label="Collapse all branches">⊟</button><button id="refresh" title="Refresh" aria-label="Refresh">↻</button></div></div>
<div class="search"><input id="search" type="search" placeholder="${kind === "scene" ? "Search name, type or path" : "Filter properties"}" aria-label="${kind === "scene" ? "Search scene tree" : "Filter properties"}"></div>
<div id="selection" title="Selected node path"></div></header>
<main id="tree" role="tree" aria-label="${kind === "scene" ? "Runtime scene tree" : "Node properties"}" tabindex="0"></main>
<div id="empty"></div><footer id="status" role="status"></footer>
<script nonce="${nonce}" src="${asset("columns.js")}"></script></body></html>`;
	}

	public close() {
		for (const panel of [...this.panels.values()]) panel.dispose();
	}

	public dispose() {
		this.close();
		for (const subscription of this.subscriptions) subscription.dispose();
		this.visibilityEvent.dispose();
	}
}
