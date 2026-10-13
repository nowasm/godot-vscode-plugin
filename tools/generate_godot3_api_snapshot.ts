import * as fs from "node:fs";
import * as path from "node:path";

type ApiMethod = { name: string; is_virtual?: boolean; return_value?: { type: string } };
type ApiMember = { name: string; type?: string };
type ApiClass = {
	name: string;
	inherits?: string;
	methods: ApiMethod[];
	properties: ApiMember[];
	signals: Array<{ name: string }>;
};

const BUILTIN_CLASSES = new Set([
	"AABB",
	"Array",
	"Basis",
	"Color",
	"Dictionary",
	"NodePath",
	"Plane",
	"PoolByteArray",
	"PoolColorArray",
	"PoolIntArray",
	"PoolRealArray",
	"PoolStringArray",
	"PoolVector2Array",
	"PoolVector3Array",
	"Quat",
	"Rect2",
	"RID",
	"String",
	"Transform",
	"Transform2D",
	"Vector2",
	"Vector3",
]);

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function attribute(source: string, name: string): string | undefined {
	return new RegExp(`\\b${name}="([^"]*)"`).exec(source)?.[1];
}

function parseClass(filePath: string): ApiClass {
	const xml = fs.readFileSync(filePath, "utf8");
	const classTag = /<class\b([^>]*)>/.exec(xml)?.[1];
	const name = classTag ? attribute(classTag, "name") : undefined;
	if (!name) throw new Error(`No class name in ${filePath}`);
	const methods: ApiMethod[] = [];
	for (const match of xml.matchAll(/<method\b([^>]*)>([\s\S]*?)<\/method>/g)) {
		const methodName = attribute(match[1], "name");
		if (!methodName) continue;
		const returnType = /<return\b([^>]*)\/>/.exec(match[2]);
		const type = returnType ? attribute(returnType[1], "type") : undefined;
		methods.push({
			name: methodName,
			...(attribute(match[1], "qualifiers")?.includes("virtual") ? { is_virtual: true } : {}),
			...(type ? { return_value: { type } } : {}),
		});
	}
	const properties: ApiMember[] = [];
	for (const match of xml.matchAll(/<member\b([^>]*)>/g)) {
		const memberName = attribute(match[1], "name");
		if (memberName) properties.push({ name: memberName, type: attribute(match[1], "type") });
	}
	const signals: Array<{ name: string }> = [];
	for (const match of xml.matchAll(/<signal\b([^>]*)>/g)) {
		const signalName = attribute(match[1], "name");
		if (signalName) signals.push({ name: signalName });
	}
	const inherits = attribute(classTag ?? "", "inherits");
	return { name, ...(inherits ? { inherits } : {}), methods, properties, signals };
}

const godotSource = argument("--godot-source");
if (!godotSource)
	throw new Error("Usage: ts-node tools/generate_godot3_api_snapshot.ts --godot-source <Godot 3 source>");
const docsDirectory = path.join(godotSource, "doc", "classes");
const classes = fs
	.readdirSync(docsDirectory)
	.filter((name) => name.endsWith(".xml") && name !== "@GlobalScope.xml")
	.map((name) => parseClass(path.join(docsDirectory, name)));
const gdscript = parseClass(path.join(godotSource, "modules", "gdscript", "doc_classes", "@GDScript.xml"));
const outputPath = path.resolve(argument("--output") ?? path.join("resources", "godot_api", "godot-3.6.json"));
const snapshot = {
	header: { version_major: 3, version_minor: 6, version_patch: 0, version_status: "stable" },
	utility_functions: gdscript.methods,
	builtin_classes: classes
		.filter((entry) => BUILTIN_CLASSES.has(entry.name))
		.map((entry) => ({ name: entry.name, methods: entry.methods, members: entry.properties })),
	classes: classes.filter((entry) => !BUILTIN_CLASSES.has(entry.name)),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(snapshot)}\n`, "utf8");
console.log(`Generated ${outputPath}`);
