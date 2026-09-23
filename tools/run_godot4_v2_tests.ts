import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main() {
	const root = path.resolve(__dirname, "..");
	const project = path.join(root, "test_projects", "test-dap-project-godot4-v2");
	process.env.GODOT4_V2_PATH ??= "D:\\devlib\\godot\\godot-4.6.2-debug-v2\\bin\\godot.windows.editor.x86_64.exe";
	await runTests({
		vscodeExecutablePath: process.env.GODPARTY_VSCODE_PATH ?? "C:\\Users\\john\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
		extensionDevelopmentPath: root,
		extensionTestsPath: path.join(root, "out", "test", "godot4_v2_suite.js"),
		launchArgs: [project, "--disable-extensions"],
	});
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
