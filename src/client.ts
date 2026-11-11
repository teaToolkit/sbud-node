import { request } from "node:http";
import { defaultEndpoint } from "./endpoint.js";
import { SbudError } from "./errors.js";

export interface ServiceInfo {
	apiVersion: number;
	version: string;
	pid: number;
	endpoint: string;
	startedAt: string;
}

/** Talks to the sbud service over its named pipe (Windows) or Unix socket (macOS, Linux). */
export class SbudClient {
	readonly endpoint: string;

	constructor(endpoint?: string) {
		this.endpoint = endpoint ?? defaultEndpoint();
	}

	/** GET /v1/service: the running service's API version, version, process and endpoint. */
	service(): Promise<ServiceInfo> {
		return this.send<ServiceInfo>("GET", "/v1/service");
	}

	private send<T>(method: string, path: string): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const req = request({ socketPath: this.endpoint, method, path, headers: { Accept: "application/json" } }, (res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					const body: unknown = text ? JSON.parse(text) : null;
					const status = res.statusCode ?? 0;
					if (status >= 400) {
						const problem = (body ?? {}) as { kind?: string; title?: string };
						reject(new SbudError(problem.kind ?? "failed", problem.title ?? `HTTP ${status}`, status));
					} else {
						resolve(body as T);
					}
				});
				res.on("error", reject);
			});
			req.on("error", () => reject(new SbudError("unavailable", `The sbud service is not answering at ${this.endpoint}.`)));
			req.end();
		});
	}
}
