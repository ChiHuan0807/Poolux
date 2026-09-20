#!/usr/bin/env node
/**
 * Figma MCP WebSocket relay.
 *
 * The official Talk To Figma socket server (cursor-talk-to-figma-socket) and the
 * Cursor MCP server (cursor-talk-to-figma-mcp) both hard-code port 3055.
 * The Figma plugin has an editable "WebSocket Server Port" field, so if the
 * plugin is set to another port (e.g. 3054), this relay bridges that port to
 * 3055 so no package patching is needed.
 *
 * NOTE: the plugin's manifest.json declares its allowed network domains. The
 * official manifest only allows "ws://localhost:3055", and Figma blocks any
 * other host/port on the plugin side. If the plugin shows "Connection error"
 * while this relay sees no incoming connection, that allowlist is the reason:
 * set the plugin's port field back to 3055 instead of relaying.
 *
 * Usage:
 *   node scripts/figma-ws-relay.mjs            # 3054 -> 3055
 *   node scripts/figma-ws-relay.mjs 3053 3055  # custom from/to
 */

import net from "node:net";

const FROM_PORT = Number(process.argv[2] || 3054);
const TO_PORT = Number(process.argv[3] || 3055);
const TO_HOST = "127.0.0.1";

const ts = () => new Date().toLocaleTimeString();
let connectionSeq = 0;

function handleClient(client, label) {
  const id = ++connectionSeq;
  process.stdout.write(`[figma-relay] ${ts()} #${id} incoming on ${label}\n`);

  const upstream = net.connect({ host: TO_HOST, port: TO_PORT });
  let closed = false;

  const cleanup = (why) => {
    if (closed) return;
    closed = true;
    process.stdout.write(
      `[figma-relay] ${ts()} #${id} closed (${why}, ${client.bytesRead} bytes in / ${client.bytesWritten} bytes out)\n`
    );
    client.destroy();
    upstream.destroy();
  };

  client.on("error", (err) => cleanup("client error: " + err.message));
  upstream.on("error", (err) => {
    process.stderr.write(
      `[figma-relay] ${ts()} #${id} cannot reach ${TO_HOST}:${TO_PORT}: ${err.message}\n`
    );
    cleanup("upstream error");
  });
  client.on("close", () => cleanup("client closed"));
  upstream.on("close", () => cleanup("upstream closed"));

  client.pipe(upstream);
  upstream.pipe(client);
}

let listening = 0;
const expected = 2;
const noteReady = () => {
  listening += 1;
  if (listening === expected) {
    process.stdout.write(
      `[figma-relay] ready: ${FROM_PORT} -> ${TO_HOST}:${TO_PORT}\n`
    );
  }
};

const v4 = net.createServer((client) => handleClient(client, `127.0.0.1:${FROM_PORT}`));
v4.on("listening", () => {
  process.stdout.write(`[figma-relay] listening on 127.0.0.1:${FROM_PORT}\n`);
  noteReady();
});
v4.on("error", (err) => {
  process.stderr.write(`[figma-relay] failed to bind 127.0.0.1:${FROM_PORT}: ${err.message}\n`);
  process.exit(1);
});
v4.listen({ host: "127.0.0.1", port: FROM_PORT });

// Also accept IPv6 loopback (::1), because browsers may resolve "localhost" to ::1 first.
const v6 = net.createServer((client) => handleClient(client, `[::1]:${FROM_PORT}`));
v6.on("listening", () => {
  process.stdout.write(`[figma-relay] listening on [::1]:${FROM_PORT}\n`);
  noteReady();
});
v6.on("error", (err) => {
  process.stderr.write(`[figma-relay] IPv6 listener skipped: ${err.message}\n`);
  noteReady();
});
v6.listen({ host: "::1", port: FROM_PORT });

const shutdown = () => {
  process.stdout.write("\n[figma-relay] shutting down\n");
  v4.close();
  v6.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
