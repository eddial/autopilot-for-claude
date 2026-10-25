# 6. Sessions write back through Autopilot's own MCP server

**Decision.** The launcher starts each session with `--mcp-config` pointing at `autopilot mcp` and
a token for that one task. Signal runs get a signal token. Answers go back into the session through
the terminal the server owns, only when the session is idle.

**Why.** Today sessions write back through the Linear connector; without Linear, Autopilot is the
connector. A local stdio server keeps working when the session is steered from the iPhone through
Remote Control, because the session still runs on the Mac.

**Consequences.** Tokens are a guardrail, not isolation: sessions run as your macOS user. Claude
chats on claude.ai would need a public HTTPS address with OAuth; that is out of scope.
