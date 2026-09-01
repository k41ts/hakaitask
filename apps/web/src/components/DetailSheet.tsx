import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Priority, Task } from "@hakaitask/core";
import { durationLabel, isOverdue, metaLine, snoozeTargets, whenLabel } from "@hakaitask/app/format";
import { fade, listContainer, listItem, press, sheet } from "../lib/motion.js";
import { useEscape, useScrollLock } from "../lib/hooks.js";
import {
  addSubtask,
  archiveTask,
  completeTask,
  deleteTask,
  patchTask,
  snoozeTask,
  startTask,
  toggleSubtask,
  uncompleteTask,
} from "@hakaitask/app/tasks";
import { Checkbox, StrikeText } from "./Checkbox.js";

const PRIORITIES: Priority[] = [1, 2, 3, 4];

export function DetailSheet({
  task,
  now,
  onClose,
}: {
  task: Task | null;
  now: Date;
  onClose: () => void;
}) {
  const open = task !== null;
  useScrollLock(open);
  useEscape(open, onClose);

  return (
    <AnimatePresence>
      {task && (
        // Satu akar buat AnimatePresence — overlay dan sheet di dalamnya
        // mewarisi label variant, jadi keluarnya barengan dan gak nyangkut.
        <motion.div
          key="detail-sheet"
          variants={fade}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed inset-0 z-40"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-paper/70 backdrop-blur-sm"
          />
          <motion.div
            variants={sheet}
            role="dialog"
            aria-modal="true"
            aria-label={`Detail ${task.title}`}
            className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[var(--radius-lg)] bg-surface"
          >
            <div className="mx-auto w-full max-w-[var(--max-content)] px-6 pb-10 pt-4">
              <div
                aria-hidden
                className="mx-auto mb-6 h-1 w-10 rounded-full bg-line"
              />
              <Body key={task.id} task={task} now={now} onClose={onClose} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Body({ task, now, onClose }: { task: Task; now: Date; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [newSubtask, setNewSubtask] = useState("");
  const done = task.status === "done";
  const overdue = isOverdue(task, now);

  // Perubahan dari device lain (realtime) harus kelihatan walau sheet kebuka.
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setNotes(task.notes ?? ""), [task.notes]);

  const meta = metaLine([
    whenLabel(task.dueAt ?? task.startAt, now, task.allDay),
    durationLabel(task.estimateMin),
    task.tags.map((t) => `#${t}`).join(" ") || undefined,
  ]);

  return (
    <div>
      <div className="flex items-start gap-4">
        <div className="pt-1.5">
          <Checkbox
            checked={done}
            onChange={() => (done ? uncompleteTask(task) : completeTask(task))}
            label={done ? `Batalkan ${task.title}` : `Selesaikan ${task.title}`}
          />
        </div>

        <motion.h2 layoutId={`task-title-${task.id}`} className="min-w-0 flex-1">
          <StrikeText done={done} className="w-full">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                const next = title.trim();
                if (next && next !== task.title) patchTask(task.id, { title: next });
                else setTitle(task.title);
              }}
              className="w-full bg-transparent text-[24px] font-semibold leading-8 text-ink outline-none"
              aria-label="Judul task"
            />
          </StrikeText>
        </motion.h2>
      </div>

      {meta && (
        <p className={`t-num mt-2 pl-[38px] ${overdue ? "text-accent" : "text-ink40"}`}>
          {overdue ? `Lewat · ${meta}` : meta}
        </p>
      )}

      <Section label="Prioritas">
        <div className="flex gap-2">
          {PRIORITIES.map((p) => (
            <motion.button
              key={p}
              type="button"
              whileTap={press}
              onClick={() => patchTask(task.id, { priority: p })}
              aria-pressed={task.priority === p}
              className={
                task.priority === p
                  ? p === 1
                    ? "chip-active !bg-accent"
                    : "chip-active"
                  : "chip text-ink40 hover:text-ink"
              }
            >
              P{p}
            </motion.button>
          ))}
        </div>
      </Section>

      <Section label="Tunda">
        <div className="flex flex-wrap gap-2">
          {snoozeTargets(now).map(({ label, at }) => (
            <motion.button
              key={label}
              type="button"
              whileTap={press}
              onClick={() => {
                snoozeTask(task, at);
                onClose();
              }}
              className="chip text-ink70 hover:text-ink"
            >
              {label}
            </motion.button>
          ))}
          {task.rescheduleCount > 0 && (
            <span className="t-num self-center text-ink40">
              udah digeser {task.rescheduleCount}×
            </span>
          )}
        </div>
      </Section>

      <Section label="Subtask">
        <motion.ul variants={listContainer} initial="hidden" animate="show" className="space-y-2">
          <AnimatePresence initial={false}>
            {task.subtasks.map((s) => (
              <motion.li
                key={s.id}
                variants={listItem}
                exit="exit"
                layout
                className="flex items-center gap-3"
              >
                <Checkbox
                  checked={s.done}
                  onChange={() => toggleSubtask(task, s.id)}
                  label={s.title}
                  size={18}
                />
                <span className="text-[15px] text-ink70">
                  <StrikeText done={s.done}>{s.title}</StrikeText>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>

        <input
          value={newSubtask}
          onChange={(e) => setNewSubtask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const v = newSubtask.trim();
            if (!v) return;
            addSubtask(task, v);
            setNewSubtask("");
          }}
          placeholder="Tambah subtask…"
              aria-label="Tambah subtask"
          className="mt-3 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink40"
        />
      </Section>

      <Section label="Catatan">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (task.notes ?? "")) {
              patchTask(task.id, { notes: notes.trim() || undefined });
            }
          }}
          rows={3}
          placeholder="Tulis catatan…"
          aria-label="Catatan"
          className="w-full resize-none bg-transparent text-[15px] leading-6 text-ink outline-none placeholder:text-ink40"
        />
      </Section>

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-line pt-4">
        {task.status !== "doing" && !done && (
          <Action onClick={() => startTask(task)}>Mulai kerjain</Action>
        )}
        <Action
          onClick={() => {
            archiveTask(task);
            onClose();
          }}
        >
          Arsipkan
        </Action>
        <Action
          accent
          onClick={() => {
            deleteTask(task);
            onClose();
          }}
        >
          Hapus
        </Action>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="mb-3 text-[15px] font-bold text-ink">{label}</h3>
      {children}
    </section>
  );
}

function Action({
  children,
  onClick,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <motion.button
      type="button"
      whileTap={press}
      onClick={onClick}
      className={`t-num transition-colors duration-[var(--dur-fast)] ${
        accent ? "text-ink40 hover:text-accent" : "text-ink40 hover:text-ink"
      }`}
    >
      {children}
    </motion.button>
  );
}
