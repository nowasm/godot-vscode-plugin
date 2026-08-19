import * as fs from "node:fs";
import * as path from "node:path";
import Mocha from "mocha";

function collectTests(directory: string): string[] {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return collectTests(fullPath);
		}
		return entry.name.endsWith(".test.js") && !fullPath.includes(`${path.sep}test${path.sep}`) ? [fullPath] : [];
	});
}

export function run(): Promise<void> {
	const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30_000 });
	for (const testFile of collectTests(path.resolve(__dirname, ".."))) {
		mocha.addFile(testFile);
	}

	return new Promise((resolve, reject) => {
		mocha.run((failures) => {
			if (failures > 0) {
				reject(new Error(`${failures} complete test-suite case(s) failed.`));
			} else {
				resolve();
			}
		});
	});
}
