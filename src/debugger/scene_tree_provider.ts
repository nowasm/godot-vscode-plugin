import * as path from "node:path";
import {
	Disposable,
	EventEmitter,
	TreeDataProvider,
	TreeItem,
	TreeItemCollapsibleState,
	TreeView,
	Uri,
	window,
} from "vscode";
import { get_extension_uri } from "../utils";
import { godot3_has_visibility } from "./node_visibility";

const iconDir = get_extension_uri("resources", "godot_icons").fsPath;

export class SceneTreeProvider implements TreeDataProvider<SceneNode>, Disposable {
	private changeTreeEvent = new EventEmitter<void>();
	onDidChangeTreeData = this.changeTreeEvent.event;
	private updateTreeEvent = new EventEmitter<void>();
	onDidUpdateTree = this.updateTreeEvent.event;

	private root: SceneNode | undefined;
	private nodes = new Map<string, SceneNode>();
	private filteredNodes = new Set<SceneNode>();
	private confirmedVisibility = new Map<string, boolean>();
	private pendingVisibility = new Set<string>();
	public filter = "";
	public view: TreeView<SceneNode>;

	constructor() {
		this.view = window.createTreeView("godotTools.activeSceneTree", {
			treeDataProvider: this,
		});
	}

	public dispose() {
		this.view.dispose();
		this.changeTreeEvent.dispose();
		this.updateTreeEvent.dispose();
	}

	public clear() {
		this.view.description = undefined;
		this.view.message = undefined;

		this.root = undefined;
		this.nodes.clear();
		this.confirmedVisibility.clear();
		this.pendingVisibility.clear();
		this.filteredNodes.clear();
		this.changeTreeEvent.fire();
	}

	public fill_tree(node: SceneNode) {
		this.root = node;
		this.nodes.clear();
		const index = (item: SceneNode, parent?: SceneNode) => {
			item.parent = parent;
			item.node_path = `${parent?.node_path ?? ""}/${item.label}`;
			this.nodes.set(item.object_id.toString(), item);
			item.confirmed_visible =
				item.view_flags === undefined ? this.confirmedVisibility.get(item.object_id.toString()) : undefined;
			item.visibility_pending = this.pendingVisibility.has(item.object_id.toString());
			for (const child of item.children) index(child, item);
		};
		index(node);
		for (const id of this.confirmedVisibility.keys()) if (!this.nodes.has(id)) this.confirmedVisibility.delete(id);
		this.update_filter();
		this.updateTreeEvent.fire();
	}

	public find_node(object_id: number | bigint): SceneNode | undefined {
		return this.nodes.get(object_id.toString());
	}

	public confirm_visibility(id: number | bigint, visible: boolean) {
		const node = this.find_node(id);
		if (!node) return;
		this.confirmedVisibility.set(id.toString(), visible);
		node.confirmed_visible = visible;
		this.changeTreeEvent.fire();
	}

	public set_visibility_pending(id: number | bigint, pending: boolean) {
		if (pending) this.pendingVisibility.add(id.toString());
		else this.pendingVisibility.delete(id.toString());
		const node = this.find_node(id);
		if (node) node.visibility_pending = pending;
		this.changeTreeEvent.fire();
	}

	public set_filter(filter: string) {
		this.filter = filter.trim();
		this.update_filter();
	}

	private update_filter() {
		this.filteredNodes.clear();
		const query = this.filter.toLowerCase();
		const visit = (node: SceneNode): boolean => {
			let matches = `${node.label}\n${node.class_name}\n${node.node_path}`.toLowerCase().includes(query);
			for (const child of node.children) matches = visit(child) || matches;
			if (matches) this.filteredNodes.add(node);
			return matches;
		};
		if (this.root) visit(this.root);
		this.view.description = this.filter ? `${this.nodes.size} nodes · ${this.filter}` : `${this.nodes.size} nodes`;
		this.view.message = this.root && !this.filteredNodes.size ? `No nodes match "${this.filter}".` : undefined;
		this.changeTreeEvent.fire();
	}

	public getParent(element: SceneNode): SceneNode | undefined {
		return element.parent;
	}

	public getChildren(element?: SceneNode): SceneNode[] {
		if (!this.root) {
			return [];
		}

		if (!element) {
			return this.filteredNodes.has(this.root) ? [this.root] : [];
		} else {
			return element.children.filter((child) => this.filteredNodes.has(child));
		}
	}

	public getTreeItem(element: SceneNode): TreeItem {
		const has_children = this.getChildren(element).length > 0;
		const tree_item: TreeItem = new TreeItem(
			element.label,
			has_children
				? element === this.root || this.filter !== ""
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed
				: TreeItemCollapsibleState.None,
		);

		tree_item.id = element.object_id.toString();
		tree_item.contextValue = element.can_change_visibility
			? `remote_node_${element.local_visible === undefined ? "unknown" : element.local_visible ? "visible" : "hidden"}`
			: "remote_node";
		tree_item.command = {
			command: "godotTools.debugger.inspectNode",
			title: "Inspect Remote Node",
			arguments: [element],
		};
		tree_item.description = `${element.class_name}${element.is_hidden ? " · hidden" : ""}`;
		tree_item.iconPath = element.iconPath;
		tree_item.tooltip = [
			element.node_path,
			element.class_name,
			`Object ID: ${element.object_id}`,
			element.is_hidden ? "Hidden in the running scene" : undefined,
			element.can_change_visibility && element.local_visible === undefined
				? "Visibility is read on demand"
				: undefined,
			element.scene_file_path,
		]
			.filter(Boolean)
			.join("\n");

		return tree_item;
	}
}

export class SceneNode extends TreeItem {
	public parent?: SceneNode;
	public node_path = "";
	public confirmed_visible?: boolean;
	public visibility_pending = false;

	public get can_change_visibility(): boolean {
		if (!this.parent || ["Viewport", "SubViewport"].includes(this.class_name)) return false;
		return this.view_flags !== undefined ? (this.view_flags & 2) !== 0 : godot3_has_visibility(this.class_name);
	}

	public get local_visible(): boolean | undefined {
		return (
			this.confirmed_visible ??
			(this.view_flags !== undefined && (this.view_flags & 2) !== 0 ? (this.view_flags & 4) !== 0 : undefined)
		);
	}

	public get is_hidden(): boolean {
		return this.view_flags !== undefined
			? (this.view_flags & 2) !== 0 && (this.view_flags & 8) === 0
			: this.confirmed_visible === false;
	}

	constructor(
		public label: string,
		public class_name: string,
		public object_id: number | bigint,
		public children: SceneNode[],
		public scene_file_path?: string,
		public view_flags?: number,
	) {
		super(label);

		const iconName = `${class_name}.svg`;

		this.iconPath = {
			light: Uri.file(path.join(iconDir, "light", iconName)),
			dark: Uri.file(path.join(iconDir, "dark", iconName)),
		};
	}
}
