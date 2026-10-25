---
paused: true             # replace mcp__fathom__ with the prefix /mcp shows for your Fathom connector, then `autopilot signal fathom --dry 120`, then remove this line
every: 1h
tools: [mcp__fathom__list_meetings, mcp__fathom__get_meeting, mcp__fathom__get_transcript]
---
Meetings I attended that ended in the window, read for what I committed
to or was asked to do. One meeting is one item; list its action items for
me in the summary, each with who asked and by when if it was said.

File a meeting only when it left me something an AI session can help
with: a follow-up email to draft, a document or proposal to write,
something to research, or a decision someone is waiting on. Drop
meetings with no action for me, internal stand-ups, and actions that
belong to someone else.

List meetings with the window start, read each one's summary with
get_meeting, and open the transcript only when the summary does not say
who owns an action. Source URL: the meeting's Fathom link.
