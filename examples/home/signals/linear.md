---
paused: true             # remove once `autopilot signal linear --dry 120` looks right
every: 10m
tools: [mcp__claude_ai_Linear__get_notifications, mcp__claude_ai_Linear__list_issues, mcp__claude_ai_Linear__get_issue, mcp__claude_ai_Linear__list_comments]
---
Team tickets in Linear that were assigned to me, mention me, or got a
comment addressed to me in the window. Skip status-only changes and my
own comments, except a ticket of mine that was completed or cancelled:
return that one too, so its mirror closes.

Start from my notifications in the window (assignments, mentions,
comments), then list_issues with `assignee: me` and `updatedAt` = window
start. Source URL: the ticket's URL. One ticket is one item. Set
`ticket` on every item assigned to me: its identifier, and `closed` when
its status type is completed or canceled. A mention on a ticket assigned
to someone else gets no `ticket`: it is a request like any other.
