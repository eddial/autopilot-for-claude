---
paused: true             # a digest: cron instead of a rolling window. Set the channel and repo below, then `autopilot signal weekly-digest --dry 1440`
cron: 0 8 * * 1          # Mondays 08:00: one item covering the previous week
every: 30m               # retry interval when the Monday run fails
window_cap: 8d           # the first run covers this much, later runs everything since the previous run
tools: [mcp__claude_ai_Slack__slack_read_channel, mcp__claude_ai_Slack__slack_read_thread, Bash(gh pr list:*), Bash(gh pr view:*)]
---
A weekly digest, not one task per message: the whole window is a single
item, filed in product-marketing at priority 3.

Collect what shipped in the window from two sources:
- Slack #changelog (channel id C0000000000): read it with `oldest` set
  to the window start (Unix seconds) and page until done. Keep product
  announcements; skip joins, bare links and chit-chat replies. Note each
  post's author, date and permalink.
- GitHub acme/product: `gh pr list -R acme/product --state merged
  --search "merged:<window start date>..<window end date>" --limit 200
  --json number,title,url,mergedAt,author,labels`. Skip dependency
  bumps, bots, CI, refactors and internal tooling; keep changes a
  customer could notice.

Merge the two: one entry per change, with the Slack permalink and the
PR(s) behind it. Drop the item only when nothing customer-visible
shipped.

Title: "Shortlist what to announce from week <ISO week>". Summary:
the entries, newest first, one line each, then the usual From/Source
lines. Source URL, which is also the dedupe key:
`https://github.com/acme/product/pulls?q=is%3Apr+is%3Amerged+merged%3A<start>..<end>`
with dates as YYYY-MM-DD.
