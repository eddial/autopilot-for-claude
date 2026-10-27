import type { AnyContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import {
  AddWatcher,
  AnswerUpdateFields,
  AttachLink,
  CloseTask,
  CreateTask,
  FileItem,
  MatchItems,
  PostUpdateFields,
  SnoozeTask,
  TaskRef,
  WaitOn,
  decisionHasOptions,
  hasAnswer,
} from './commands.ts'
import { contract, type Meta } from './contract.ts'
import type { Scope } from './enums.ts'
import { TaskId } from './primitives.ts'

/**
 * The tools Autopilot's MCP server offers. Each maps onto one procedure of the
 * contract and takes the same input, minus the idempotency key, which the MCP
 * bridge fills in. Scopes are read from the contract, so they cannot drift.
 */
export type McpTool = {
  name: string
  description: string
  procedure: readonly [string, string]
  input: z.ZodType
}

const noKey = <T extends z.ZodObject<{ idempotencyKey: z.ZodType }>>(schema: T) => schema.omit({ idempotencyKey: true })

export const mcpTools: readonly McpTool[] = [
  {
    name: 'list_tasks',
    description: 'List tasks in the queue, ordered by whose turn it is. Filter by band or workstream.',
    procedure: ['queue', 'list'],
    input: contract.queue.list['~orpc'].inputSchema as z.ZodType,
  },
  {
    name: 'get_task',
    description: 'Get a task with its updates, its session and what it waits on.',
    procedure: ['tasks', 'get'],
    input: z.object({ id: TaskId }),
  },
  {
    name: 'list_workstreams',
    description: 'List workstreams: what lands in each, when it is urgent and how the work is done.',
    procedure: ['workstreams', 'list'],
    input: z.object({}),
  },
  {
    name: 'create_task',
    description:
      'Create a task. With start true (the default) a Claude Code session starts on it with the brief as its first prompt. Pass sourceUrl and ticket when it has them: an open task with the same one gets the brief as an update instead, and comes back with matched true.',
    procedure: ['tasks', 'create'],
    input: noKey(CreateTask),
  },
  {
    name: 'post_update',
    description:
      'Post an update on your task: decision (with options), question, review, blocked, waiting, done or info. Asks put the task on the owner’s turn.',
    procedure: ['updates', 'post'],
    input: decisionHasOptions(z.object(PostUpdateFields)),
  },
  {
    name: 'attach_link',
    description: 'Attach a link to your task: a branch, pull request, draft or file you created.',
    procedure: ['links', 'attach'],
    input: noKey(AttachLink),
  },
  {
    name: 'add_watcher',
    description: 'Watch what your task waits on (a reply, a review); news brings the task back.',
    procedure: ['watchers', 'add'],
    input: noKey(AddWatcher),
  },
  {
    name: 'wait_on',
    description: 'Hand your task over to someone else, optionally with a watcher.',
    procedure: ['tasks', 'wait'],
    input: noKey(WaitOn),
  },
  {
    name: 'answer_update',
    description: 'Answer an open decision or question on a task, as the owner.',
    procedure: ['updates', 'answer'],
    input: hasAnswer(z.object(AnswerUpdateFields)),
  },
  {
    name: 'start_task',
    description: 'Start a session on a new task.',
    procedure: ['tasks', 'start'],
    input: noKey(TaskRef),
  },
  {
    name: 'snooze_task',
    description: 'Snooze a task until a time; it comes back on the owner’s turn.',
    procedure: ['tasks', 'snooze'],
    input: noKey(SnoozeTask),
  },
  {
    name: 'close_task',
    description: 'Close a task as done or canceled; its session ends.',
    procedure: ['tasks', 'close'],
    input: noKey(CloseTask),
  },
  {
    name: 'match_items',
    description:
      'Search tasks before filing or creating one, by source URL, ticket id or a short name: active tasks, and those closed in the last 30 days with their state.',
    procedure: ['items', 'match'],
    input: MatchItems,
  },
  {
    name: 'file_item',
    description: 'File what a signal found: create a task, add it to an existing one, or drop it with a reason.',
    procedure: ['items', 'file'],
    input: noKey(FileItem),
  },
]

export const procedureAt = ([group, name]: readonly [string, string]): AnyContractProcedure => {
  const procedure = (contract as Record<string, Record<string, AnyContractProcedure>>)[group]?.[name]
  if (!procedure) throw new Error(`No procedure ${group}.${name}`)
  return procedure
}

export const metaOf = (tool: McpTool): Meta => procedureAt(tool.procedure)['~orpc'].meta as Meta

/** The tools a caller with this scope can see. */
export const toolsFor = (scope: Scope): McpTool[] => mcpTools.filter((tool) => metaOf(tool).scopes.includes(scope))
