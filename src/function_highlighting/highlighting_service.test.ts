import { strictEqual } from "node:assert";

import { GodotApiIndex } from "./godot_api_index";
import { FunctionHighlightingService } from "./highlighting_service";
import { ProjectSymbolIndex } from "./project_symbol_index";

suite("Function highlighting service", () => {
	test("uses one cached analysis for tokens, decorations, and hover lookup", async () => {
		const api = GodotApiIndex.fromObject({
			header: { version_major: 4, version_minor: 6, version_patch: 2 },
			utility_functions: [{ name: "print" }],
			classes: [{ name: "Node", methods: [{ name: "_ready", is_virtual: true }] }],
		});
		const project = new ProjectSymbolIndex();
		const uri = "res://sample.gd";
		const text = "extends Node\nfunc _ready():\n\tprint(\"ok\")\n\tcustom_call()\n";
		project.update(uri, text);
		const service = new FunctionHighlightingService(api, project);
		const document = { uri, version: 1, text };

		const first = await service.analyze(document);
		const second = await service.analyze(document);

		strictEqual(first, second);
		strictEqual(first.find((entry) => entry.token.name === "_ready")?.classification.origin, "system");
		strictEqual(first.find((entry) => entry.token.name === "print")?.tokenType, "godotSystemFunction");
		strictEqual(first.find((entry) => entry.token.name === "custom_call")?.tokenType, "godotProjectFunction");
		const customOffset = text.indexOf("custom_call") + 2;
		strictEqual((await service.classificationAt(document, customOffset))?.classification.reason, "unresolved_defaults_to_project");
	});

	test("invalidates cached results when API or project data changes", async () => {
		const api = GodotApiIndex.fromObject({ header: { version_major: 4 } });
		const project = new ProjectSymbolIndex();
		const document = { uri: "res://a.gd", version: 1, text: "func run(): pass\n" };
		project.update(document.uri, document.text);
		const service = new FunctionHighlightingService(api, project);
		const before = await service.analyze(document);
		service.invalidate(document.uri);
		const after = await service.analyze(document);
		strictEqual(before === after, false);
	});
});

