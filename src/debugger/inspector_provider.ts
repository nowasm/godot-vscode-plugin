import { EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState, TreeView, window } from "vscode";
import { GodotVariable } from "./debug_runtime";

export interface InspectedObject {
	className: string;
	variable: GodotVariable;
}

// Godot 3 and 4 have separate Variant classes. RIDs also carry an ID but are not Objects.
function object_reference(value: any): bigint | undefined {
	if (typeof value?.id !== "bigint" || typeof value.type_name !== "function") return;
	return ["Object", "ObjectId"].includes(value.type_name()) ? BigInt.asUintN(64, value.id) : undefined;
}

export class InspectorProvider implements TreeDataProvider<RemoteProperty> {
	private changeTreeEvent = new EventEmitter<void>();
	onDidChangeTreeData = this.changeTreeEvent.event;

	private root: RemoteProperty | undefined;
	public revision = 0;
	private pending = new Map<bigint, Promise<InspectedObject>>();
	public view: TreeView<RemoteProperty>;

	constructor(private loadObject: (id: bigint) => Promise<InspectedObject>) {
		this.view = window.createTreeView("godotTools.nodeInspector", {
			treeDataProvider: this,
		});
		this.view.onDidExpandElement(({ element }) => {
			if (element.loadState === "error") void this.expand_object(element);
		});
	}

	public clear() {
		this.revision++;
		this.pending.clear();
		this.view.description = undefined;
		this.view.message = undefined;

		if (this.root) {
			this.root = undefined;
			this.changeTreeEvent.fire();
		}
	}

	public fill_tree(element_name: string, class_name: string, object_id: number | bigint, variable: GodotVariable) {
		this.revision++;
		this.pending.clear();
		this.root = this.parse_variable(variable, object_id);
		this.root.reference_id = BigInt(object_id);
		this.root.label = element_name;
		this.root.collapsibleState = TreeItemCollapsibleState.Expanded;
		this.root.description = class_name;
		this.changeTreeEvent.fire();
	}

	public getChildren(element?: RemoteProperty): RemoteProperty[] {
		if (!this.root) {
			return [];
		}

		if (!element) {
			return [this.root];
		} else {
			if (element.loadState === "unloaded") void this.expand_object(element);
			return element.properties;
		}
	}

	/** Load only the explicitly expanded reference, keeping the selected scene node intact. */
	public async expand_object(property: RemoteProperty): Promise<void> {
		if (!property.reference_id || !property.loadState || property.loadState === "loaded") return;
		if (property.loading) return property.loading;
		let root = property;
		let circular: RemoteProperty | undefined;
		for (let parent = property.parent; parent; parent = parent.parent) {
			root = parent;
			if (parent.reference_id === property.reference_id) circular = parent;
		}
		if (root !== this.root) return;
		if (circular) {
			property.loadState = "loaded";
			property.properties = [this.message_property(`Circular reference to ${circular.label}`, property)];
			this.changeTreeEvent.fire();
			return;
		}
		const revision = this.revision;
		const id = property.reference_id;
		property.loadState = "loading";
		property.properties = [this.message_property("Loading object properties…", property)];
		let request = this.pending.get(id);
		if (!request) {
			request = Promise.resolve().then(() => this.loadObject(id));
			this.pending.set(id, request);
		}
		property.loading = (async () => {
			try {
				const { className, variable } = await request;
				if (revision !== this.revision) return;
				const object = this.parse_variable(variable, id);
				property.properties = object.properties;
				for (const child of property.properties) child.parent = property;
				property.description = `${className}<${id}>`;
				property.loadState = "loaded";
				property.collapsibleState = property.properties.length
					? TreeItemCollapsibleState.Collapsed
					: TreeItemCollapsibleState.None;
			} catch (error) {
				if (revision !== this.revision) return;
				property.loadState = "error";
				property.properties = [
					this.message_property(
						`${error instanceof Error ? error.message : String(error)} Close and expand to retry.`,
						property,
					),
				];
			} finally {
				if (this.pending.get(id) === request) this.pending.delete(id);
				property.loading = undefined;
				if (revision === this.revision) this.changeTreeEvent.fire();
			}
		})();
		this.changeTreeEvent.fire();
		return property.loading;
	}

	private message_property(message: string, parent: RemoteProperty): RemoteProperty {
		const property = new RemoteProperty(message, undefined, undefined, [], TreeItemCollapsibleState.None);
		property.parent = parent;
		return property;
	}

	public getTreeItem(element: RemoteProperty): TreeItem | Thenable<TreeItem> {
		return element;
	}

	public get_changed_value(parents: RemoteProperty[], property: RemoteProperty, new_parsed_value: any) {
		const idx = parents.length - 1;
		const value = parents[idx].value;
		if (Array.isArray(value)) {
			const idx = Number.parseInt(property.label);
			if (idx < value.length) {
				value[idx] = new_parsed_value;
			}
		} else if (value instanceof Map && property.parent) {
			value.set(property.parent.value.key, new_parsed_value);
		} else if (value && typeof value === "object" && value[property.label]) {
			value[property.label] = new_parsed_value;
		}

		return value;
	}

	public get_top_item(): RemoteProperty | undefined {
		if (this.root) {
			return this.root;
		}
		return undefined;
	}

	public has_tree() {
		return this.root !== undefined;
	}

	private parse_variable(va: GodotVariable, object_id?: number | bigint): RemoteProperty {
		const value = va.value;
		const reference = object_reference(value);
		let rendered_value = "";

		if (typeof value === "number") {
			if (Number.isInteger(value)) {
				rendered_value = `${value}`;
			} else {
				rendered_value = `${Number.parseFloat(value.toFixed(5))}`;
			}
		} else if (typeof value === "bigint" || typeof value === "boolean" || typeof value === "string") {
			rendered_value = `${value}`;
		} else if (value === undefined || value === null || reference === 0n) {
			rendered_value = "null";
		} else {
			if (Array.isArray(value)) {
				rendered_value = `Array[${value.length}]`;
			} else if (value instanceof Map) {
				if (typeof (value as any).class_name === "string") {
					rendered_value = `${(value as any).class_name}`;
				} else {
					rendered_value = `Dictionary[${value.size}]`;
				}
			} else {
				rendered_value = `${value.type_name()}${value.stringify_value()}`;
			}
		}

		let child_props: RemoteProperty[] = [];

		if (value && reference === undefined) {
			let sub_variables: any[] = [];
			if (typeof value.sub_values === "function") {
				sub_variables = value.sub_values();
			} else if (Array.isArray(value)) {
				sub_variables = value.map((va, i) => {
					return { name: `${i}`, value: va };
				});
			} else if (value instanceof Map) {
				sub_variables = Array.from(value.keys()).map((va: any) => {
					const name = typeof va.rendered_value === "function" ? va.rendered_value() : `${va}`;
					const map_value = value.get(va);
					return { name: name, value: map_value };
				});
			}

			child_props =
				sub_variables?.map((va: any) => {
					return this.parse_variable(va, object_id);
				}) || [];
		}

		const out_prop = new RemoteProperty(
			va.name,
			value,
			object_id || 0,
			child_props,
			child_props.length === 0 ? TreeItemCollapsibleState.None : TreeItemCollapsibleState.Collapsed,
		);
		out_prop.description = rendered_value;
		for (const prop of out_prop.properties) {
			prop.parent = out_prop;
		}
		out_prop.description = rendered_value;

		if (reference !== undefined && reference !== 0n) {
			out_prop.contextValue = "remote_object";
			out_prop.object_id = reference;
			out_prop.reference_id = reference;
			out_prop.loadState = "unloaded";
			out_prop.collapsibleState = TreeItemCollapsibleState.Collapsed;
			out_prop.properties = [this.message_property("Expand to load object properties", out_prop)];
		} else if (
			typeof value === "number" ||
			typeof value === "bigint" ||
			typeof value === "boolean" ||
			typeof value === "string"
		) {
			out_prop.contextValue = "editable_value";
		} else if (Array.isArray(value) || value instanceof Map) {
			for (const prop of out_prop.properties) {
				prop.parent = out_prop;
			}
		}

		return out_prop;
	}
}

export class RemoteProperty extends TreeItem {
	public changes_parent?: boolean;
	public parent?: RemoteProperty;
	public reference_id?: bigint;
	public loadState?: "unloaded" | "loading" | "loaded" | "error";
	public loading?: Promise<void>;

	constructor(
		public label: string,
		public value: any,
		public object_id: number | bigint | undefined,
		public properties: RemoteProperty[],
		public collapsibleState?: TreeItemCollapsibleState,
	) {
		super(label, collapsibleState);
	}
}

export class RemoteObject extends RemoteProperty {}
