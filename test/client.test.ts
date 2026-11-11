import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { defaultEndpoint, SbudClient, SbudError } from "../src/index.js";

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
