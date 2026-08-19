import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type ApiMethod = { name?: string; is_virtual?: boolean };
type ApiClass = { name?: string; inherits?: string; methods?: ApiMethod[] };
type ApiDump = {
	header?: Record<string, unknown>;
	utility_functions?: ApiMethod[];
	builtin_classes?: ApiClass[];
	classes?: ApiClass[];
};

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function slimMethods(methods: ApiMethod[] | undefined) {
	return (methods ?? [])
		.filter((method) => method.name)
		.map((method) => ({
			name: method.name,
			...(method.is_virtual ? { is_virtual: true } : {}),
		}));
}

function slimClasses(classes: ApiClass[] | undefined) {
	return (classes ?? [])
		.filter((entry) => entry.name)
		.map((entry) => ({
			name: entry.name,
			...(entry.inherits ? { inherits: entry.inherits } : {}),
			methods: slimMethods(entry.methods),
		}));
}

const godotPath = argument("--godot");
if (!godotPath) {
	throw new Error("Usage: npm run generate-api-snapshot -- --godot <executable> [--output <file>]");
}

const outputPath = path.resolve(
	argument("--output") ?? path.join("resources", "godot_api", "godot-4.6.json"),
);
const temporaryPrefix = "godparty-godot-api-";
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), temporaryPrefix));

try {
	execFileSync(godotPath, ["--headless", "--dump-extension-api"], {
		cwd: temporaryDirectory,
		stdio: "ignore",
		windowsHide: true,
	});
	const dumpPath = path.join(temporaryDirectory, "extension_api.json");
	const api = JSON.parse(fs.readFileSync(dumpPath, "utf8")) as ApiDump;
	const snapshot = {
		header: api.header ?? {},
		utility_functions: slimMethods(api.utility_functions),
		builtin_classes: slimClasses(api.builtin_classes),
		classes: slimClasses(api.classes),
	};
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, `${JSON.stringify(snapshot)}\n`, "utf8");
	console.log(`Generated ${outputPath}`);
} finally {
	const resolvedTempRoot = path.resolve(os.tmpdir());
	const resolvedTemporaryDirectory = path.resolve(temporaryDirectory);
	if (
		path.dirname(resolvedTemporaryDirectory) === resolvedTempRoot &&
		path.basename(resolvedTemporaryDirectory).startsWith(temporaryPrefix)
	) {
		fs.rmSync(resolvedTemporaryDirectory, { recursive: true, force: true });
	}
}

