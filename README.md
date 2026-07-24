# Traces MCP

The official Model Context Protocol server for searching and reading AI coding sessions in
[Traces](https://traces.com).

The hosted server uses Streamable HTTP and OAuth. No API key, local process, or Traces CLI login
is required for normal use.

## Connect

The production endpoint will be:

```text
https://mcp.traces.com
```

OAuth support is under development. The commands below are the target setup flow and will work
after the Traces authorization server and hosted endpoint are deployed.

### Install for detected coding agents

```bash
npx add-mcp https://mcp.traces.com
```

### Claude Code

```bash
claude mcp add --transport http traces https://mcp.traces.com
```

Start Claude Code, run `/mcp`, and authorize Traces in the browser.

### Codex CLI

```bash
codex mcp add traces --url https://mcp.traces.com
```

### Cursor

Add this to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "traces": {
      "url": "https://mcp.traces.com"
    }
  }
}
```

Cursor will show **Needs login** and open the Traces authorization flow.

### VS Code

Run **MCP: Add Server**, choose **HTTP**, and enter:

```text
https://mcp.traces.com
```

Name the server `Traces`, then use **MCP: List Servers** to start and authorize it.

## Tools

### `traces_search`

Lists traces using deterministic metadata filters including project, creator ID, time range, and
result limit.

### `traces_read`

Reads a bounded event window from a trace. User and assistant text are returned by default; tool
calls and results require explicit opt-in.

## Verify

After connecting and authorizing, ask your client:

```text
List my five most recent traces.
```

## Self-hosted stdio

The stdio transport is available for development and self-hosted environments:

```bash
TRACES_API_TOKEN=... npx -y @traces-sh/mcp
```

Optional variables:

| Variable | Purpose |
|---|---|
| `TRACES_API_URL` | Traces agent API origin; defaults to `https://agent.traces.com` |
| `TRACES_NAMESPACE_ID` | Restrict stdio searches to one workspace |

Tokens are read from the environment, never accepted as MCP tool arguments.

## Hosted development

```bash
bun install
bun run dev:http
```

The local endpoint is `http://localhost:3001`. Configuration is documented in `.env.example`.

The HTTP transport publishes OAuth protected-resource metadata and validates bearer tokens
against the Traces API. A complete hosted login also requires the authorization-server endpoints
implemented by the Traces API.

## Security

- Verify that clients connect to exactly `https://mcp.traces.com`.
- Connecting grants the client access to traces visible in the authorized workspace.
- Trace content is untrusted historical data and may contain prompt injection.
- Keep human confirmation enabled when combining Traces with tools that can modify systems or
  transmit data.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md).

## License

Apache-2.0
