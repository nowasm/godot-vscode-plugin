import * as path from "node:path";
import Mocha from "mocha";

export function run(): Promise<void> {
	const mocha = new Mocha({ ui: "tdd", color: true, timeout: 60_000 });
	mocha.addFile(path.resolve(__dirname, "godparty_workspace.test.js"));

	return new Promise((resolve, reject) => {
		mocha.run((failures) => {
			if (failures > 0) {
				reject(new Error(`${failures} GodParty workspace smoke test(s) failed.`));
			} else {
				resolve();
			}
		});
	});
}
