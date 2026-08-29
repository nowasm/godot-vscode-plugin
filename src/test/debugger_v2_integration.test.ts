import { ok } from "node:assert";
import * as vscode from "vscode";

function percentile95(values: number[]) {
	const ordered = [...values].sort((a, b) => a - b);
	return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
}

async function retry<T>(operation: () => Thenable<T>, timeoutMs = 5000): Promise<T> {
	const deadline = performance.now() + timeoutMs;
	let lastError: unknown;
	while (performance.now() < deadline) {
		try { return await operation(); } catch (error) { lastError = error; }
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw lastError ?? new Error("Timed out waiting for debugger state");
}

suite("Godot 3 debugger protocol v2 DAP", () => {
	test("steps 50 times with acknowledged control and lazy variables", async () => {
		const extension = vscode.extensions.getExtension("godparty.godparty-godot-tools");
		ok(extension);
		await extension.activate();
		const folder = vscode.workspace.workspaceFolders?.[0];
		ok(folder);
		const godotPath = process.env.GODOT3_V2_PATH;
		ok(godotPath, "GODOT3_V2_PATH is required");
		const started = await vscode.debug.startDebugging(folder, {
			name: "Godot 3 protocol v2 integration",
			type: "godot",
			request: "launch",
			project: folder.uri.fsPath,
			editor_path: godotPath,
			address: "127.0.0.1",
			port: 6137,
			additional_options: "--no-window --audio-driver Dummy --script main.gd",
		});
		ok(started);
		const session = await retry(async () => {
			const active = vscode.debug.activeDebugSession;
			if (!active) throw new Error("Debug session is not active");
			const stack = await active.customRequest("stackTrace", { threadId: 0, startFrame: 0, levels: 100 });
			if (!stack.stackFrames?.length) throw new Error("Debugger has not stopped yet");
			return active;
		}, 15_000);

		const stack = await session.customRequest("stackTrace", { threadId: 0, startFrame: 0, levels: 100 });
		const scopes = await session.customRequest("scopes", { frameId: stack.stackFrames[0].id });
		const locals = scopes.scopes.find((scope: any) => scope.name === "Locals");
		ok(locals);
		const localPage = await session.customRequest("variables", { variablesReference: locals.variablesReference, start: 0, count: 100 });
		ok(localPage.variables.length <= 100);
		const hugeArray = localPage.variables.find((variable: any) => variable.name === "huge_array");
		ok(hugeArray?.variablesReference > 0);
		const arrayPage = await session.customRequest("variables", { variablesReference: hugeArray.variablesReference, start: 100, count: 100 });
		ok(arrayPage.variables.length === 100);

		const ackLatencies: number[] = [];
		const stopLatencies: number[] = [];
		for (let index = 0; index < 50; index++) {
			const began = performance.now();
			await session.customRequest("next", { threadId: 0 });
			ackLatencies.push(performance.now() - began);
			await retry(async () => {
				const nextStack = await session.customRequest("stackTrace", { threadId: 0, startFrame: 0, levels: 1 });
				if (!nextStack.stackFrames?.length) throw new Error("No next stop yet");
				return nextStack;
			}, 2000);
			stopLatencies.push(performance.now() - began);
		}
		const ackP95 = percentile95(ackLatencies);
		const stopP95 = percentile95(stopLatencies);
		console.log(`Godot 3 v2 DAP: ack_p95=${ackP95.toFixed(2)}ms stop_p95=${stopP95.toFixed(2)}ms`);
		ok(ackP95 <= 100, `ACK P95 ${ackP95.toFixed(2)}ms exceeds 100ms`);
		ok(stopP95 <= 300, `next stop P95 ${stopP95.toFixed(2)}ms exceeds 300ms`);
		await vscode.debug.stopDebugging(session);
	});
});
