export type FunctionTokenKind = "declaration" | "call";

export interface FunctionToken {
	readonly name: string;
	readonly kind: FunctionTokenKind;
	readonly receiver?: string;
	readonly start: number;
	readonly end: number;
	readonly isStatic: boolean;
	readonly enclosingFunction?: string;
}

