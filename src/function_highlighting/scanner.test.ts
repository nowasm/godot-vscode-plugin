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

	test("does not treat parenthesized boolean operators as function calls", () => {
		const source = `func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed \\
			and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		_spawn((event as InputEventMouseButton).position)
`;

		deepStrictEqual(
			scanFunctions(source).map(({ name, kind }) => ({ name, kind })),
			[
				{ name: "_input", kind: "declaration" },
				{ name: "_spawn", kind: "call" },
			],
		);
	});

	test("retains call and signal chains as receivers", () => {
		const source = "get_tree().create_timer(0.5).timeout.connect(_done)\nget_viewport().size_changed.is_connected(_done)\n";
		const tokens = scanFunctions(source);
		strictEqual(tokens.find((entry) => entry.name === "create_timer")?.receiver, "get_tree()");
		strictEqual(tokens.find((entry) => entry.name === "connect")?.receiver, "get_tree().create_timer(0.5).timeout");
		strictEqual(tokens.find((entry) => entry.name === "is_connected")?.receiver, "get_viewport().size_changed");
	});
});
