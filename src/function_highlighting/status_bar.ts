import * as vscode from "vscode";

import { describeFunctionIndexStatus, type FunctionIndexStatus } from "./status";

export class FunctionIndexStatusBar implements vscode.Disposable {
	private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);

	constructor(onDidChange: vscode.Event<FunctionIndexStatus>, initial: FunctionIndexStatus) {
		this.item.name = "GodParty function origin index";
		this.item.command = "godpartyGodotTools.functionHighlight.rebuildIndex";
		this.update(initial);
		this.subscription = onDidChange((status) => this.update(status));
	}

	private readonly subscription: vscode.Disposable;

	dispose(): void {
		this.subscription.dispose();
		this.item.dispose();
	}

	private update(status: FunctionIndexStatus): void {
		const description = describeFunctionIndexStatus(status);
		this.item.text = description.text;
		this.item.tooltip = description.tooltip;
		if (description.visible) {
			this.item.show();
		} else {
			this.item.hide();
		}
	}
}
