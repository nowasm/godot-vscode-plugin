import { deepStrictEqual } from "node:assert";

import { normalizeDecorationSettings } from "./decoration_settings";

suite("Function highlighting decorations", () => {
	test("uses clear defaults and validates user settings", () => {
		deepStrictEqual(normalizeDecorationSettings({}), {
			enabled: true,
			systemColor: "#4FC3F7",
			propertyColor: "#C792EA",
			projectColor: "#FFD166",
			systemFontStyle: "normal",
			projectFontStyle: "normal",
		});
		deepStrictEqual(
			normalizeDecorationSettings({
				systemColor: "not-a-color",
				propertyColor: "#AA55CC",
				projectColor: "#123456",
				systemFontStyle: "italic",
				projectFontStyle: "bold",
			}),
			{
				enabled: true,
				systemColor: "#4FC3F7",
				propertyColor: "#AA55CC",
				projectColor: "#123456",
				systemFontStyle: "italic",
				projectFontStyle: "bold",
			},
		);
	});
});
