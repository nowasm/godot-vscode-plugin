export interface GodotApiHeader {
	version_major?: number;
	version_minor?: number;
	version_patch?: number;
	version_status?: string;
}

export interface GodotApiMethod {
	name?: string;
	is_virtual?: boolean;
	return_value?: { type?: string };
}

export interface GodotApiClass {
	name?: string;
	inherits?: string;
	methods?: GodotApiMethod[];
	signals?: Array<{ name?: string }>;
}

export interface GodotApiDump {
	header?: GodotApiHeader;
	utility_functions?: GodotApiMethod[];
	builtin_classes?: GodotApiClass[];
	classes?: GodotApiClass[];
}

function methodNames(methods: GodotApiMethod[] | undefined): Set<string> {
	return new Set(
		(methods ?? [])
			.map((method) => method.name)
			.filter((name): name is string => typeof name === "string" && name.length > 0),
	);
}

// Godot exposes these on @GDScript rather than in extension_api.json. This list
// comes from Godot 4.6.2's generated @GDScript.xml (`godot --doctool`).
const GDSCRIPT_LANGUAGE_FUNCTIONS = [
	"Color8",
	"assert",
	"char",
	"convert",
	"dict_to_inst",
	"get_stack",
	"inst_to_dict",
	"is_instance_of",
	"len",
	"load",
	"ord",
	"preload",
	"print_debug",
	"print_stack",
	"range",
	"type_exists",
] as const;

export class GodotApiIndex {
	readonly version: string;
	readonly cacheKey: string;

	private readonly utilityFunctions: Set<string>;
	private readonly builtinMethods = new Map<string, Set<string>>();
	private readonly nativeMethods = new Map<string, Set<string>>();
	private readonly nativeMethodReturnTypes = new Map<string, Map<string, string>>();
	private readonly nativeSignals = new Map<string, Set<string>>();
	private readonly virtualMethods = new Map<string, Set<string>>();
	private readonly nativeParents = new Map<string, string>();

	private constructor(api: GodotApiDump) {
		const header = api.header ?? {};
		const numericVersion = [header.version_major ?? 0, header.version_minor ?? 0, header.version_patch ?? 0].join(
			".",
		);
		this.version = header.version_status ? `${numericVersion}-${header.version_status}` : numericVersion;
		this.cacheKey = this.version.replace(/[^A-Za-z0-9._-]/g, "-");
		this.utilityFunctions = methodNames(api.utility_functions);
		if ((header.version_major ?? 4) === 4) {
			for (const functionName of GDSCRIPT_LANGUAGE_FUNCTIONS) {
				this.utilityFunctions.add(functionName);
			}
		}

		for (const builtin of api.builtin_classes ?? []) {
			if (builtin.name) {
				this.builtinMethods.set(builtin.name, methodNames(builtin.methods));
			}
		}

		for (const nativeClass of api.classes ?? []) {
			if (!nativeClass.name) {
				continue;
			}
			this.nativeMethods.set(nativeClass.name, methodNames(nativeClass.methods));
			this.nativeMethodReturnTypes.set(
				nativeClass.name,
				new Map(
					(nativeClass.methods ?? [])
						.filter((method): method is GodotApiMethod & { name: string; return_value: { type: string } } =>
							typeof method.name === "string" && typeof method.return_value?.type === "string",
						)
						.map((method) => [method.name, method.return_value.type]),
				),
			);
			this.nativeSignals.set(nativeClass.name, methodNames(nativeClass.signals));
			this.virtualMethods.set(
				nativeClass.name,
				methodNames(nativeClass.methods?.filter((method) => method.is_virtual)),
			);
			if (nativeClass.inherits) {
				this.nativeParents.set(nativeClass.name, nativeClass.inherits);
			}
		}
	}

	static fromObject(value: unknown): GodotApiIndex {
		if (!value || typeof value !== "object") {
			throw new Error("Godot API dump must be an object");
		}
		return new GodotApiIndex(value as GodotApiDump);
	}

	static fromJson(json: string): GodotApiIndex {
		return GodotApiIndex.fromObject(JSON.parse(json));
	}

	hasUtilityFunction(name: string): boolean {
		return this.utilityFunctions.has(name);
	}

	hasBuiltinMethod(typeName: string, methodName: string): boolean {
		return this.builtinMethods.get(typeName)?.has(methodName) ?? false;
	}

	hasBuiltinClass(typeName: string): boolean {
		return this.builtinMethods.has(typeName);
	}

	hasNativeClass(typeName: string): boolean {
		return this.nativeMethods.has(typeName);
	}

	hasNativeMethod(typeName: string, methodName: string): boolean {
		return this.getNativeMethodOwner(typeName, methodName) !== undefined;
	}

	getNativeMethodOwner(typeName: string, methodName: string): string | undefined {
		return this.findOwner(this.nativeMethods, typeName, methodName);
	}

	getNativeMethodReturnType(typeName: string, methodName: string): string | undefined {
		const owner = this.getNativeMethodOwner(typeName, methodName);
		return owner ? this.nativeMethodReturnTypes.get(owner)?.get(methodName) : undefined;
	}

	hasNativeSignal(typeName: string, signalName: string): boolean {
		return this.findOwner(this.nativeSignals, typeName, signalName) !== undefined;
	}

	hasVirtualMethod(typeName: string, methodName: string): boolean {
		return this.findOwner(this.virtualMethods, typeName, methodName) !== undefined;
	}

	getNativeParent(typeName: string): string | undefined {
		return this.nativeParents.get(typeName);
	}

	private findOwner(index: Map<string, Set<string>>, typeName: string, methodName: string): string | undefined {
		const visited = new Set<string>();
		let current: string | undefined = typeName;
		while (current && !visited.has(current)) {
			visited.add(current);
			if (index.get(current)?.has(methodName)) {
				return current;
			}
			current = this.nativeParents.get(current);
		}
		return undefined;
	}
}
