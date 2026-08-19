import type { FunctionToken } from "./types";

const NON_CALL_KEYWORDS = new Set([
	"class",
	"class_name",
	"elif",
	"else",
	"enum",
	"for",
	"func",
	"if",
	"match",
	"return",
	"signal",
	"while",
]);

type Declaration = {
	name: string;
	start: number;
	end: number;
	isStatic: boolean;
};

/**
 * Replaces comments and string contents with spaces while preserving offsets
 * and newlines. This keeps the scanner deterministic without executing or
 * fully parsing user code.
 */
export function maskNonCode(source: string): string {
	const result = source.split("");
	let index = 0;

	const mask = (position: number) => {
		if (source[position] !== "\n" && source[position] !== "\r") {
			result[position] = " ";
		}
	};

	while (index < source.length) {
		if (source[index] === "#") {
			while (index < source.length && source[index] !== "\n") {
				mask(index++);
			}
			continue;
		}

		const quote = source[index];
		if (quote !== "\"" && quote !== "'") {
			index++;
			continue;
		}

		const triple = source.slice(index, index + 3) === quote.repeat(3);
		const delimiterLength = triple ? 3 : 1;
		for (let offset = 0; offset < delimiterLength; offset++) {
			mask(index + offset);
		}
		index += delimiterLength;

		while (index < source.length) {
			if (!triple && source[index] === "\\") {
				mask(index++);
				if (index < source.length) {
					mask(index++);
				}
				continue;
			}

			if (triple && source.slice(index, index + 3) === quote.repeat(3)) {
				for (let offset = 0; offset < 3; offset++) {
					mask(index + offset);
				}
				index += 3;
				break;
			}

			if (!triple && source[index] === quote) {
				mask(index++);
				break;
			}

			mask(index++);
		}
	}

	return result.join("");
}

function findReceiver(source: string, masked: string, nameStart: number): string | undefined {
	let cursor = nameStart - 1;
	while (cursor >= 0 && /\s/.test(masked[cursor])) {
		cursor--;
	}
	if (cursor < 0 || masked[cursor] !== ".") {
		return undefined;
	}

	cursor--;
	while (cursor >= 0 && /\s/.test(masked[cursor])) {
		cursor--;
	}
	const end = cursor + 1;
	while (cursor >= 0 && /[\w$%./]/.test(masked[cursor])) {
		cursor--;
	}
	const receiver = source.slice(cursor + 1, end).trim();
	return receiver || undefined;
}

function isAnnotation(masked: string, nameStart: number): boolean {
	let cursor = nameStart - 1;
	while (cursor >= 0 && /[ \t]/.test(masked[cursor])) {
		cursor--;
	}
	return masked[cursor] === "@";
}

function findDeclarations(masked: string): Declaration[] {
	const declarations: Declaration[] = [];
	const declarationPattern = /\b(?:(static)\s+)?func\s+([A-Za-z_]\w*)\s*\(/g;
	for (const match of masked.matchAll(declarationPattern)) {
		if (match.index === undefined) {
			continue;
		}
		const relativeNameStart = match[0].lastIndexOf(match[2]);
		const start = match.index + relativeNameStart;
		declarations.push({
			name: match[2],
			start,
			end: start + match[2].length,
			isStatic: match[1] === "static",
		});
	}
	return declarations;
}

export function scanFunctions(source: string): FunctionToken[] {
	const masked = maskNonCode(source);
	const declarations = findDeclarations(masked);
	const declarationStarts = new Set(declarations.map((declaration) => declaration.start));
	const rawTokens: Array<Omit<FunctionToken, "enclosingFunction">> = declarations.map(
		(declaration) => ({
			...declaration,
			kind: "declaration",
			receiver: undefined,
		}),
	);

	const callPattern = /\b([A-Za-z_]\w*)\s*\(/g;
	for (const match of masked.matchAll(callPattern)) {
		if (match.index === undefined) {
			continue;
		}
		const name = match[1];
		const start = match.index;
		if (
			declarationStarts.has(start) ||
			NON_CALL_KEYWORDS.has(name) ||
			isAnnotation(masked, start)
		) {
			continue;
		}

		rawTokens.push({
			name,
			kind: "call",
			receiver: findReceiver(source, masked, start),
			start,
			end: start + name.length,
			isStatic: false,
		});
	}

	rawTokens.sort((left, right) => left.start - right.start || left.end - right.end);

	let enclosingFunction: string | undefined;
	return rawTokens.map((token) => {
		if (token.kind === "declaration") {
			enclosingFunction = token.name;
			return { ...token, enclosingFunction: undefined };
		}
		return { ...token, enclosingFunction };
	});
}

