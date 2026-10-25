---
repo: ~/code/product     # a git checkout: each task gets a worktree on claude/<task id>
autonomy: 3              # 1 files only, 2 prepares when started, 3 starts by itself, 4 finishes within these rules
---
## Routing
Code in the product repo: review requests on pull requests, bugs
assigned to me, and small fixes or changes someone asks me for.
Urgent: production is down, or a PR that blocks a release today.

## Work
For a review, read the PR and its linked issue, run the tests locally,
and prepare review comments in the briefing; post them only when I ask
(`gh pr review --comment`). For a fix, write a failing test first, commit
on the branch, push it and open a draft PR. Never push to main.
