# sbud for Node

The Node client for the sbud service, for Node 20 and later, with no dependencies. `SbudClient` has a method for each route of the service's API: sandboxes and changes to them, chats, consoles, the kit catalogue, logins and sign-ins, diagnostics and repairs, settings, tasks and the event stream. The package includes TypeScript types for every answer. A refused request rejects with `SbudError`, which lists every faulty field when there are several.

```js
import { SbudClient } from "@teatoolkit/sbud";

const client = new SbudClient();
for (const sandbox of await client.sandboxes()) console.log(sandbox.name, sandbox.state);

for await (const event of client.events(["task"])) console.log(event.channel, event.data);
```

The service has not been released yet. This client has been tested against the service on Linux, with a stand-in for Docker Sandboxes; the Windows named-pipe path has not been run.
