#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { apiUrl } from "./config.js";
import { buildServer } from "./server.js";

const accessToken = process.env.TRACES_API_TOKEN?.trim();
if (!accessToken) {
  console.error("TRACES_API_TOKEN is required for the stdio transport.");
  process.exit(1);
}

const server = buildServer({
  accessToken,
  apiUrl: apiUrl(),
  namespaceId: process.env.TRACES_NAMESPACE_ID?.trim() || undefined,
  transport: "stdio",
});

await server.connect(new StdioServerTransport());
