/** Detect the Godot major version from project.godot without invoking an editor. */
export function parseGodotProjectVersion(source: string): string | undefined {
	const formatMatch = /^\s*config_version\s*=\s*(\d+)\s*$/m.exec(source);
	const formatVersion = formatMatch ? Number(formatMatch[1]) : undefined;
	const major = formatVersion === 5 ? "4" : formatVersion !== undefined && formatVersion <= 4 ? "3" : undefined;

	const featuresMatch = /^\s*config\/features\s*=\s*(?:PackedStringArray|PoolStringArray)\s*\(([^\n]*)\)/m.exec(source);
	const featureVersion = featuresMatch?.[1].match(/"([34]\.\d+(?:\.\d+)?)"/)?.[1];
	if (featureVersion && (!major || featureVersion.startsWith(`${major}.`))) {
		return featureVersion;
	}
	if (major) {
		return `${major}.x`;
	}
	return formatVersion === undefined ? "3.x" : undefined;
}
