import { deepStrictEqual, strictEqual } from "node:assert";
import * as path from "node:path";

import {
	type ApiFileSystem,
	type ApiProcessRunner,
	loadGodotApi,
} from "./godot_api_loader";

const API_JSON = JSON.stringify({
	header: {
		version_major: 4,
		version_minor: 6,
		version_patch: 2,
		version_status: "stable",
	},
	utility_functions: [{ name: "print" }],
});

class MemoryFileSystem implements ApiFileSystem {
	readonly files = new Map<string, string>();
	readonly touched: string[] = [];

	async exists(filePath: string): Promise<boolean> {
		return this.files.has(filePath);
	}

	async readFile(filePath: string): Promise<string> {
		this.touched.push(filePath);
		const value = this.files.get(filePath);
		if (value === undefined) {
			throw new Error(`missing: ${filePath}`);
		}
		return value;
	}

	async writeFile(filePath: string, contents: string): Promise<void> {
		this.touched.push(filePath);
		this.files.set(filePath, contents);
	}

	async mkdir(directory: string): Promise<void> {
		this.touched.push(directory);
	}

	async rename(from: string, to: string): Promise<void> {
		this.touched.push(from, to);
		const value = this.files.get(from);
		if (value === undefined) {
			throw new Error(`missing: ${from}`);
		}
		this.files.set(to, value);
		this.files.delete(from);
	}

	async removeFile(filePath: string): Promise<void> {
		this.touched.push(filePath);
		this.files.delete(filePath);
	}
}

class FakeRunner implements ApiProcessRunner {
	readonly calls: Array<{ executable: string; args: string[]; cwd: string }> = [];

	constructor(
		private readonly fileSystem: MemoryFileSystem,
		private readonly failure?: Error,
	) {}

	async run(executable: string, args: string[], cwd: string): Promise<void> {
		this.calls.push({ executable, args, cwd });
		if (this.failure) {
			throw this.failure;
		}
		this.fileSystem.files.set(path.join(cwd, "extension_api.json"), API_JSON);
	}
}

suite("GodotApiLoader", () => {
	const cacheDir = path.join("C:\\cache", "godparty");
	const bundledSnapshotPath = path.join("C:\\extension", "godot-4.6.json");
	const cachePath = path.join(cacheDir, "extension-api-4.6.2-stable.json");

	test("reuses a valid versioned cache", async () => {
		const fileSystem = new MemoryFileSystem();
		fileSystem.files.set(cachePath, API_JSON);
		fileSystem.files.set(bundledSnapshotPath, API_JSON);
		const runner = new FakeRunner(fileSystem);

		const result = await loadGodotApi({
			cacheDir,
			bundledSnapshotPath,
			godotPath: "godot.exe",
			godotVersion: "4.6.2-stable",
			fileSystem,
			runner,
		});

		strictEqual(result.source, "cache");
		strictEqual(result.index.hasUtilityFunction("print"), true);
		strictEqual(runner.calls.length, 0);
	});

	test("generates an API dump only inside the cache directory", async () => {
		const fileSystem = new MemoryFileSystem();
		fileSystem.files.set(bundledSnapshotPath, API_JSON);
		const runner = new FakeRunner(fileSystem);

		const result = await loadGodotApi({
			cacheDir,
			bundledSnapshotPath,
			godotPath: "godot.exe",
			godotVersion: "4.6.2-stable",
			fileSystem,
			runner,
		});

		strictEqual(result.source, "generated");
		deepStrictEqual(runner.calls, [
			{
				executable: "godot.exe",
				args: ["--headless", "--dump-extension-api"],
				cwd: cacheDir,
			},
		]);
		strictEqual(fileSystem.files.has(cachePath), true);
		strictEqual(fileSystem.files.has(path.join(cacheDir, "extension_api.json")), false);
	});

	test("falls back without touching paths outside cache and bundle", async () => {
		const fileSystem = new MemoryFileSystem();
		fileSystem.files.set(bundledSnapshotPath, API_JSON);
		const runner = new FakeRunner(fileSystem, new Error("cannot start Godot"));

		const result = await loadGodotApi({
			cacheDir,
			bundledSnapshotPath,
			godotPath: "missing.exe",
			godotVersion: "4.6.2-stable",
			fileSystem,
			runner,
		});

		strictEqual(result.source, "fallback");
		strictEqual(result.warning?.includes("cannot start Godot"), true);
		strictEqual(
			fileSystem.touched.every(
				(filePath) => filePath.startsWith(cacheDir) || filePath === bundledSnapshotPath,
			),
			true,
		);
	});
});

