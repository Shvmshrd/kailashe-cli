/**
 * Task schema — SPEC §6.8 (ops-loop.md §2)
 *
 * id (T-NNN), title, goal, channel, route, approval (A|B|C), inputs[], steps[],
 * success_check, kpi, impact 1-5, confidence 1-5, effort 1-5, depends_on[],
 * status (todo|doing|waiting-approval|blocked|done), evidence[], notes.
 * Priority (ops-loop §3): (impact x confidence) / effort, +2/-2 modifiers.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const ApprovalClassSchema = z.enum(["A", "B", "C"]).describe("Pack approval class: A auto, B batch, C ask each time.");
export type ApprovalClass = z.infer<typeof ApprovalClassSchema>;
export const TaskApprovalSchema = ApprovalClassSchema;
export type TaskApproval = ApprovalClass;

export const TaskStatusSchema = z.enum(["todo", "doing", "waiting-approval", "blocked", "done"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskIdSchema = z.string().regex(/^T-\d{3,}$/, "Task id must be T-NNN (e.g. T-014)");

const score = z.number().int().min(1).max(5);

export const TaskSchema = z
  .object({
    id: TaskIdSchema,
    title: z.string().min(1),
    goal: z.string().min(1),
    channel: z.string().min(1).describe("Channel id (label; validated via ChannelMap, SPEC §6.13)."),
    route: z.string().min(1).describe("Route/tool that executes the task, e.g. 'muse:github'."),
    approval: TaskApprovalSchema,
    inputs: z.array(z.string().min(1)).default([]),
    steps: z.array(z.string().min(1)).default([]),
    success_check: z.string().min(1),
    kpi: z.string().min(1),
    impact: score,
    confidence: score,
    effort: score.describe("1-5, lower is easier."),
    depends_on: z.array(TaskIdSchema).default([]),
    status: TaskStatusSchema.default("todo"),
    evidence: z.array(z.string()).default([]),
    notes: z.string().default(""),
  })
  .strict();
export type Task = z.infer<typeof TaskSchema>;

/** Priority per ops-loop §3: (impact x confidence)/effort, +2 unlocks >=3 others, -2 approval unanswered 3 days. */
export function taskPriorityScore(
  task: Pick<Task, "impact" | "confidence" | "effort">,
  opts: { unlocksCount?: number; approvalOverdue?: boolean } = {},
): number {
  let s = (task.impact * task.confidence) / task.effort;
  if ((opts.unlocksCount ?? 0) >= 3) s += 2;
  if (opts.approvalOverdue) s -= 2;
  return s;
}
export const taskPriority = taskPriorityScore;

export const TaskJsonSchema = zodToJsonSchema(TaskSchema, { name: "Task", $refStrategy: "none", target: "jsonSchema7" });
