import type { FunctionToken } from "./types";

const NON_CALL_KEYWORDS = new Set([
	"and",
	"as",
	"await",
	"break",
	"breakpoint",
	"class",
	"class_name",
	"const",
	"continue",
	"elif",
	"else",
	"enum",
	"extends",
	"for",
	"func",
	"if",
	"in",
	"is",
	"match",
	"not",
	"or",
	"pass",
	"return",
	"self",
	"signal",
	"static",
	"super",
	"var",
	"void",
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
		if (quote !== '"' && quote !== "'") {
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

function skipWhitespaceLeft(masked: string, position: number): number {
	let cursor = position;
	while (cursor >= 0 && /\s/.test(masked[cursor])) {
		cursor--;
	}
	return cursor;
}

function receiverSegmentStart(masked: string, position: number): number | undefined {
	let cursor = skipWhitespaceLeft(masked, position);
	if (masked[cursor] === ")") {
		let depth = 1;
		cursor--;
		while (cursor >= 0 && depth > 0) {
			if (masked[cursor] === ")") {
				depth++;
			} else if (masked[cursor] === "(") {
				depth--;
			}
			cursor--;
		}
		if (depth !== 0) {
			return undefined;
		}
		cursor = skipWhitespaceLeft(masked, cursor);
	}
	const end = cursor;
	while (cursor >= 0 && /[\w$%/]/.test(masked[cursor])) {
		cursor--;
	}
	return cursor < end ? cursor + 1 : undefined;
}

function findReceiver(source: string, masked: string, nameStart: number): string | undefined {
	const dot = skipWhitespaceLeft(masked, nameStart - 1);
	if (masked[dot] !== ".") {
		return undefined;
	}
	let start = receiverSegmentStart(masked, dot - 1);
	if (start === undefined) {
		return undefined;
	}
	while (true) {
		const previousDot = skipWhitespaceLeft(masked, start - 1);
		if (masked[previousDot] !== ".") {
			break;
		}
		const previousStart = receiverSegmentStart(masked, previousDot - 1);
		if (previousStart === undefined) {
			break;
		}
		start = previousStart;
	}
	return source.slice(start, dot).trim();
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
	const rawTokens: Array<Omit<FunctionToken, "enclosingFunction">> = declarations.map((declaration) => ({
		...declaration,
		kind: "declaration",
		receiver: undefined,
	}));

	const callPattern = /\b([A-Za-z_]\w*)\s*\(/g;
	for (const match of masked.matchAll(callPattern)) {
		if (match.index === undefined) {
			continue;
		}
		const name = match[1];
		const start = match.index;
		if (declarationStarts.has(start) || NON_CALL_KEYWORDS.has(name) || isAnnotation(masked, start)) {
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
