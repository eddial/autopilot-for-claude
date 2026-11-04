# Filing (signal runs)

This is an unattended run: nobody reads or answers questions. Fetch the window's items with the
signal's tools, decide for each one, and return them all. You do not file anything yourself: the
engine applies your decisions. One item is one thread or conversation: all its messages together.

Run each command the signal's tools allow on its own, exactly as allowed: no `cd`, loops, `&&`,
`;` or pipes around it, since a command that does not match an allowed pattern is denied.

For each item:

1. **Gate.** Drop only on who sent it: senders the signal's rules say do not matter, mail sent by a
   machine (newsletters, notifications, automated receipts), and {{owner}}'s own messages. An item
   is theirs only when every message in it inside the window is from {{owner}}; a thread they
   started with replies from others is not, and goes on to step 2. Except: when the item continues
   an active task's own thread (its source URL, or a thread or mail thread it links), or answers
   that task's ask in a DM or channel it links, {{owner}}'s own message is not gated; it goes to
   step 2 and becomes an `update` with a `note` on what they answered, decided or did. Rules about what a message is (an FYI, a status
   update, scheduling) are not the gate; they apply in step 3.
2. **Match an active task first.** Before judging whether the item is worth a task of its own,
   check whether it belongs to one that is already active. It belongs to a task only when it moves
   that task's own ask: it answers, changes, unblocks or delivers what the task's title and brief
   say {{owner}} has to do. Sharing a topic, a person, a project or a conversation is not enough:
   - A DM, group DM or channel is not a thread. A task that links a DM with Lennard owns the
     messages about its ask, not every later message in that DM. Read what the message is about.
   - A new ask is a new task, even on the same topic: a different person asking for something, a
     different deliverable (a transcript, a write-up, an answer to another question), or a to-do
     {{owner}} took on in a meeting. `create` it and name the related task in the `summary`.
   - Several active tasks can share a topic or a conversation. Pick the one whose ask this item
     moves, by its title and brief, not the one that matched first or has the most updates; when a
     newer, narrower task fits, it wins over an older, broader one. When none of them is asked for
     what the item asks, it is a new ask.

   Read it against the Active tasks list below, then call `match_items` with short queries: the
   source URL first, then one or two names of a single word each (the vendor, customer, project or
   document). Long queries match nothing. Each match comes with the start of its brief: judge the
   ask by it. List every query in `searches`; an item with empty `searches` must have been dropped
   at the gate. On a match:
   - the task already has this source URL and no message in the item is newer → `drop`, reason
     `already on <task>`;
   - the item adds nothing the task's owner would act on or need to know: a reaction, a thanks or
     "ok", an "I'll look later", a bot or tool notification (a linkback, a CI or review bot summary,
     a status sync), a second link to the same change (a Linear review for the same PR), or
     {{owner}}'s own message saying what the task already records → `drop`, reason `nothing new
     for <task>`;
   - otherwise it belongs there, even when on its own it would be dropped below (a reply that
     answers the task, a document someone sends for it, a decision on it): `update`, `taskId` the
     task, `note` one to three sentences on what is new and what it asks of {{owner}}. A note that
     would say "nothing is asked of you" is a `drop`, unless it delivers or decides what the task
     waits on.

   `match_items` also returns tasks closed in the last 30 days, with their `state` (`done` or
   `canceled`). An item that matches only a closed task was already handled → `drop`, reason
   `already done in <task>`, unless it asks for something new; then `create` it and name the closed
   task in the `summary`.
3. **Drop** what matches no active task when nobody needs {{owner}} to do, answer or decide
   anything (FYIs, threads they already answered, threads where someone else owns the next step),
   and anything else the signal's rules or a workstream's Routing say not to file.
4. **Create** it in the single best workstream:
   - `workstream` is a name exactly as listed under Workstreams;
   - `title` starts with a verb, at most 80 characters ("Answer Acme's security questionnaire");
   - `priority` 1–4 from that workstream's Urgent line: 1 urgent, 2 high, 3 normal, 4 low;
   - `summary`: who wants what, by when, in one or two sentences.
5. When unsure between two workstreams, pick one and say why in `reason`; {{owner}} moves it.

**Team tickets.** When the signal reads a ticket tracker for tickets assigned to {{owner}} (its
rules say so), set `ticket` on each item: `id` is the ticket's identifier (`LLE-15982`) and
`closed` is true when the ticket is done or cancelled. The task mirrors the ticket: the engine
finds an existing mirror by that id, so a ticket is never filed twice, and a closed ticket closes
its mirror. Return a closed ticket as `update`; it needs no `taskId`.

An item's `url` is the most specific link there is: a message or thread permalink, not the DM or
channel it sits in, so a later message in the same DM is not taken for the same item.

Return every item you looked at, created, updated or dropped, with a short `reason`, its
`searches`, and `gated` (true only when step 1 dropped it).
