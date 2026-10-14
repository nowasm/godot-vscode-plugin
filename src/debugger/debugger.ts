import * as fs from "node:fs";
import { InvalidatedEvent } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import {
	CancellationToken,
	DebugAdapterDescriptor,
	DebugAdapterDescriptorFactory,
	DebugAdapterInlineImplementation,
	DebugConfiguration,
	DebugConfigurationProvider,
	DebugSession,
	env,
	EventEmitter,
	ExtensionContext,
	FileDecoration,
	FileDecorationProvider,
	ProviderResult,
	Uri,
	WorkspaceFolder,
	debug,
	window,
	workspace,
} from "vscode";
import { createLogger, get_configuration, get_project_version, register_command, set_context } from "../utils";
import { GodotVariable } from "./debug_runtime";
import { GodotDebugSession as Godot3DebugSession } from "./godot3/debug_session";
import { GodotDebugSession as Godot4DebugSession } from "./godot4/debug_session";
import { GodotDebugSessionV2 as Godot4DebugSessionV2 } from "./godot4/debug_session_v2";
import { GodotObject } from "./godot4/variables/godot_object_promise";
import { InspectorProvider, RemoteProperty } from "./inspector_provider";
import { SceneNode, SceneTreeProvider } from "./scene_tree_provider";

const log = createLogger("debugger", { output: "Godot Debugger" });

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	debug_protocol_v2?: boolean;
	address: string;
	port: number;
	project: string;
	scene: string;
	editor_path: string;
	profiling: boolean;
	single_threaded_scene: boolean;
	debug_collisions: boolean;
	debug_paths: boolean;
	debug_navigation: boolean;
	debug_avoidance: boolean;
	debug_stringnames: boolean;
	frame_delay: number;
	time_scale: number;
	disable_vsync: boolean;
	fixed_fps: number;
	additional_options: string;
}

export interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	debug_protocol_v2?: boolean;
	address: string;
	port: number;
	project: string;
	scene: string;
	additional_options: string;
}

export let pinnedScene: Uri | undefined;

class GDFileDecorationProvider implements FileDecorationProvider {
	private emitter = new EventEmitter<Uri>();
	onDidChangeFileDecorations = this.emitter.event;

	update(uri: Uri) {
		this.emitter.fire(uri);
	}

	provideFileDecoration(uri: Uri, token: CancellationToken): FileDecoration | undefined {
		if (uri.scheme !== "file") return undefined;
		if (pinnedScene !== undefined && uri.fsPath === pinnedScene.fsPath) {
			return {
				badge: "🖈",
			};
		}
	}
}

export class GodotDebugger implements DebugAdapterDescriptorFactory, DebugConfigurationProvider {
	public session?: Godot3DebugSession | Godot4DebugSession | Godot4DebugSessionV2;
	public sceneTree = new SceneTreeProvider();
	public inspector = new InspectorProvider();

	fileDecorations = new GDFileDecorationProvider();
	private sceneTreeRefreshTimer?: NodeJS.Timeout;
	private activeSessionId?: string;
	private selectedNodeId?: number | bigint;
	private inspectionGeneration = 0;
	private highlightEnabled = get_configuration("debugger.highlightSelectedNode", true);

	constructor(private context: ExtensionContext) {
		log.info("Initializing Godot Debugger");

		this.restore_pinned_file();
		set_context("debugger.highlightEnabled", this.highlightEnabled);

		context.subscriptions.push(
			debug.registerDebugConfigurationProvider("godot", this),
			debug.registerDebugAdapterDescriptorFactory("godot", this),
			window.registerFileDecorationProvider(this.fileDecorations),
			register_command("debugger.inspectNode", this.inspect_node.bind(this)),
			register_command("debugger.refreshSceneTree", this.refresh_scene_tree.bind(this)),
			register_command("debugger.refreshInspector", this.refresh_inspector.bind(this)),
			register_command("debugger.filterSceneTree", this.filter_scene_tree.bind(this)),
			register_command("debugger.clearSceneTreeFilter", () => this.set_scene_tree_filter("")),
			register_command("debugger.enableNodeHighlight", () => this.set_node_highlight(true)),
			register_command("debugger.disableNodeHighlight", () => this.set_node_highlight(false)),
			register_command("debugger.clearNodeHighlight", this.clear_node_highlight.bind(this)),
			register_command("debugger.copyRemoteNodePath", (node: SceneNode) =>
				env.clipboard.writeText(node.node_path),
			),
			register_command("debugger.editValue", this.edit_value.bind(this)),
			register_command("debugger.debugCurrentFile", this.debug_current_file.bind(this)),
			register_command("debugger.debugPinnedFile", this.debug_pinned_file.bind(this)),
			register_command("debugger.pinFile", this.pinFile.bind(this)),
			register_command("debugger.unpinFile", this.unpinFile.bind(this)),
			register_command("debugger.openPinnedFile", this.open_pinned_file.bind(this)),
			this.inspector.view,
			this.sceneTree,
			this.sceneTree.view.onDidChangeVisibility(() => {
				if (this.sceneTree.view.visible) this.refresh_scene_tree();
			}),
			this.sceneTree.onDidUpdateTree(() => {
				set_context(
					"debugger.canHighlight",
					this.session instanceof Godot4DebugSession && this.session.controller.supports_node_highlight,
				);
				if (this.selectedNodeId !== undefined && !this.sceneTree.find_node(this.selectedNodeId)) {
					this.clear_node_highlight();
					this.inspector.clear();
					this.inspectionGeneration++;
				}
			}),
			workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("godotTools.debugger.sceneTreeRefreshInterval"))
					this.start_scene_tree_refresh();
				if (event.affectsConfiguration("godotTools.debugger.highlightSelectedNode")) {
					this.set_node_highlight(get_configuration("debugger.highlightSelectedNode", true));
				}
			}),
			debug.onDidTerminateDebugSession((session) => {
				if (session.id !== this.activeSessionId) return;
				this.stop_scene_tree_refresh();
				this.session = undefined;
				this.activeSessionId = undefined;
				this.selectedNodeId = undefined;
				this.inspectionGeneration++;
				this.sceneTree.clear();
				this.inspector.clear();
				set_context("debugger.canHighlight", false);
			}),
			{ dispose: () => this.stop_scene_tree_refresh() },
		);
	}

	public async createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor> {
		log.info("Creating debug session");
		const projectVersion = await get_project_version();
		log.info(`Project version identified as ${projectVersion}`);

		if (projectVersion?.startsWith("4")) {
			this.session =
				session.configuration.debug_protocol_v2 === true
					? new Godot4DebugSessionV2()
					: new Godot4DebugSession(projectVersion);
		} else {
			this.session = new Godot3DebugSession();
		}
		this.context.subscriptions.push(this.session);

		this.session.sceneTree = this.sceneTree;
		this.session.inspector = this.inspector;

		this.sceneTree.clear();
		this.inspector.clear();
		this.selectedNodeId = undefined;
		this.inspectionGeneration++;
		this.activeSessionId = session.id;
		set_context("debugger.canHighlight", false);
		this.start_scene_tree_refresh();

		return new DebugAdapterInlineImplementation(this.session);
	}

	public resolveDebugConfiguration(
		folder: WorkspaceFolder | undefined,
		config: DebugConfiguration,
		token?: CancellationToken,
	): ProviderResult<DebugConfiguration> {
		// request is actually a required field according to vscode
		// however, setting it here lets us catch a possible misconfiguration
		if (!config.request) {
			config.request = "launch";
		}

		if (config.request === "launch") {
			if (!config.address) {
				config.address = "127.0.0.1";
			}
			if (!config.port) {
				config.port = -1;
			}
			if (!config.project) {
				config.project = "${workspaceFolder}";
			}
		}

		if (typeof config.port !== "number" || config.port < -1 || config.port > 65535) {
			window.showErrorMessage("Can't launch debug session: 'port' must be a number between -1 and 65535.", "Ok");
			return undefined;
		}

		if (config.address.includes("://")) {
			window.showErrorMessage("Can't launch debug session: 'address' cannot include a protocol.", "Ok");
			return undefined;
		}

		return config;
	}

	public debug_current_file() {
		log.info("Attempting to debug current file");
		const configs: DebugConfiguration[] =
			workspace.getConfiguration("launch", window.activeTextEditor?.document.uri).get("configurations") || [];
		const launches = configs.filter((c) => c.request === "launch");
		const currents = configs.filter((c) => c.scene === "current");

		let path = window.activeTextEditor?.document.fileName;
		if (path?.endsWith(".gd")) {
			const scenePath = path.replace(".gd", ".tscn");
			if (!fs.existsSync(scenePath)) {
				const message = `Can't launch debug session: no associated scene for '${path}'. (Script and scene file must have the same name.)`;
				log.warn(message);
				window.showWarningMessage(message);
				return;
			}
			path = scenePath;
		}

		const default_config = {
			name: `Debug ${path} : 'File'}`,
			type: "godot",
			request: "launch",
			scene: "current",
		};

		const config = currents[0] ?? launches[0] ?? configs[0] ?? default_config;
		config.scene = path;

		log.info(`Starting debug session for '${path}'`);
		debug.startDebugging(workspace.workspaceFolders?.[0], config);
	}

	public debug_pinned_file() {
		log.info("Attempting to debug pinned scene");
		const configs: DebugConfiguration[] =
			workspace.getConfiguration("launch", pinnedScene).get("configurations") || [];
		const launches = configs.filter((c) => c.request === "launch");
		const currents = configs.filter((c) => c.scene === "pinned");

		if (!pinnedScene) {
			log.warn("No pinned scene found, aborting debug");
			window.showWarningMessage("No pinned scene found");
			return;
		}
		let path = pinnedScene.fsPath;
		if (path.endsWith(".gd")) {
			const scenePath = path.replace(".gd", ".tscn");
			if (!fs.existsSync(scenePath)) {
				log.warn(`Can't find associated scene for '${path}', aborting debug`);
				window.showWarningMessage(`Can't find associated scene file for '${path}'`);
				return;
			}
			path = scenePath;
		}
		const default_config = {
			name: `Debug ${path} : 'File'}`,
			type: "godot",
			request: "launch",
			scene: "pinned",
		};

		const config = currents[0] ?? launches[0] ?? configs[0] ?? default_config;
		config.scene = path;

		log.info(`Starting debug session for '${path}'`);
		debug.startDebugging(workspace.workspaceFolders?.[0], config);
	}

	public pinFile(uri: Uri | undefined) {
		let _uri = uri;
		if (uri === undefined) {
			_uri = window.activeTextEditor?.document.uri;
		}
		if (_uri === undefined) {
			window.showWarningMessage("No active editor. Open a file to pin it.");
			return;
		}
		log.info(`Pinning debug target file: '${_uri.fsPath}'`);
		set_context("pinnedScene", [_uri.fsPath]);
		if (pinnedScene) {
			this.fileDecorations.update(pinnedScene);
		}
		pinnedScene = _uri;
		this.context.workspaceState.update("pinnedScene", pinnedScene);
		this.fileDecorations.update(_uri);
	}

	public unpinFile(uri: Uri) {
		log.info(`Unpinning debug target file: '${pinnedScene}'`);
		set_context("pinnedScene", []);
		const previousPinnedScene = pinnedScene;
		pinnedScene = undefined;
		this.context.workspaceState.update("pinnedScene", pinnedScene);
		if (previousPinnedScene) {
			this.fileDecorations.update(previousPinnedScene);
		}
	}

	public restore_pinned_file() {
		pinnedScene = this.context.workspaceState.get<Uri>("pinnedScene");
		if (pinnedScene) {
			log.info(`Restoring pinned debug target file: '${pinnedScene.fsPath}'`);
			set_context("pinnedScene", [pinnedScene.fsPath]);
		}
	}

	public open_pinned_file() {
		log.info(`Opening pinned debug target file: '${pinnedScene}'`);
		if (pinnedScene) {
			window.showTextDocument(pinnedScene);
		}
	}

	public async inspect_node(element: SceneNode | RemoteProperty) {
		if (!element || !this.session?.controller.is_connected) return;
		if (element instanceof SceneNode) {
			this.selectedNodeId = element.object_id;
			this.update_node_highlight();
		}
		await this.fill_inspector(element);
	}

	private async fill_inspector(element: SceneNode | RemoteProperty, force_refresh = false) {
		const session = this.session;
		const generation = ++this.inspectionGeneration;
		if (element.object_id === undefined || !session?.controller.is_connected) {
			return;
		}

		if (session instanceof Godot4DebugSession) {
			try {
				const godot_object = await (session.variables_manager
					? session.variables_manager.get_godot_object(BigInt(element.object_id), force_refresh)
					: session.controller.remote_inspector.inspect(BigInt(element.object_id)));
				if (generation !== this.inspectionGeneration || session !== this.session) return;
				const va = this.create_godot_variable(godot_object);
				this.inspector.fill_tree(element.label, godot_object.type, Number(godot_object.godot_id), va);
			} catch (error) {
				if (generation !== this.inspectionGeneration || session !== this.session) return;
				log.warn("Unable to inspect remote node", error);
				this.inspector.clear();
				this.inspector.view.message =
					error instanceof Error ? error.message : "Unable to inspect the remote node.";
			}
		} else {
			session.inspect_callbacks.set(BigInt(element.object_id), (class_name, variable) => {
				if (generation !== this.inspectionGeneration || session !== this.session) return;
				this.inspector.fill_tree(element.label, class_name, Number(element.object_id), variable);
			});
			session.controller.request_inspect_object(BigInt(element.object_id));
		}
	}

	private create_godot_variable(godot_object: GodotObject): GodotVariable {
		return {
			value: {
				type_name: () => godot_object.type,
				stringify_value: () => `<${godot_object.godot_id}>`,
				sub_values: () => godot_object.sub_values,
			},
		} as GodotVariable;
	}

	public refresh_scene_tree() {
		this.session?.controller.request_scene_tree();
	}

	private start_scene_tree_refresh() {
		this.stop_scene_tree_refresh();
		if (!this.session) return;
		const interval = get_configuration("debugger.sceneTreeRefreshInterval", 1000) as number;
		if (interval <= 0) return;
		this.sceneTreeRefreshTimer = setInterval(
			() => {
				if (this.sceneTree.view.visible && this.session?.controller.is_connected) this.refresh_scene_tree();
			},
			Math.max(250, interval),
		);
	}

	private stop_scene_tree_refresh() {
		clearInterval(this.sceneTreeRefreshTimer);
		this.sceneTreeRefreshTimer = undefined;
	}

	public async filter_scene_tree() {
		const filter = await window.showInputBox({
			title: "Search Remote Scene Tree",
			prompt: "Filter by node name, class, or path. Parent nodes remain visible.",
			value: this.sceneTree.filter,
			placeHolder: "e.g. Button, Inventory, /root/Main/UI",
		});
		if (filter !== undefined) this.set_scene_tree_filter(filter);
	}

	public set_scene_tree_filter(filter: string) {
		this.sceneTree.set_filter(filter);
		set_context("debugger.sceneTreeFiltered", this.sceneTree.filter !== "");
	}

	public set_node_highlight(enabled: boolean) {
		this.highlightEnabled = enabled;
		set_context("debugger.highlightEnabled", enabled);
		this.update_node_highlight();
	}

	public clear_node_highlight() {
		this.selectedNodeId = undefined;
		this.update_node_highlight();
	}

	private update_node_highlight() {
		if (this.session instanceof Godot4DebugSession) {
			this.session.controller.highlight_node(this.selectedNodeId, this.highlightEnabled);
		}
	}

	public async refresh_inspector() {
		if (this.inspector.has_tree()) {
			const item = this.inspector.get_top_item();
			if (item) {
				await this.fill_inspector(item, /*force_refresh*/ true);
			}
		}
	}

	public async edit_value(property: RemoteProperty) {
		if (property.object_id === undefined) {
			log.error("Invalid property to edit (property.object_id === undefined)");
			return;
		}
		const previous_value = property.value;
		const type = typeof previous_value;
		const is_float = type === "number" && !Number.isInteger(previous_value);
		const value = await window.showInputBox({ value: `${property.description}` });
		let new_parsed_value: any;
		switch (type) {
			case "string":
				new_parsed_value = value;
				break;
			case "number":
				if (!value) {
					return;
				}
				if (is_float) {
					new_parsed_value = Number.parseFloat(value);
					if (Number.isNaN(new_parsed_value)) {
						return;
					}
				} else {
					new_parsed_value = Number.parseInt(value);
					if (Number.isNaN(new_parsed_value)) {
						return;
					}
				}
				break;
			case "boolean":
				if (!value) {
					return;
				}
				if (value.toLowerCase() === "true" || value.toLowerCase() === "false") {
					new_parsed_value = value.toLowerCase() === "true";
				} else if (value === "0" || value === "1") {
					new_parsed_value = value === "1";
				} else {
					return;
				}
				break;
		}
		if (property.changes_parent && property.parent !== undefined) {
			const parents = [property.parent];
			let idx = 0;
			while (parents[idx].changes_parent) {
				const parent = parents[idx++].parent;
				if (parent) {
					parents.push(parent);
				}
			}
			const changed_value = this.inspector.get_changed_value(parents, property, new_parsed_value);
			this.session?.controller.set_object_property(BigInt(property.object_id), parents[idx].label, changed_value);
		} else {
			this.session?.controller.set_object_property(BigInt(property.object_id), property.label, new_parsed_value);
		}

		const item = this.inspector.get_top_item();
		if (item) {
			await this.fill_inspector(item, /*force_refresh*/ true);
		}

		// const res = await debug.activeDebugSession?.customRequest("refreshVariables"); // refresh vscode.debug variables
		this.session?.sendEvent(new InvalidatedEvent(["variables"]));
	}
}
