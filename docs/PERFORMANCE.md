# Performance

**The bar:** Autopilot should feel as if the text were hardcoded into the screen. Anything a
person does shows on the next frame, and nothing they do waits on the network or the server.

## How the apps get there

- **Local first.** Each app draws from data it already holds: the queue kept current by the live
  feed (`applyEvent`), task conversations kept current by the same feed (`applyToDetail`), and the
  last queue saved, so a window or the phone draws at once on the next start.
- **Commands are applied, then sent.** Answer, reply, start, snooze and close go through
  `send(command)` (the Mac window's `src/store.ts`, the phone's `Sync`), which puts them on screen
  in the same frame through the shared `overlay` and sends them after. Never `await` the server in
  an event handler.
- **Prefetch what is likely next.** Hovering or selecting a row fetches its conversation; once
  fetched, the feed keeps it current, so a task opens without a request.
- **Render only what is on screen.** Lists are virtualised and rows are memoised on the objects the
  store keeps stable, so a change to one task renders one row.
- **Nothing on the way to the first frame touches the network.** Fonts and assets are bundled. The
  phone reads its pairing and cached queue synchronously at launch, so it opens on the queue.
- **Taps never write the whole cache.** The outbox (small) is saved at once; the queue at most once
  a second, after catching up. A command is sent straight away, beside any long poll.
- **The server answers in bulk.** The queue snapshot is three queries, not two per task, and every
  statement is prepared once.

## Budgets

`pnpm perf` seeds a heavy queue (1,000 open tasks, five updates each), times the server's hot paths
and the window's interactions in Chromium against the production build, and fails when a budget in
`apps/desktop/perf/budgets.json` is exceeded. CI runs it on every push and shows the table in the
run's summary.

| Measure | Budget | What it is |
| --- | --- | --- |
| `window.openTask`, `window.answer`, `window.switchView` | 20 ms | From input to the frame that paints the result. One frame is 16.7 ms at 60 Hz; nothing can be faster |
| `window.longTasks.count` | 0 | Main-thread tasks over 50 ms during those interactions |
| `window.firstRows.cached` | 150 ms | Opening the window again: page start to the first row, from the saved queue |
| `window.firstRows` | 400 ms | The very first start, with nothing saved yet |
| `window.js.gzipKB` | 200 KB | The window's JavaScript, gzipped |
| `client.queueItems.1000` | 4 ms | What the window and the phone compute on every change, in V8; Hermes is a few times slower and stays under a frame |
| `phone.bundle.MB` | 8 MB | The phone's compiled Hermes bundle (CI measures it); most of the phone's launch time |
| `server.snapshot.1000` | 25 ms | The whole queue of 1,000 tasks |
| `server.taskDetail`, `server.write`, `server.changesSince` | 2 ms | One task; one write; catching up on the feed |

Budgets only go down. When something gets faster, lower its budget in the same change. A change
that needs a higher budget needs a different design.

`PERF_DEBUG=1 pnpm perf` also prints where the first load spends its time (page loaded, feed
subscribed, snapshot in).
