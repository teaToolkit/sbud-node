import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { defaultEndpoint, mountId, SbudClient, SbudError } from "../src/index.js";

let folder: string;
let socketPath: string;
let server: Server | undefined;

beforeEach(() => {
	folder = mkdtempSync(join(tmpdir(), "sbud-"));
	socketPath = join(folder, "sbud.sock");
});

afterEach(async () => {
	if (server) await new Promise((done) => server!.close(done));
	server = undefined;
	rmSync(folder, { recursive: true, force: true });
});

function serve(status: number, body: object): Promise<void> {
	server = createServer((req, res) => {
		assert.equal(`${req.method} ${req.url}`, "GET /v1/service");
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	});
	return new Promise((done) => server!.listen(socketPath, done));
}

const info = { apiVersion: 1, version: "0.1.0", pid: 4242, endpoint: "/run/user/1000/sbud.sock", startedAt: "2026-11-11T10:00:00Z" };

test("service() reads the service info", async () => {
	await serve(200, info);
	assert.deepEqual(await new SbudClient(socketPath).service(), info);
});

test("problem details become an SbudError", async () => {
	await serve(401, { status: 401, kind: "unauthenticated", title: "Not the service's user." });
	await assert.rejects(new SbudClient(socketPath).service(), (error: SbudError) => {
		assert.equal(error.kind, "unauthenticated");
		assert.equal(error.status, 401);
		return true;
	});
});

test("no service is unavailable", async () => {
	await assert.rejects(new SbudClient(socketPath).service(), (error: SbudError) => error.kind === "unavailable");
});

test("SBUD_SOCKET overrides the endpoint", () => {
	assert.equal(defaultEndpoint({ SBUD_SOCKET: "/tmp/elsewhere.sock" }, "linux"), "/tmp/elsewhere.sock");
	assert.equal(defaultEndpoint({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux"), "/run/user/1000/sbud.sock");
});

test("a change goes as a JSON Patch with its query, and field errors come with the error", async () => {
	let seen = "";
	server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk: Buffer) => (body += chunk.toString()));
		req.on("end", () => {
			seen = `${req.method} ${req.url} ${req.headers["content-type"]} ${body}`;
			res.writeHead(422, { "Content-Type": "application/problem+json" });
			res.end(JSON.stringify({ status: 422, kind: "invalid", title: "Some fields are wrong.", errors: [{ field: "[0].op", message: "No." }] }));
		});
	});
	await new Promise<void>((done) => server!.listen(socketPath, done));
	const error = await new SbudClient(socketPath)
		.changeSandbox("a", [{ op: "replace", path: "/ramGiB", value: 8 }], { mode: "clone", confirmStops: ["a", "b"] })
		.then(() => undefined, (e: unknown) => e);
	assert.ok(error instanceof SbudError);
	assert.equal(error.status, 422);
	assert.deepEqual(error.errors, [{ field: "[0].op", message: "No." }]);
	assert.equal(seen, 'PATCH /v1/sandboxes/a?mode=clone&confirmStops=a%2Cb application/json-patch+json [{"op":"replace","path":"/ramGiB","value":8}]');
});

test("events are read from the stream as they arrive", async () => {
	server = createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		res.write(": connected\n\nevent: task\nda");
		setTimeout(() => res.end('ta: {"id":"t1"}\n\n: keep-alive\n\nevent: sandboxes\ndata: {}\n\n'), 20);
	});
	await new Promise<void>((done) => server!.listen(socketPath, done));
	const seen: string[] = [];
	for await (const ev of new SbudClient(socketPath).events(["task", "sandboxes"])) seen.push(`${ev.channel} ${JSON.stringify(ev.data)}`);
	assert.deepEqual(seen, ['task {"id":"t1"}', "sandboxes {}"]);
});

test("an extra folder is named by its path inside the sandbox", () => {
	assert.equal(mountId("D:\\work\\shared\\"), "d/work/shared");
	assert.equal(mountId("/home/me/x"), "home/me/x");
});

test("a single change carries the stops the user agreed to", async () => {
	let seen = "";
	server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk: Buffer) => (body += chunk.toString()));
		req.on("end", () => {
			seen = `${req.method} ${req.url} ${req.headers["content-type"]} ${body}`;
			res.writeHead(202, { "Content-Type": "application/json" });
			res.end("{}");
		});
	});
	await new Promise<void>((done) => server!.listen(socketPath, done));
	await new SbudClient(socketPath).setMountReadOnly("a", "D:\\work\\shared", true, ["a", "b"]);
	assert.equal(seen, 'PATCH /v1/sandboxes/a/mounts/d/work/shared?confirmStops=a%2Cb application/merge-patch+json {"readOnly":true}');
});
