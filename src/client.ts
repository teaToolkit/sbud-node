import { request, type IncomingMessage } from "node:http";
import { defaultEndpoint } from "./endpoint.js";
import { SbudError } from "./errors.js";
import type {
	ChangePlan,
	ChatEntry,
	ChatItem,
	ChatSessionInfo,
	ConsoleInfo,
	Folder,
	HostStats,
	Kit,
	Label,
	NewSandbox,
	PatchOperation,
	Problem,
	PushReport,
	Repair,
	Sandbox,
	SandboxDefaults,
	SandboxSummary,
	SbudEvent,
	ServiceInfo,
	Settings,
	SignIn,
	TaskInfo,
} from "./types.js";

const e = encodeURIComponent;

/** The id of an extra folder: its path inside the sandbox without the leading slash. `D:\work\x` is `d/work/x`. */
export function mountId(hostPath: string): string {
	let path = hostPath.replace(/\\/g, "/");
	if (/^[A-Za-z]:/.test(path)) path = "/" + path[0]!.toLowerCase() + path.slice(2);
	return path.replace(/\/+$/, "").replace(/^\/+/, "");
}

function stops(confirmStops: string[] | undefined): string {
	return query({ confirmStops: confirmStops?.join(",") || undefined });
}

function query(values: Record<string, string | undefined>): string {
	const parts = Object.entries(values)
		.filter((entry): entry is [string, string] => entry[1] !== undefined)
		.map(([key, value]) => `${key}=${e(value)}`);
	return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * Talks to the sbud service over its named pipe (Windows) or Unix socket (macOS, Linux). A refused or failed request
 * rejects with an SbudError.
 */
export class SbudClient {
	readonly endpoint: string;

	constructor(endpoint?: string) {
		this.endpoint = endpoint ?? defaultEndpoint();
	}

	// ---- Service, tasks and this computer ----

	/** GET /v1/service: the running service's API version, version, process and endpoint. */
	service(): Promise<ServiceInfo> {
		return this.send("GET", "/v1/service");
	}

	/** Stops the service, closing every chat and console. */
	stopService(): Promise<void> {
		return this.send("POST", "/v1/service/stop");
	}

	tasks(): Promise<TaskInfo[]> {
		return this.send("GET", "/v1/tasks");
	}

	task(id: string): Promise<TaskInfo> {
		return this.send("GET", `/v1/tasks/${e(id)}`);
	}

	cancelTask(id: string): Promise<TaskInfo> {
		return this.send("DELETE", `/v1/tasks/${e(id)}`);
	}

	/** Polls a task until it has ended. */
	async waitForTask(task: TaskInfo, intervalMs = 500): Promise<TaskInfo> {
		while (task.state === "running") {
			await new Promise((done) => setTimeout(done, intervalMs));
			task = await this.task(task.id);
		}
		return task;
	}

	host(): Promise<HostStats> {
		return this.send("GET", "/v1/host");
	}

	/**
	 * Follows the event stream, yielding each event as it comes. Without channels, every channel except `stats`. The
	 * stream does not reconnect by itself: when it ends, reload what you show and call events() again.
	 */
	async *events(channels?: string[], signal?: AbortSignal): AsyncGenerator<SbudEvent> {
		const res = await this.open("GET", `/v1/events${channels ? query({ channels: channels.join(",") }) : ""}`, signal);
		if ((res.statusCode ?? 0) >= 400) throw new SbudError("failed", `The event stream was refused (HTTP ${res.statusCode}).`, res.statusCode);
		let text = "";
		let channel = "";
		let data: string[] = [];
		res.setEncoding("utf8");
		try {
			for await (const chunk of res as AsyncIterable<string>) {
				text += chunk;
				let at: number;
				while ((at = text.indexOf("\n")) >= 0) {
					const line = text.slice(0, at).replace(/\r$/, "");
					text = text.slice(at + 1);
					if (line === "") {
						if (channel && data.length) yield { channel, data: JSON.parse(data.join("\n")) as unknown };
						channel = "";
						data = [];
					} else if (line.startsWith("event:")) channel = line.slice(6).trim();
					else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
				}
			}
		} catch (error) {
			if (!signal?.aborted) throw error;
		} finally {
			res.destroy();
		}
	}

	// ---- Settings and defaults ----

	settings(): Promise<Settings> {
		return this.send("GET", "/v1/settings");
	}

	/** Changes some settings with a JSON merge patch; null removes a key so its default applies. */
	patchSettings(patch: object): Promise<Settings> {
		return this.send("PATCH", "/v1/settings", patch, "application/merge-patch+json");
	}

	sandboxDefaults(): Promise<SandboxDefaults> {
		return this.send("GET", "/v1/sandbox-defaults");
	}

	patchSandboxDefaults(patch: object): Promise<SandboxDefaults> {
		return this.send("PATCH", "/v1/sandbox-defaults", patch, "application/merge-patch+json");
	}

	/** What a new sandbox in `folder` would get, ready to pass to createSandbox(). */
	defaultsForFolder(folder?: string, agent?: string): Promise<NewSandbox> {
		return this.send("GET", `/v1/sandbox-defaults/for-folder${query({ folder, agent })}`);
	}

	// ---- Sandboxes ----

	/** The sandboxes, running first, then by name; `workspace` keeps only that folder's sandboxes. */
	sandboxes(options: { workspace?: string; volumes?: boolean; proxyCa?: boolean } = {}): Promise<SandboxSummary[]> {
		const include = [options.volumes ? "volumes" : "", options.proxyCa ? "proxy-ca" : ""].filter(Boolean).join(",");
		return this.send("GET", `/v1/sandboxes${query({ workspace: options.workspace, include: include || undefined })}`);
	}

	/** Everything about one sandbox. It never starts a stopped sandbox. */
	sandbox(name: string): Promise<Sandbox> {
		return this.send("GET", `/v1/sandboxes/${e(name)}`);
	}

	/** Starts creating a sandbox and returns its task. */
	createSandbox(sandbox: NewSandbox): Promise<TaskInfo> {
		return this.send("POST", "/v1/sandboxes", sandbox);
	}

	/** What creating a sandbox would do, changing nothing. */
	async planSandbox(sandbox: NewSandbox): Promise<string[]> {
		return (await this.send<{ lines: string[] }>("POST", "/v1/sandboxes?dryRun=true", sandbox)).lines;
	}

	/** What a change to a sandbox would do, changing nothing. */
	planChange(name: string, operations: PatchOperation[], options: { mode?: "in-place" | "clone" | "rebuild"; fresh?: boolean } = {}): Promise<ChangePlan> {
		return this.send("PATCH", `/v1/sandboxes/${e(name)}${query({ mode: options.mode ?? "in-place", fresh: options.fresh ? "true" : undefined, dryRun: "true" })}`, operations, "application/json-patch+json");
	}

	/** Starts a change to a sandbox. `confirmStops` names the running sandboxes the user agreed to stop. */
	changeSandbox(
		name: string,
		operations: PatchOperation[],
		options: { mode?: "in-place" | "clone" | "rebuild"; fresh?: boolean; confirmStops?: string[] } = {},
	): Promise<TaskInfo> {
		const stops = options.confirmStops?.join(",");
		return this.send("PATCH", `/v1/sandboxes/${e(name)}${query({ mode: options.mode ?? "in-place", fresh: options.fresh ? "true" : undefined, confirmStops: stops || undefined })}`, operations, "application/json-patch+json");
	}

	/** Adds a kit to a sandbox, or reinstalls it at its current version. */
	/**
	 * Adds a kit to a sandbox, or reinstalls it at its current version. `path` is for a kit the catalogue does not list.
	 * `confirmStops`, here and in the other single-change calls, names the running sandboxes the user agreed to stop.
	 */
	putSandboxKit(name: string, kit: string, path?: string, confirmStops?: string[]): Promise<TaskInfo> {
		return this.send("PUT", `/v1/sandboxes/${e(name)}/kits/${e(kit)}${stops(confirmStops)}`, path ? { path } : undefined);
	}

	/** Removes a kit from a sandbox. */
	removeSandboxKit(name: string, kit: string, confirmStops?: string[]): Promise<TaskInfo> {
		return this.send("DELETE", `/v1/sandboxes/${e(name)}/kits/${e(kit)}${stops(confirmStops)}`);
	}

	/** Gives a sandbox a different main workspace. */
	setWorkspace(name: string, folder: Folder, confirmStops?: string[]): Promise<TaskInfo> {
		return this.send("PUT", `/v1/sandboxes/${e(name)}/workspace${stops(confirmStops)}`, folder);
	}

	/** Shares an extra folder into a sandbox. */
	addMount(name: string, folder: Folder, confirmStops?: string[]): Promise<TaskInfo> {
		return this.send("POST", `/v1/sandboxes/${e(name)}/mounts${stops(confirmStops)}`, folder);
	}

	/** Makes an extra folder read-only or writable. */
	setMountReadOnly(name: string, hostPath: string, readOnly: boolean, confirmStops?: string[]): Promise<TaskInfo> {
		return this.send("PATCH", `/v1/sandboxes/${e(name)}/mounts/${mountId(hostPath)}${stops(confirmStops)}`, { readOnly }, "application/merge-patch+json");
	}

	/** Stops sharing an extra folder; the folder itself is untouched. */
	removeMount(name: string, hostPath: string, confirmStops?: string[]): Promise<TaskInfo> {
		return this.send("DELETE", `/v1/sandboxes/${e(name)}/mounts/${mountId(hostPath)}${stops(confirmStops)}`);
	}

	/** Deletes a sandbox and sbud's records of it, never the folders shared into it. */
	deleteSandbox(name: string): Promise<void> {
		return this.send("DELETE", `/v1/sandboxes/${e(name)}`);
	}

	startSandbox(name: string): Promise<void> {
		return this.send("POST", `/v1/sandboxes/${e(name)}/start`);
	}

	stopSandbox(name: string): Promise<void> {
		return this.send("POST", `/v1/sandboxes/${e(name)}/stop`);
	}

	restartSandbox(name: string): Promise<void> {
		return this.send("POST", `/v1/sandboxes/${e(name)}/restart`);
	}

	/** Gets a sandbox ready before running sbx in a terminal. */
	openTerminalSession(name: string, kind: "agent" | "shell" = "agent"): Promise<{ id: string; argv: string[] }> {
		return this.send("POST", `/v1/sandboxes/${e(name)}/terminal-sessions`, { kind });
	}

	closeTerminalSession(name: string, id: string): Promise<void> {
		return this.send("DELETE", `/v1/sandboxes/${e(name)}/terminal-sessions/${e(id)}`);
	}

	// ---- Chats ----

	chats(name: string, options: { saved?: boolean; limit?: number } = {}): Promise<ChatEntry[]> {
		return this.send("GET", `/v1/sandboxes/${e(name)}/chats${query({ include: options.saved ? "saved" : undefined, limit: options.limit?.toString() })}`);
	}

	openChat(name: string, options: { model?: string | null; resume?: string | null } = {}): Promise<ChatSessionInfo> {
		return this.send("POST", `/v1/sandboxes/${e(name)}/chats`, { model: options.model ?? null, resume: options.resume ?? null });
	}

	chat(name: string, id: string): Promise<ChatSessionInfo> {
		return this.send("GET", `/v1/sandboxes/${e(name)}/chats/${e(id)}`);
	}

	chatItems(name: string, id: string): Promise<ChatItem[]> {
		return this.send("GET", `/v1/sandboxes/${e(name)}/chats/${e(id)}/items`);
	}

	setChatModel(name: string, id: string, model: string | null): Promise<ChatSessionInfo> {
		return this.send("PATCH", `/v1/sandboxes/${e(name)}/chats/${e(id)}`, { model }, "application/merge-patch+json");
	}

	sendChatMessage(name: string, id: string, text: string): Promise<void> {
		return this.send("POST", `/v1/sandboxes/${e(name)}/chats/${e(id)}/messages`, { text });
	}

	interruptChat(name: string, id: string): Promise<void> {
		return this.send("POST", `/v1/sandboxes/${e(name)}/chats/${e(id)}/interrupt`);
	}

	closeChat(name: string, id: string): Promise<void> {
		return this.send("DELETE", `/v1/sandboxes/${e(name)}/chats/${e(id)}`);
	}

	// ---- Consoles ----

	consoles(name: string): Promise<ConsoleInfo[]> {
		return this.send("GET", `/v1/sandboxes/${e(name)}/consoles`);
	}

	/** Starts bash in a sandbox. Its terminal is a WebSocket at /v1/sandboxes/{name}/consoles/{id}/terminal. */
	openConsole(name: string, rows = 24, cols = 80): Promise<ConsoleInfo> {
		return this.send("POST", `/v1/sandboxes/${e(name)}/consoles`, { rows, cols });
	}

	console(name: string, id: string): Promise<ConsoleInfo> {
		return this.send("GET", `/v1/sandboxes/${e(name)}/consoles/${e(id)}`);
	}

	closeConsole(name: string, id: string): Promise<void> {
		return this.send("DELETE", `/v1/sandboxes/${e(name)}/consoles/${e(id)}`);
	}

	// ---- Kit catalogue ----

	kits(): Promise<Kit[]> {
		return this.send("GET", "/v1/kits");
	}

	kit(name: string): Promise<Kit> {
		return this.send("GET", `/v1/kits/${e(name)}`);
	}

	addKit(kit: Kit): Promise<Kit> {
		return this.send("POST", "/v1/kits", kit);
	}

	patchKit(name: string, patch: Partial<Kit>): Promise<Kit> {
		return this.send("PATCH", `/v1/kits/${e(name)}`, patch, "application/merge-patch+json");
	}

	removeKit(name: string): Promise<void> {
		return this.send("DELETE", `/v1/kits/${e(name)}`);
	}

	// ---- Logins ----

	logins(): Promise<Label[]> {
		return this.send("GET", "/v1/logins");
	}

	login(label: string): Promise<Label> {
		return this.send("GET", `/v1/logins/${e(label)}`);
	}

	/** Renames a label with { label }, or replaces its patterns with { patterns }. */
	patchLogin(label: string, patch: { label?: string; patterns?: string[] }): Promise<Label> {
		return this.send("PATCH", `/v1/logins/${e(label)}`, patch, "application/merge-patch+json");
	}

	pushLogin(label: string): Promise<PushReport> {
		return this.send("POST", `/v1/logins/${e(label)}/push`);
	}

	deleteLogin(label: string, agent: string): Promise<void> {
		return this.send("DELETE", `/v1/logins/${e(label)}/${e(agent)}`);
	}

	hostLogin(agent: string): Promise<{ agent: string; file: string; exists: boolean }> {
		return this.send("GET", `/v1/host-logins/${e(agent)}`);
	}

	/** Stores the host's own login under a label. Ask first: the file belongs to whichever account this computer uses. */
	copyLoginFromHost(label: string, agent: string): Promise<{ label: Label; push: PushReport }> {
		return this.send("POST", `/v1/logins/${e(label)}/${e(agent)}/copy-from-host`);
	}

	startSignIn(label: string, agent: string): Promise<SignIn> {
		return this.send("POST", `/v1/logins/${e(label)}/${e(agent)}/sign-ins`);
	}

	signIn(id: string): Promise<SignIn> {
		return this.send("GET", `/v1/sign-ins/${e(id)}`);
	}

	sendSignInCode(id: string, code: string): Promise<void> {
		return this.send("POST", `/v1/sign-ins/${e(id)}/code`, { code });
	}

	cancelSignIn(id: string): Promise<void> {
		return this.send("DELETE", `/v1/sign-ins/${e(id)}`);
	}

	// ---- Maintenance ----

	diagnostics(): Promise<Problem[]> {
		return this.send("GET", "/v1/diagnostics");
	}

	repair(repair: Repair): Promise<TaskInfo> {
		return this.send("POST", "/v1/repairs", repair);
	}

	openapi(): Promise<Record<string, unknown>> {
		return this.send("GET", "/openapi/v1.json");
	}

	// ---- Transport ----

	/** Sends one request and resolves with the parsed JSON answer, or undefined when there is none. */
	async send<T>(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<T> {
		const res = await this.open(method, path, undefined, body === undefined ? undefined : JSON.stringify(body), contentType);
		const chunks: Buffer[] = [];
		for await (const chunk of res as AsyncIterable<Buffer>) chunks.push(chunk);
		const text = Buffer.concat(chunks).toString("utf8");
		const parsed: unknown = text ? JSON.parse(text) : undefined;
		const status = res.statusCode ?? 0;
		if (status >= 400) {
			const problem = (parsed ?? {}) as { kind?: string; title?: string; errors?: { field: string; message: string }[] };
			throw new SbudError(problem.kind ?? "failed", problem.title ?? `HTTP ${status}`, status, problem.errors ?? []);
		}
		return parsed as T;
	}

	private open(method: string, path: string, signal?: AbortSignal, body?: string, contentType?: string): Promise<IncomingMessage> {
		return new Promise((resolve, reject) => {
			const headers: Record<string, string> = { Accept: "application/json" };
			if (body !== undefined) {
				headers["Content-Type"] = contentType ?? "application/json";
				headers["Content-Length"] = Buffer.byteLength(body).toString();
			}
			const req = request({ socketPath: this.endpoint, method, path, headers, signal }, resolve);
			req.on("error", (error) =>
				reject(signal?.aborted ? error : new SbudError("unavailable", `The sbud service is not answering at ${this.endpoint}.`)),
			);
			req.end(body);
		});
	}
}
