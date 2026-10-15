import * as fs from "node:fs";
import { get_extension_uri } from "../utils";
import type { GodotVariable } from "./debug_runtime";

let visibleClasses: Set<string> | undefined;

/** Godot 3 snapshots contain native class names, but no visibility flags. */
export function godot3_has_visibility(className: string): boolean {
	if (!visibleClasses) {
		const api = JSON.parse(
			fs.readFileSync(get_extension_uri("resources", "godot_api", "godot-3.6.json").fsPath, "utf8"),
		);
		const classes = new Map<string, { inherits?: string; properties?: { name: string; type: string }[] }>(
			api.classes.map((entry: any) => [entry.name, entry]),
		);
		visibleClasses = new Set();
		for (const name of classes.keys()) {
			let current = classes.get(name);
			while (current) {
				if (current.properties?.some((property) => property.name === "visible" && property.type === "bool")) {
					visibleClasses.add(name);
					break;
				}
				current = current.inherits ? classes.get(current.inherits) : undefined;
			}
		}
	}
	return visibleClasses.has(className);
}

export function object_visibility(variable: GodotVariable): boolean | undefined {
	const value = variable.value;
	const properties: GodotVariable[] =
		value instanceof Map
			? [...value].map(([name, value]) => ({ name: String(name), value }))
			: typeof value?.sub_values === "function"
				? value.sub_values()
				: [];
	const property =
		properties.find((property) => property.name === "visible") ??
		properties.find((property) => property.name.endsWith("/visible") && !property.name.startsWith("Members/"));
	return typeof property?.value === "boolean" ? property.value : undefined;
}
