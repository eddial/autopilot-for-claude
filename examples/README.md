# Examples

A starting `home/` for Autopilot: workstreams and signals in the format the server reads. Copy the
ones you want into `~/Library/Application Support/Autopilot/home/` and edit them; nothing here is
read in place.

- `workstreams/`: what lands where (`## Routing`, with an `Urgent:` line) and how the work is done
  (`## Work`). Frontmatter: `repo` (a git checkout; each task gets a worktree), `folder`, and
  `autonomy` (1 files only, 2 prepares when started, 3 starts by itself, 4 finishes within the
  workstream's rules). Keep `autopilot.md`: health problems and routing proposals land there.
- `signals/`: one source each. Frontmatter: `every` (a rolling window) or `cron` (a digest, local
  time, with `every` as the retry interval and `window_cap` for how far back the first run reaches),
  `tools` (the read-only tools the run may use) and `model`. Every example starts `paused: true`:
  preview it with `autopilot signal <name> --dry 120`, then remove the line.
