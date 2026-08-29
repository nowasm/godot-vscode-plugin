import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main() {
	const root = path.resolve(__dirname, "..");
	process.env.GODOT3_V2_PATH ??= "D:\\devlib\\godot\\godot-debug-v2\\bin\\godot.windows.opt.tools.64.exe";
	await runTests({
		vscodeExecutablePath: process.env.GODPARTY_VSCODE_PATH ?? "C:\\Users\\john\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
		extensionDevelopmentPath: root,
		extensionTestsPath: path.join(root, "out", "test", "debugger_v2_suite.js"),
		launchArgs: [path.join(root, "test_projects", "test-dap-project-godot3-v2"), "--disable-extensions"],
	});
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

