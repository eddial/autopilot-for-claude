---
paused: true             # needs `gh auth login`; then `autopilot signal github --dry 120`, then remove this line
every: 10m
tools: [Bash(gh search prs:*), Bash(gh search issues:*), Bash(gh pr view:*), Bash(gh issue view:*)]
---
Pull requests where my review is requested, issues and PRs assigned to
me, and comments that mention me, updated in the window. Skip bot
comments (dependabot, renovate, CI) and PRs I authored unless someone
asks me something on them.

No connector needed: the GitHub CLI reads as me. Run, with the window
start as a date (YYYY-MM-DD) and `--json number,title,url,repository,updatedAt,author`:
- `gh search prs --review-requested=@me --state=open --updated=">=<date>"`
- `gh search issues --assignee=@me --state=open --updated=">=<date>"` and
  the same with `gh search prs`
- `gh search issues --mentions=@me --updated=">=<date>"` and the same
  with `gh search prs`
Read each hit with `gh pr view <url> --comments` or `gh issue view <url>
--comments` and keep it only when something in the window needs me.

Source URL: the PR or issue URL. One PR or issue is one item.
