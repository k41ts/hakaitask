/**
 * Terjemahan Task (camelCase, core) ↔ baris Postgres (snake_case, §3.2).
 * Satu-satunya tempat nama kolom ditulis — kalau skema berubah, cuma file ini.
 */
import type { BusyBlock, Task, UserLexiconEntry } from "@hakaitask/core";

const TO_COLUMN: Record<string, string> = {
  id: "id",
  userId: "user_id",
  title: "title",
  notes: "notes",
  status: "status",
  priority: "priority",
  dueAt: "due_at",
  startAt: "start_at",
  allDay: "all_day",
  estimateMin: "estimate_min",
  actualMin: "actual_min",
  energy: "energy",
  projectId: "project_id",
  tags: "tags",
  subtasks: "subtasks",
  blockedBy: "blocked_by",
  recurrence: "recurrence",
  recurrenceParentId: "recurrence_parent_id",
  reminderMin: "reminder_min",
  rescheduleCount: "reschedule_count",
  createdAt: "created_at",
  updatedAt: "updated_at",
  completedAt: "completed_at",
  snoozedUntil: "snoozed_until",
  deletedAt: "deleted_at",
};

const TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(TO_COLUMN).map(([field, column]) => [column, field]),
);

/** Field yang cuma hidup di klien — jangan pernah dikirim ke server. */
const CLIENT_ONLY = new Set(["syncState"]);

export type TaskRow = Record<string, unknown>;

export function toRow(patch: Partial<Task>): TaskRow {
  const row: TaskRow = {};
  for (const [field, value] of Object.entries(patch)) {
    if (CLIENT_ONLY.has(field)) continue;
    const column = TO_COLUMN[field];
    if (!column) continue;
    row[column] = value === undefined ? null : value;
  }
  return row;
}

export function fromRow(row: TaskRow): Task {
  const task: Record<string, unknown> = { syncState: "synced" };
  for (const [column, value] of Object.entries(row)) {
    const field = TO_FIELD[column];
    if (!field) continue;
    if (value !== null) task[field] = value;
  }
  // Kolom yang non-null di DB tapi bisa hilang kalau baris dikirim parsial.
  task.tags ??= [];
  task.subtasks ??= [];
  task.rescheduleCount ??= 0;
  task.allDay ??= false;
  return task as unknown as Task;
}

// ── busy_blocks ──────────────────────────────────────────────────────────────

export function blockToRow(b: BusyBlock): TaskRow {
  return {
    id: b.id,
    user_id: b.userId,
    title: b.title,
    start_at: b.startAt,
    end_at: b.endAt,
    recurrence: b.recurrence ?? null,
    deleted_at: b.deletedAt ?? null,
  };
}

export function blockFromRow(row: TaskRow): BusyBlock {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title ?? ""),
    startAt: String(row.start_at),
    endAt: String(row.end_at),
    ...(row.recurrence ? { recurrence: String(row.recurrence) } : {}),
    ...(row.updated_at ? { updatedAt: String(row.updated_at) } : {}),
    ...(row.deleted_at ? { deletedAt: String(row.deleted_at) } : {}),
  };
}

// ── user_lexicon ─────────────────────────────────────────────────────────────

export function lexiconToRow(e: UserLexiconEntry): TaskRow {
  return {
    id: e.id,
    user_id: e.userId,
    dari: e.dari,
    ke: e.ke,
    tipe: e.tipe,
    deleted_at: e.deletedAt ?? null,
  };
}

export function lexiconFromRow(row: TaskRow): UserLexiconEntry {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    dari: String(row.dari ?? ""),
    ke: String(row.ke ?? ""),
    tipe: (row.tipe as UserLexiconEntry["tipe"]) ?? "alias",
    createdAt: String(row.created_at ?? new Date().toISOString()),
    ...(row.updated_at ? { updatedAt: String(row.updated_at) } : {}),
    ...(row.deleted_at ? { deletedAt: String(row.deleted_at) } : {}),
  };
}
