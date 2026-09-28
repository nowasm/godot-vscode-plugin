/** Select the editor's default GDScript language-server port from the project version. */
export function resolveEditorLspPort(
	projectVersion: string | undefined,
	configuredPort: number,
	hasExplicitPort: boolean,
): number {
	if (hasExplicitPort) {
		return configuredPort;
	}
	if (projectVersion?.startsWith("4.")) {
		return 6005;
	}
	if (projectVersion?.startsWith("3.")) {
		return 6008;
	}
	return configuredPort;
}
