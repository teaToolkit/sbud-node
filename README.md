# sbud for Node

The Node client for the sbud service, for Node 20 and later. This early preview has one call, `service()` on `SbudClient`, which reads the running service's version. The service itself has not been released yet, so the preview has been tested only against a stand-in service.

```js
import { SbudClient } from "@teatoolkit/sbud";

console.log((await new SbudClient().service()).version);
```
