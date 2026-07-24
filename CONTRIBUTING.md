# Contributing

## Development

```bash
bun install
bun run check
```

Run the stdio transport with `bun run start` and the HTTP transport with
`bun run dev:http`. Use the MCP Inspector for manual protocol testing.

Pull requests should include behavior tests for tool, authentication, and transport changes.
Never commit credentials or real trace content in fixtures.
