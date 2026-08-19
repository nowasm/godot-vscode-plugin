import { deepStrictEqual, strictEqual } from "node:assert";

import { scanFunctions } from "./scanner";

suite("GDScriptFunctionScanner", () => {
	test("finds declarations and calls but skips comments and strings", () => {
		const source = `
func _ready() -> void:
	print("move_player()")
	player.move_player(
		Vector2.ZERO
	)
	# queue_free()
`;
		const tokens = scanFunctions(source);
		deepStrictEqual(
			tokens.map(({ name, kind, receiver }) => ({ name, kind, receiver })),
			[
				{ name: "_ready", kind: "declaration", receiver: undefined },
				{ name: "print", kind: "call", receiver: undefined },
				{ name: "move_player", kind: "call", receiver: "player" },
			],
		);
	});

	test("records static declarations, exact ranges, and enclosing functions", () => {
		const source = "static func build() -> Node:\n\treturn Node.new()\n";
		const tokens = scanFunctions(source);

		strictEqual(tokens.length, 2);
		deepStrictEqual(tokens[0], {
			name: "build",
			kind: "declaration",
			receiver: undefined,
			start: source.indexOf("build"),
			end: source.indexOf("build") + "build".length,
			isStatic: true,
			enclosingFunction: undefined,
		});
		strictEqual(tokens[1].name, "new");
		strictEqual(tokens[1].enclosingFunction, "build");
		strictEqual(tokens[1].receiver, "Node");
	});

	test("handles triple strings, annotations, lambdas, and node receivers", () => {
		const source = `
@rpc("authority")
func run() -> void:
	var ignored = """fake_call()
	still_fake()
	"""
	var callback = func(): nested_call()
	Callable(self, "hidden_method")
	super.tick()
	$Child.play()
	%Named.stop()
`;
		const tokens = scanFunctions(source);

		deepStrictEqual(
			tokens.map(({ name, receiver }) => ({ name, receiver })),
			[
				{ name: "run", receiver: undefined },
				{ name: "nested_call", receiver: undefined },
				{ name: "Callable", receiver: undefined },
				{ name: "tick", receiver: "super" },
				{ name: "play", receiver: "$Child" },
				{ name: "stop", receiver: "%Named" },
			],
		);
	});
});
