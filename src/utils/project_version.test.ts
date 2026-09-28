import { strictEqual } from "node:assert";

import { parseGodotProjectVersion } from "./project_version";

suite("Godot project version", () => {
	test("detects Godot 3 from the project format version", () => {
		strictEqual(parseGodotProjectVersion('config_version=4\n[application]\nconfig/name="Brotato"'), "3.x");
	});

	test("prefers the precise Godot 4 feature version", () => {
		strictEqual(
			parseGodotProjectVersion('config_version=5\n[application]\nconfig/features=PackedStringArray("4.6", "Mobile")'),
			"4.6",
		);
	});

	test("detects Godot 4 when feature metadata is absent", () => {
		strictEqual(parseGodotProjectVersion('config_version=5\n[application]\nconfig/name="Example"'), "4.x");
	});

	test("does not read a commented-out feature as the project version", () => {
		strictEqual(parseGodotProjectVersion('config_version=4\n; config/features=PackedStringArray("4.6")'), "3.x");
	});

	test("keeps the legacy Godot 3 fallback", () => {
		strictEqual(parseGodotProjectVersion('[application]\nconfig/name="Old project"'), "3.x");
	});
});
