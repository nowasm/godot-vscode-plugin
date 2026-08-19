import { readFileSync } from "node:fs";
import { strictEqual } from "node:assert";
import * as path from "node:path";

interface ExtensionManifest {
	contributes: {
		commands: Array<{ command: string }>;
		configuration: { properties: Record<string, { default?: unknown }> };
		semanticTokenScopes: Array<{ scopes: Record<string, string[]> }>;
	};
}

suite("Function highlighting manifest", () => {
	const manifest = JSON.parse(
		readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
	) as ExtensionManifest;

	test("registers function highlighting commands", () => {
		const commands = new Set(manifest.contributes.commands.map(({ command }) => command));
		strictEqual(commands.has("godpartyGodotTools.functionHighlight.toggle"), true);
		strictEqual(commands.has("godpartyGodotTools.functionHighlight.rebuildIndex"), true);
	});

	test("contributes all public settings with intended defaults", () => {
		const properties = manifest.contributes.configuration.properties;
		strictEqual(properties["godpartyGodotTools.functionHighlight.enabled"]?.default, true);
		strictEqual(
			properties["godpartyGodotTools.functionHighlight.systemColor"]?.default,
			"#4FC3F7",
		);
		strictEqual(
			properties["godpartyGodotTools.functionHighlight.projectColor"]?.default,
			"#FFD166",
		);
		strictEqual(
			properties["godpartyGodotTools.functionHighlight.systemFontStyle"]?.default,
			"normal",
		);
		strictEqual(
			properties["godpartyGodotTools.functionHighlight.projectFontStyle"]?.default,
			"normal",
		);
		strictEqual(
			Array.isArray(properties["godpartyGodotTools.functionHighlight.exclude"]?.default),
			true,
		);
	});

	test("maps both semantic token types to TextMate scopes", () => {
		const scopes = Object.assign(
			{},
			...manifest.contributes.semanticTokenScopes.map((entry) => entry.scopes),
		);
		strictEqual(scopes.godotSystemFunction?.[0], "support.function.godot-system");
		strictEqual(scopes.godotProjectFunction?.[0], "entity.name.function.godot-project");
	});
});
