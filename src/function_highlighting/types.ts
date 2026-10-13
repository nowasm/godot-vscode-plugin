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

export interface PropertyToken {
	readonly name: string;
	readonly receiver?: string;
	readonly start: number;
	readonly end: number;
	readonly enclosingFunction?: string;
}
