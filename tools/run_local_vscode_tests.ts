import * as fs from "node:fs";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
	const root = path.resolve(__dirname, "..");
	const godpartySmoke = process.argv.includes("--godparty");
	const allTests = process.argv.includes("--all");
	const godotPath =
		process.env.GODPARTY_GODOT_PATH ??
		"D:\\work_mine\\godparty\\GodotEditor\\Godot_v4.6.2-stable_win64.exe";
	const vscodeExecutablePath =
		process.env.GODPARTY_VSCODE_PATH ??
		"C:\\Users\\john\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";
	if (allTests) {
		const settingsDirectory = path.join(
			root,
			"test_projects",
			"test-dap-project-godot4",
			".vscode",
		);
		fs.mkdirSync(settingsDirectory, { recursive: true });
		fs.writeFileSync(
			path.join(settingsDirectory, "settings.json"),
			`${JSON.stringify({ "godotTools.editorPath.godot4": godotPath }, null, 2)}\n`,
			"utf8",
		);
	}
	await runTests({
		vscodeExecutablePath,
		extensionDevelopmentPath: root,
		extensionTestsPath: path.join(
			root,
			"out",
			"test",
			allTests
				? "all_tests_suite.js"
				: godpartySmoke
					? "godparty_smoke_suite.js"
					: "function_highlighting_suite.js",
		),
		launchArgs: [
			allTests
				? path.join(root, "test_projects", "test-dap-project-godot4")
				: godpartySmoke
				? "D:\\work_mine\\godparty\\GodClient"
				: path.join(root, "test_projects", "function-highlighting"),
			"--disable-extensions",
		],
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
