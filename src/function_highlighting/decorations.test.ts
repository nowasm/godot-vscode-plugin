import { deepStrictEqual } from "node:assert";

import { normalizeDecorationSettings } from "./decoration_settings";

suite("Function highlighting decorations", () => {
	test("uses clear defaults and validates user settings", () => {
		deepStrictEqual(normalizeDecorationSettings({}), {
			enabled: true,
			systemColor: "#4FC3F7",
			projectColor: "#FFD166",
			systemFontStyle: "normal",
			projectFontStyle: "normal",
		});
		deepStrictEqual(
			normalizeDecorationSettings({
				systemColor: "not-a-color",
				projectColor: "#123456",
				systemFontStyle: "italic",
				projectFontStyle: "bold",
			}),
			{
				enabled: true,
				systemColor: "#4FC3F7",
				projectColor: "#123456",
				systemFontStyle: "italic",
				projectFontStyle: "bold",
			},
		);
	});
});

