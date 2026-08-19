import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { GodotApiIndex } from "./godot_api_index";

export interface ApiFileSystem {
	exists(filePath: string): Promise<boolean>;
	readFile(filePath: string): Promise<string>;
	writeFile(filePath: string, contents: string): Promise<void>;
	mkdir(directory: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	removeFile(filePath: string): Promise<void>;
}

export interface ApiProcessRunner {
	run(executable: string, args: string[], cwd: string): Promise<void>;
}

export interface GodotApiLoadOptions {
	cacheDir: string;
	bundledSnapshotPath: string;
	godotPath?: string;
	godotVersion?: string;
	fileSystem?: ApiFileSystem;
	runner?: ApiProcessRunner;
}

export interface GodotApiLoadResult {
	index: GodotApiIndex;
	source: "cache" | "generated" | "fallback";
	warning?: string;
}

export const nodeApiFileSystem: ApiFileSystem = {
	async exists(filePath) {
		try {
			await fs.promises.access(filePath);
			return true;
		} catch {
			return false;
		}
	},
	readFile(filePath) {
		return fs.promises.readFile(filePath, "utf8");
	},
	async writeFile(filePath, contents) {
		await fs.promises.writeFile(filePath, contents, "utf8");
	},
	async mkdir(directory) {
		await fs.promises.mkdir(directory, { recursive: true });
	},
	rename(from, to) {
		return fs.promises.rename(from, to);
	},
	async removeFile(filePath) {
		try {
			await fs.promises.unlink(filePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	},
};

export const nodeApiProcessRunner: ApiProcessRunner = {
	run(executable, args, cwd) {
		return new Promise<void>((resolve, reject) => {
			execFile(executable, args, { cwd, windowsHide: true }, (error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	},
};

function normalizeCacheKey(version: string): string {
	return version.replace(/[^A-Za-z0-9._-]/g, "-");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function loadGodotApi(options: GodotApiLoadOptions): Promise<GodotApiLoadResult> {
	const fileSystem = options.fileSystem ?? nodeApiFileSystem;
	const runner = options.runner ?? nodeApiProcessRunner;
	const warnings: string[] = [];
	await fileSystem.mkdir(options.cacheDir);

	const version = options.godotVersion?.trim();
	const cachePath = version
		? path.join(options.cacheDir, `extension-api-${normalizeCacheKey(version)}.json`)
		: undefined;

	if (cachePath && (await fileSystem.exists(cachePath))) {
		try {
			const cached = await fileSystem.readFile(cachePath);
			return { index: GodotApiIndex.fromJson(cached), source: "cache" };
		} catch (error) {
			warnings.push(`Invalid Godot API cache: ${errorMessage(error)}`);
		}
	}

	if (cachePath && options.godotPath) {
		const generatedPath = path.join(options.cacheDir, "extension_api.json");
		const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
		try {
			await runner.run(options.godotPath, ["--headless", "--dump-extension-api"], options.cacheDir);
			const generated = await fileSystem.readFile(generatedPath);
			const index = GodotApiIndex.fromJson(generated);
			await fileSystem.writeFile(temporaryPath, generated);
			await fileSystem.removeFile(cachePath);
			await fileSystem.rename(temporaryPath, cachePath);
			await fileSystem.removeFile(generatedPath);
			return { index, source: "generated" };
		} catch (error) {
			warnings.push(`Could not generate Godot API: ${errorMessage(error)}`);
			await fileSystem.removeFile(temporaryPath);
		}
	}

	const bundled = await fileSystem.readFile(options.bundledSnapshotPath);
	return {
		index: GodotApiIndex.fromJson(bundled),
		source: "fallback",
		warning: warnings.length > 0 ? warnings.join("; ") : undefined,
	};
}
