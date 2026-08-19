import type { GodotApiIndex } from "./godot_api_index";
import type {
	LspCancellationToken,
	LspOriginRequest,
	LspOriginResolver,
} from "./lsp_origin_resolver";
import type { ProjectScriptSymbol, ProjectSymbolIndex } from "./project_symbol_index";
import type { FunctionToken } from "./types";

export type FunctionOrigin = "system" | "project";
export type ClassificationConfidence = "certain" | "inferred" | "fallback";

export interface FunctionClassification {
	origin: FunctionOrigin;
	owner?: string;
	reason: string;
	confidence: ClassificationConfidence;
}

export interface FunctionClassificationContext {
	uri: string;
	api: GodotApiIndex;
	project: ProjectSymbolIndex;
}

function nativeBaseForType(
	typeName: string | undefined,
	context: FunctionClassificationContext,
): string | undefined {
	const visited = new Set<string>();
	let current = typeName;
	while (current && !visited.has(current)) {
		visited.add(current);
		if (context.api.hasNativeClass(current)) {
			return current;
		}
		current = context.project.getClassScript(current)?.extendsName;
	}
	return undefined;
}

function nativeBaseForScript(
	script: ProjectScriptSymbol | undefined,
	context: FunctionClassificationContext,
): string | undefined {
	return nativeBaseForType(script?.extendsName, context);
}

function system(
	owner: string,
	reason: string,
	confidence: ClassificationConfidence = "certain",
): FunctionClassification {
	return { origin: "system", owner, reason, confidence };
}

function project(
	owner: string | undefined,
	reason: string,
	confidence: ClassificationConfidence = "certain",
): FunctionClassification {
	return { origin: "project", owner, reason, confidence };
}

function classifyTypedReceiver(
	typeName: string,
	methodName: string,
	context: FunctionClassificationContext,
): FunctionClassification | undefined {
	const projectMethod = context.project.resolveClassMethod(typeName, methodName);
	if (projectMethod) {
		return project(
			projectMethod.ownerClass ?? projectMethod.uri,
			"project_receiver",
		);
	}

	if (context.project.isProjectClass(typeName)) {
		const nativeBase = nativeBaseForType(typeName, context);
		if (nativeBase) {
			const owner = context.api.getNativeMethodOwner(nativeBase, methodName);
			if (owner) {
				return system(owner, "typed_native_receiver", "inferred");
			}
		}
		return project(typeName, "project_receiver", "inferred");
	}

	if (context.api.hasBuiltinMethod(typeName, methodName)) {
		return system(typeName, "typed_builtin_receiver");
	}
	if (context.api.hasNativeClass(typeName)) {
		if (methodName === "new") {
			return system(typeName, "native_constructor");
		}
		const owner = context.api.getNativeMethodOwner(typeName, methodName);
		if (owner) {
			return system(owner, "typed_native_receiver");
		}
	}
	return undefined;
}

export function classifyFunction(
	token: FunctionToken,
	context: FunctionClassificationContext,
): FunctionClassification {
	const script = context.project.getScript(context.uri);
	const nativeBase = nativeBaseForScript(script, context);

	if (token.kind === "declaration") {
		if (nativeBase && context.api.hasVirtualMethod(nativeBase, token.name)) {
			return system(
				context.api.getNativeMethodOwner(nativeBase, token.name) ?? nativeBase,
				"native_virtual_override",
			);
		}
		return project(script?.className ?? context.uri, "project_definition");
	}

	if (!token.receiver) {
		const projectMethod = context.project.resolveMethodFromScript(context.uri, token.name);
		if (projectMethod) {
			return project(
				projectMethod.ownerClass ?? projectMethod.uri,
				"project_definition",
			);
		}
		if (context.api.hasUtilityFunction(token.name)) {
			return system("GDScript", "utility_function");
		}
		if (context.api.hasBuiltinClass(token.name)) {
			return system(token.name, "builtin_constructor");
		}
		if (nativeBase) {
			const owner = context.api.getNativeMethodOwner(nativeBase, token.name);
			if (owner) {
				return system(owner, "inherited_native_method", "inferred");
			}
		}
		return project(undefined, "unresolved_defaults_to_project", "fallback");
	}

	if (token.receiver === "self" || token.receiver === "super") {
		const projectMethod = context.project.resolveMethodFromScript(context.uri, token.name);
		if (projectMethod) {
			return project(projectMethod.ownerClass ?? projectMethod.uri, "project_receiver");
		}
		if (nativeBase) {
			const owner = context.api.getNativeMethodOwner(nativeBase, token.name);
			if (owner) {
				return system(owner, "inherited_native_method", "inferred");
			}
		}
	}

	const autoloadUri = context.project.resolveAutoload(token.receiver);
	if (autoloadUri) {
		const method = context.project.resolveMethodFromScript(autoloadUri, token.name);
		if (method) {
			return project(method.ownerClass ?? autoloadUri, "autoload_receiver");
		}
		const autoloadScript = context.project.getScript(autoloadUri);
		const autoloadNativeBase = nativeBaseForScript(autoloadScript, context);
		if (autoloadNativeBase) {
			const owner = context.api.getNativeMethodOwner(autoloadNativeBase, token.name);
			if (owner) {
				return system(owner, "typed_native_receiver", "inferred");
			}
		}
		return project(autoloadUri, "autoload_receiver", "inferred");
	}

	const aliasUri = context.project.resolveScriptAlias(context.uri, token.receiver);
	if (aliasUri) {
		return project(aliasUri, "script_alias_receiver");
	}

	const receiverType = context.project.resolveVariableType(
		context.uri,
		token.receiver,
		token.enclosingFunction,
	);
	if (receiverType) {
		const typed = classifyTypedReceiver(receiverType, token.name, context);
		if (typed) {
			return typed;
		}
	}

	const directType = classifyTypedReceiver(token.receiver, token.name, context);
	if (directType) {
		return directType;
	}

	return project(undefined, "unresolved_defaults_to_project", "fallback");
}

export async function classifyFunctionWithLsp(
	token: FunctionToken,
	context: FunctionClassificationContext,
	resolver: LspOriginResolver,
	request: LspOriginRequest,
	cancellation?: LspCancellationToken,
): Promise<FunctionClassification> {
	const initial = classifyFunction(token, context);
	if (initial.reason !== "unresolved_defaults_to_project") {
		return initial;
	}
	const refined = await resolver.resolve(request, cancellation);
	if (refined?.origin === "project") {
		return project(refined.owner, "lsp_project", "inferred");
	}
	if (
		refined?.origin === "system" &&
		refined.owner &&
		(context.api.hasNativeMethod(refined.owner, token.name) ||
			context.api.hasVirtualMethod(refined.owner, token.name))
	) {
		return system(refined.owner, "lsp_native", "inferred");
	}
	return initial;
}

