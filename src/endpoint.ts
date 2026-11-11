import { homedir, userInfo } from "node:os";
import { join } from "node:path";

/** The service's endpoint: SBUD_SOCKET if set, else the named pipe or socket the service uses by default. */
export function defaultEndpoint(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
	if (env.SBUD_SOCKET) return env.SBUD_SOCKET;
	if (platform === "win32") {
		const user = userInfo().username.replace(/[^A-Za-z0-9._-]/g, "_");
		return `\\\\.\\pipe\\sbud-${user}`;
	}
	if (env.XDG_RUNTIME_DIR) return join(env.XDG_RUNTIME_DIR, "sbud.sock");
	return join(env.SBUD_HOME || join(homedir(), ".sbud"), "sbud.sock");
}
