export interface ProjectAutoload {
	name: string;
	resourcePath: string;
}

export function parseProjectAutoloads(source: string): ProjectAutoload[] {
	const result: ProjectAutoload[] = [];
	let inAutoloadSection = false;
	for (const line of source.split(/\r?\n/)) {
		const section = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1];
		if (section) {
			inAutoloadSection = section === "autoload";
			continue;
		}
		if (!inAutoloadSection) {
			continue;
		}
		const match = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*["']\*?(res:\/\/[^"']+)["']/);
		if (match) {
			result.push({ name: match[1], resourcePath: match[2] });
		}
	}
	return result;
}
