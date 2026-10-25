---
paused: true             # set your Slack user id below (profile → ⋯ → Copy member ID), then `autopilot signal slack --dry 120`, then remove this line
every: 15m
tools: [mcp__claude_ai_Slack__slack_search_public_and_private, mcp__claude_ai_Slack__slack_search_channels, mcp__claude_ai_Slack__slack_list_channel_members, mcp__claude_ai_Slack__slack_read_thread, mcp__claude_ai_Slack__slack_read_channel]
---
Only threads that ask me for an explicit action an AI session can help
with: a question to answer, a draft to write, something to research,
analyse, decide on with a recommendation, or fix. Drop chit-chat,
thanks, FYIs, status updates, scheduling and anything a teammate
already owns or has resolved in the thread. A teammate reporting a bug
or broken tool to me, or asking me for access, counts even without an
explicit question. So does a reply in a thread I started.

My Slack user id: <@YOUR_SLACK_USER_ID>. Run these searches with
slack_search_public_and_private, each with `after` and `before` set to
the window (Unix seconds), `sort: timestamp`, `include_bots: true`,
`response_format: "concise"`, `include_context: false` and `limit: 20`:
1. DMs and group DMs: `{"filters": "is:dm"}`.
2. Messages that mention me, in any channel:
   `{"query": "<@YOUR_SLACK_USER_ID>"}`. The query is the bare mention,
   with nothing around it (`from:<@…>` would find my own messages).
3. Replies in threads I started or replied to:
   `{"filters": "is:thread with:<@YOUR_SLACK_USER_ID>"}`.
Page until results are older than the window. Read a thread only when
the hit does not show who asks what of me, newest first and at most five
threads a run; the rest wait for the next run.

People in shared channels can show up as bots (user `U00`, or an app
posting for them): treat those as people. Skip real automation (alerts,
CI and status bots, channel joins) and threads where I already gave the
last answer.

One thread is one item, however many replies it gets. Source URL: the
permalink of the thread's root message, also when the hit is a reply.
Dedupe on the root's timestamp (the `p<digits>` part of the permalink):
a reply in a thread that already has a task becomes an update on it,
never a second task.
