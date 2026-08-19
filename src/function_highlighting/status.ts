export type FunctionIndexStatus =
	| { kind: "indexing" }
	| { kind: "ready"; version: string }
	| { kind: "fallback"; version: string }
	| { kind: "error"; message: string };

export interface FunctionIndexStatusDescription {
	visible: boolean;
	text: string;
	tooltip: string;
}

export function describeFunctionIndexStatus(
	status: FunctionIndexStatus,
): FunctionIndexStatusDescription {
	switch (status.kind) {
		case "indexing":
			return {
				visible: true,
				text: "$(sync~spin) Godot functions",
				tooltip: "Indexing Godot and project functions…",
			};
		case "ready":
			return {
				visible: false,
				text: "$(check) Godot functions",
				tooltip: `Function origin index ready for Godot ${status.version}.`,
			};
		case "fallback":
			return {
				visible: true,
				text: "$(warning) Godot functions",
				tooltip: `Using the bundled Godot ${status.version} API snapshot. Run Rebuild Function Index after configuring the Godot executable.`,
			};
		case "error":
			return {
				visible: true,
				text: "$(error) Godot functions",
				tooltip: `Function origin index failed: ${status.message}`,
			};
	}
}
