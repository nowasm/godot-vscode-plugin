export type FunctionFontStyle = "normal" | "bold" | "italic" | "bold italic";

export interface FunctionDecorationSettings {
	enabled: boolean;
	systemColor: string;
	projectColor: string;
	systemFontStyle: FunctionFontStyle;
	projectFontStyle: FunctionFontStyle;
}

const FONT_STYLES = new Set<FunctionFontStyle>(["normal", "bold", "italic", "bold italic"]);

function color(value: unknown, fallback: string): string {
	return typeof value === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) ? value : fallback;
}

function fontStyle(value: unknown): FunctionFontStyle {
	return typeof value === "string" && FONT_STYLES.has(value as FunctionFontStyle)
		? (value as FunctionFontStyle)
		: "normal";
}

export function normalizeDecorationSettings(
	value: Partial<Record<keyof FunctionDecorationSettings, unknown>>,
): FunctionDecorationSettings {
	return {
		enabled: typeof value.enabled === "boolean" ? value.enabled : true,
		systemColor: color(value.systemColor, "#4FC3F7"),
		projectColor: color(value.projectColor, "#FFD166"),
		systemFontStyle: fontStyle(value.systemFontStyle),
		projectFontStyle: fontStyle(value.projectFontStyle),
	};
}
