import { strictEqual } from "node:assert";

import { EXTENSION_ID, HIGHLIGHT_CONFIG_PREFIX, UPSTREAM_COMMAND_PREFIX } from "./extension_identity";

suite("extension identity", () => {
	test("uses a fork ID while preserving upstream commands", () => {
		strictEqual(EXTENSION_ID, "godparty.godparty-godot-tools");
		strictEqual(HIGHLIGHT_CONFIG_PREFIX, "godpartyGodotTools.functionHighlight");
		strictEqual(UPSTREAM_COMMAND_PREFIX, "godotTools");
	});
});
