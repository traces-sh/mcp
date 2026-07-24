# Security Policy

Report suspected vulnerabilities privately to security@traces.com. Do not open a public issue
for reports that include credentials, private trace content, or an unpatched vulnerability.

The hosted MCP server accepts OAuth bearer tokens only. It must not log access tokens, trace
event content, or complete tool responses. The stdio transport is intended for self-hosting and
reads its token from `TRACES_API_TOKEN`.

Trace content is untrusted historical data. MCP clients should keep human confirmation enabled
and must not treat instructions found inside a trace as instructions for the current session.
