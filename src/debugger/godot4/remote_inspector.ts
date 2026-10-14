import type { GodotObject } from "./variables/godot_object_promise";

/** Requests for the remote Inspector outlive individual breakpoint variable caches. */
export class RemoteInspector {
	private pending = new Map<
		bigint,
		{
			promise: Promise<GodotObject>;
			resolve: (object: GodotObject) => void;
			reject: (error: Error) => void;
			timer: NodeJS.Timeout;
		}
	>();

	constructor(
		private send: (id: bigint) => void,
		private timeout = 5000,
	) {}

	public inspect(id: bigint): Promise<GodotObject> {
		const existing = this.pending.get(id);
		if (existing) return existing.promise;
		let resolve!: (object: GodotObject) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<GodotObject>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const timer = setTimeout(() => {
			this.pending.delete(id);
			reject(new Error("The remote node did not respond. It may have been removed from the scene."));
		}, this.timeout);
		this.pending.set(id, { promise, resolve, reject, timer });
		this.send(id);
		return promise;
	}

	public resolve(parameters: any[]): void {
		if (parameters.length < 3) {
			this.clear("The remote node no longer exists.");
			return;
		}
		const id = BigInt.asUintN(64, BigInt(parameters[0]));
		const request = this.pending.get(id);
		if (!request) return;
		clearTimeout(request.timer);
		this.pending.delete(id);
		let category = "";
		const sub_values: GodotObject["sub_values"] = [];
		for (const [name, , , , usage, value] of parameters[2]) {
			if (usage & 128) {
				category = name;
				continue;
			}
			const property_name = category ? `${category}/${name}` : name.replace(/^(Members|Constants)\//, "");
			sub_values.push({ name: property_name, value });
		}
		request.resolve({ godot_id: id, type: parameters[1], sub_values });
	}

	public clear(reason = "The debug session has ended."): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(new Error(reason));
		}
		this.pending.clear();
	}
}
