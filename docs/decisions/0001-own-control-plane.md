# 1. Autopilot is its own control plane

**Decision.** Tasks, updates and sessions live in Autopilot's own server. Linear stays only as a
signal source (team tickets and their mirrors).

**Why.** Steering through Linear comments mixed the conversation with the work, needed a private
team per person, and could not rank tasks by whose turn it is. Owning the queue lets the Mac and
iPhone apps sit beside Claude Code and lets any agent use it through MCP.

**Consequences.** The Linear version (`autopilot-for-linear`) keeps running until phase 2. Nothing
is imported; signals move over one at a time.
