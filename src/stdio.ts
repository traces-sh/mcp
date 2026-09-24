#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { apiUrl, authorizationServer, surfaceApiUrl } from "./config.js";
import { buildServer } from "./server.js";
import { lookupSession } from "./session.js";

const accessToken = process.env.TRACES_API_TOKEN?.trim();
if (!accessToken) {
  console.error("TRACES_API_TOKEN is required for the stdio transport.");
  process.exit(1);
}

const session = await lookupSession(accessToken, authorizationServer(), fetch);
if (session.status !== "valid") {
  console.error(
    session.status === "invalid"
      ? "TRACES_API_TOKEN was rejected by Traces or is not bound to a namespace."
      : "Traces authentication is temporarily unavailable; could not resolve the token's namespace.",
  );
  process.exit(1);
}

const server = buildServer({
  accessToken,
  apiUrl: apiUrl(),
  surfaceApiUrl: surfaceApiUrl(),
  namespace: session.namespace,
  transport: "stdio",
});

await server.connect(new StdioServerTransport());
