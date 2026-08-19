import { maskNonCode, scanFunctions } from "./scanner";

export interface ProjectFunctionSymbol {
	readonly name: string;
	readonly uri: string;
	readonly ownerClass?: string;
	readonly isStatic: boolean;
	readonly start: number;
}

export interface ProjectScriptSymbol {
	readonly uri: string;
	readonly className?: string;
	readonly extendsName?: string;
	readonly functions: ReadonlyMap<string, ProjectFunctionSymbol>;
	readonly memberTypes: ReadonlyMap<string, string>;
	readonly scopedTypes: ReadonlyMap<string, ReadonlyMap<string, string>>;
	readonly scriptAliases: ReadonlyMap<string, string>;
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
	return text.match(pattern)?.[1];
}

function parseTypedNames(text: string): Map<string, string> {
	const result = new Map<string, string>();
	const pattern = /\b([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)/g;
	for (const match of text.matchAll(pattern)) {
		result.set(match[1], match[2]);
	}
	return result;
}

function declarationAtOrBefore(
	declarations: Array<{ name: string; start: number }>,
	offset: number,
): string | undefined {
	let result: string | undefined;
	for (const declaration of declarations) {
		if (declaration.start > offset) {
			break;
		}
		result = declaration.name;
	}
	return result;
}

function parseScript(uri: string, source: string): ProjectScriptSymbol {
	const masked = maskNonCode(source);
	const className = firstMatch(masked, /^\s*class_name\s+([A-Za-z_]\w*)/m);
	const extendsName = firstMatch(masked, /^\s*extends\s+([A-Za-z_]\w*)/m);
	const functionTokens = scanFunctions(source).filter(
		(token) => token.kind === "declaration",
	);
	const declarations = functionTokens.map((token) => ({
		name: token.name,
		start: token.start,
	}));
	const functions = new Map<string, ProjectFunctionSymbol>();
	for (const token of functionTokens) {
		functions.set(token.name, {
			name: token.name,
			uri,
			ownerClass: className,
			isStatic: token.isStatic,
			start: token.start,
		});
	}

	const scopedTypes = new Map<string, Map<string, string>>();
	const functionPattern = /\bfunc\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
	for (const match of masked.matchAll(functionPattern)) {
		const types = parseTypedNames(match[2]);
		if (types.size > 0) {
			scopedTypes.set(match[1], types);
		}
	}

	const memberTypes = new Map<string, string>();
	const variablePattern = /\b(?:var|const)\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)/g;
	for (const match of masked.matchAll(variablePattern)) {
		if (match.index === undefined) {
			continue;
		}
		const enclosingFunction = declarationAtOrBefore(declarations, match.index);
		if (enclosingFunction) {
			const types = scopedTypes.get(enclosingFunction) ?? new Map<string, string>();
			types.set(match[1], match[2]);
			scopedTypes.set(enclosingFunction, types);
		} else {
			memberTypes.set(match[1], match[2]);
		}
	}

	const scriptAliases = new Map<string, string>();
	const aliasPattern = /\b(?:const|var)\s+([A-Za-z_]\w*)\s*=\s*(?:preload|load)\(\s*["'](res:\/\/[^"']+\.gd)["']\s*\)/g;
	for (const match of source.matchAll(aliasPattern)) {
		if (match.index === undefined || !/^(?:const|var)\b/.test(masked.slice(match.index))) {
			continue;
		}
		scriptAliases.set(match[1], match[2]);
	}

	return {
		uri,
		className,
		extendsName,
		functions,
		memberTypes,
		scopedTypes,
		scriptAliases,
	};
}

export class ProjectSymbolIndex {
	private readonly scripts = new Map<string, ProjectScriptSymbol>();
	private readonly classes = new Map<string, ProjectScriptSymbol>();
	private readonly autoloads = new Map<string, string>();

	update(uri: string, source: string): ProjectScriptSymbol {
		const parsed = parseScript(uri, source);
		this.scripts.set(uri, parsed);
		this.rebuildClasses();
		return parsed;
	}

	remove(uri: string): void {
		this.scripts.delete(uri);
		for (const [name, autoloadUri] of this.autoloads) {
			if (autoloadUri === uri) {
				this.autoloads.delete(name);
			}
		}
		this.rebuildClasses();
	}

	clear(): void {
		this.scripts.clear();
		this.classes.clear();
		this.autoloads.clear();
	}

	setAutoload(name: string, uri: string): void {
		this.autoloads.set(name, uri);
	}

	resolveAutoload(name: string): string | undefined {
		return this.autoloads.get(name);
	}

	getScript(uri: string): ProjectScriptSymbol | undefined {
		return this.scripts.get(uri);
	}

	getClassScript(className: string): ProjectScriptSymbol | undefined {
		return this.classes.get(className);
	}

	isProjectClass(className: string): boolean {
		return this.classes.has(className);
	}

	resolveScriptMethod(uri: string, methodName: string): ProjectFunctionSymbol | undefined {
		return this.scripts.get(uri)?.functions.get(methodName);
	}

	resolveClassMethod(className: string, methodName: string): ProjectFunctionSymbol | undefined {
		const visited = new Set<string>();
		let current: string | undefined = className;
		while (current && !visited.has(current)) {
			visited.add(current);
			const script = this.classes.get(current);
			if (!script) {
				return undefined;
			}
			const method = script.functions.get(methodName);
			if (method) {
				return method;
			}
			current = script.extendsName;
		}
		return undefined;
	}

	resolveMethodFromScript(uri: string, methodName: string): ProjectFunctionSymbol | undefined {
		const script = this.scripts.get(uri);
		if (!script) {
			return undefined;
		}
		const direct = script.functions.get(methodName);
		if (direct) {
			return direct;
		}
		return script.extendsName
			? this.resolveClassMethod(script.extendsName, methodName)
			: undefined;
	}

	resolveVariableType(
		uri: string,
		variableName: string,
		enclosingFunction?: string,
	): string | undefined {
		const script = this.scripts.get(uri);
		if (!script) {
			return undefined;
		}
		return (
			(enclosingFunction
				? script.scopedTypes.get(enclosingFunction)?.get(variableName)
				: undefined) ?? script.memberTypes.get(variableName)
		);
	}

	resolveScriptAlias(uri: string, alias: string): string | undefined {
		return this.scripts.get(uri)?.scriptAliases.get(alias);
	}

	private rebuildClasses(): void {
		this.classes.clear();
		for (const script of this.scripts.values()) {
			if (script.className) {
				this.classes.set(script.className, script);
			}
		}
	}
}

