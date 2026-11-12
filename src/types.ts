// The payload types of the sbud service's API, with the API's own camelCase names.

export type Agent = "claude" | "codex";

export interface ServiceInfo {
	apiVersion: number;
	version: string;
	pid: number;
	endpoint: string;
	startedAt: string;
}

/** A folder on this computer shared into a sandbox. */
export interface Folder {
	hostPath: string;
	readOnly: boolean;
}

export interface Volume {
	usedBytes: number;
	sizeBytes: number;
}

/** A kit a sandbox has. `current` is false when the kit changed since, and absent when the catalogue no longer lists it. */
export interface SandboxKit {
	version?: string;
	current?: boolean;
}

export interface SandboxSummary {
	name: string;
	agent: Agent | null;
	state: "running" | "stopped" | "unknown";
	ramGiB?: number;
	cpuPercent?: number;
	memoryMiB?: number;
	workspace: Folder | null;
	/** Extra folders, keyed by their path inside the sandbox without the leading slash. */
	mounts: Record<string, Folder>;
	login: string | null;
	kits: Record<string, SandboxKit>;
	openChats: number;
	openConsoles: number;
	historyVolume?: Volume | null;
	dockerVolume?: Volume | null;
	proxyCa?: "ok" | "wrong" | "unknown";
}

export interface Sandbox extends SandboxSummary {
	standardName: string | null;
	/** Null while the sandbox is stopped; "" for the agent's own default. */
	model: string | null;
	unmanagedKits: string[];
	historyVolume: Volume | null;
	dockerVolume: Volume | null;
	proxyCa: "ok" | "wrong" | "unknown";
}

export interface NewSandbox {
	agent: Agent;
	name: string;
	model: string;
	ramGiB: number;
	dockerGiB?: number;
	login: string;
	kits: { name: string; path: string }[];
	workspace: Folder | null;
	mounts: Folder[];
	template?: string;
}

export interface SandboxDefaults {
	agent: Agent;
	ramGiB: number;
	dockerGiB: number | null;
	model: { claude: string; codex: string };
	startTimeoutSeconds: number;
}

export interface Settings {
	memory: { trim: boolean; cacheKeepMiB: number; trimEverySeconds: number };
	models: { claude: string[]; codex: string[] };
	storageRoot: string | null;
	storageRootInUse: string;
}

export interface TaskInfo {
	id: string;
	title: string;
	sandbox?: string | null;
	state: "running" | "done" | "failed" | "cancelled";
	lines: string[];
	error?: string | null;
	recovery?: string[] | null;
	cancellable: boolean;
	startedAt: string;
	endedAt?: string | null;
}

export interface HostStats {
	cpuPercent?: number | null;
	memoryUsedMiB: number;
	memoryTotalMiB: number;
}

export interface Kit {
	name: string;
	path: string;
	default: boolean;
}

/** One operation of a JSON Patch (RFC 6902) over a sandbox's settings. */
export interface PatchOperation {
	op: "add" | "remove" | "replace" | "test";
	path: string;
	value?: unknown;
}

export interface Change {
	kind: "ram" | "folders" | "name" | "kit-add" | "kit-remove" | "kit-update" | "model" | "login" | "volume";
	from?: unknown;
	to?: unknown;
	kit?: string;
	fromVersion?: string;
	volume?: "history" | "docker";
	fromBytes?: number;
	toBytes?: number;
}

export interface ChangePlan {
	name: string;
	mode: "in-place" | "clone" | "rebuild";
	fresh: boolean;
	changes: Change[];
	steps: string[];
	restartsDaemon: boolean;
	stopsSandboxes: string[];
	growsVolumes: boolean;
	notes: string[];
}

export type ChatItem =
	| { kind: "user"; id: string; text: string }
	| { kind: "assistant"; id: string; text: string }
	| { kind: "tool"; id: string; name: string; summary: string; input: unknown; result?: { text: string; isError: boolean } }
	| { kind: "notice"; id: string; level: "info" | "error"; text: string };

export interface ChatSessionInfo {
	id: string;
	sandbox: string;
	agent: Agent;
	title: string;
	agentSessionId?: string;
	model?: string;
	busy: boolean;
}

export interface ChatEntry {
	open: boolean;
	chat: ChatSessionInfo | null;
	agentSessionId?: string;
	title: string;
	modifiedAt?: string;
	messages?: number;
}

export interface ConsoleInfo {
	id: string;
	sandbox: string;
	title: string;
	running: boolean;
	exitCode?: number;
}

export interface Label {
	label: string;
	patterns: string[];
	sandboxes: string[];
	logins: { agent: Agent; account?: string; expiresAt?: string; issuedAt?: string }[];
}

export interface PushReport {
	pushed: { sandbox: string; agent: Agent }[];
	failed: { sandbox: string; agent?: Agent; reason: string }[];
	skipped: { sandbox: string; reason: string }[];
	dropped: string[];
}

export interface SignIn {
	id: string;
	label: string;
	agent: Agent;
	mode: "terminal" | "browser";
	state: "running" | "need-code" | "finishing" | "done" | "failed" | "cancelled";
	url?: string;
	prompt?: string;
	retry?: string;
	message?: string;
}

export type Repair =
	| { type: "sbx-login" }
	| { type: "proxy-ca"; sandboxes: string[]; confirmStops: string[] }
	| { type: "history-restore"; sandbox: string; file: string };

export interface Problem {
	kind: "signed-out" | "proxy-ca" | "history-left";
	sandbox?: string;
	title: string;
	repair: Repair | null;
}

/** One message from the event stream: its channel and its data. */
export interface SbudEvent {
	channel: string;
	data: unknown;
}
