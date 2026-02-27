/**
 * stdout hygiene:
 * MCP uses stdout for JSON-RPC. Any logs to stdout will corrupt the protocol.
 * Route console log-like methods to stderr to keep stdout pure.
 */

function routeToStderr(...args: unknown[]): void {
  console.error(...args);
}

if (console.log !== routeToStderr) console.log = routeToStderr;
if (console.debug !== routeToStderr) console.debug = routeToStderr;
if (console.info !== routeToStderr) console.info = routeToStderr;
