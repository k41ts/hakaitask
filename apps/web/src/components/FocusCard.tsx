import { motion } from "framer-motion";
import type { Task } from "@hakaitask/core";
import { durationLabel, isOverdue, whenLabel } from "@hakaitask/app/format";
import { rise } from "../lib/motion.js";
import { completeTask, subtaskProgress } from "@hakaitask/app/tasks";
import { Checkbox, StrikeText } from "./Checkbox.js";

export function FocusCard({
  task,
  now,
  onOpen,
}: {
  task: Task;
  now: Date;
  onOpen: () => void;
}) {
  const overdue = isOverdue(task, now);
  const { done, total } = subtaskProgress(task);
  const done_ = task.status === "done";

  const when = whenLabel(task.dueAt, now, task.allDay);
  const duration = durationLabel(task.estimateMin);

  return (
    <motion.div
      variants={rise}
      initial="hidden"
      animate="show"
      whileHover={{ y: -2 }}
      transition={{ duration: 0.16 }}
      className={`card p-6 ${overdue ? "border-2 border-accent" : ""}`}
    >
      <div className="flex items-start gap-4">
        <div className="pt-1">
          <Checkbox
            checked={done_}
            onChange={() => completeTask(task)}
            label={`Selesaikan ${task.title}`}
          />
        </div>

        {/*
          Panahnya masuk KE DALAM tombol yang sama, bukan jadi span sebelah.
          Sebelumnya dia dibulatkan + dikasih isian (persis tombol) tapi gak
          bisa diklik — afordansi bohong.
        */}
        <button
          type="button"
          onClick={onOpen}
          className="group flex min-w-0 flex-1 items-start gap-4 text-left"
          aria-label={`Buka detail ${task.title}`}
        >
          <span className="min-w-0 flex-1">
            <motion.span
              layoutId={`task-title-${task.id}`}
              className="block text-[26px] font-extrabold leading-8 text-ink"
            >
              <StrikeText done={done_}>{task.title}</StrikeText>
            </motion.span>

            {(task.priority <= 2 || when || duration) && (
              <span className="mt-3 flex flex-wrap items-center gap-2">
                {overdue && <span className="chip-active !bg-accent">Lewat</span>}
                {task.priority <= 2 && (
                  <span className={overdue ? "chip" : "chip-active"}>
                    P{task.priority}
                  </span>
                )}
                {when && <span className="t-num text-ink40">{when}</span>}
                {duration && <span className="t-num text-ink40">{duration}</span>}
              </span>
            )}

            {total > 0 && <SubtaskProgress done={done} total={total} />}
          </span>

          <span
            aria-hidden
            className="icon-btn h-9 w-9 shrink-0 text-[15px] transition-colors duration-[var(--dur-fast)] group-hover:bg-ink group-hover:text-surface"
          >
            →
          </span>
        </button>
      </div>
    </motion.div>
  );
}

function SubtaskProgress({ done, total }: { done: number; total: number }) {
  return (
    <span className="mt-4 flex items-center gap-3">
      <span
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${done} dari ${total} subtask selesai`}
        className="h-1 flex-1 overflow-hidden rounded-full bg-line"
      >
        <motion.span
          className="block h-full bg-ink"
          initial={{ width: 0 }}
          animate={{ width: `${(done / total) * 100}%` }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        />
      </span>
      <span className="t-num text-ink40">
        {done}/{total}
      </span>
    </span>
  );
}
