import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Task } from "@hakaitask/core";
import { whenLabel } from "@hakaitask/app/format";
import { fade, rise } from "../lib/motion.js";
import { useAutoFocus, useEscape, useScrollLock } from "../lib/hooks.js";
import { completeTask } from "@hakaitask/app/tasks";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Command palette (§5.1 #9) — web only.
 * Query yang gak ketemu task apa pun otomatis jadi tawaran "tambah task".
 */
export function CommandPalette({
  open,
  tasks,
  now,
  commands,
  onClose,
  onOpenTask,
  onQuickAdd,
}: {
  open: boolean;
  tasks: Task[];
  now: Date;
  commands: Command[];
  onClose: () => void;
  onOpenTask: (task: Task) => void;
  onQuickAdd: (initial: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useAutoFocus<HTMLInputElement>(open);

  useScrollLock(open);
  useEscape(open, onClose);

  const items = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();

    const taskItems = tasks
      .filter((t) => !q || t.title.toLowerCase().includes(q))
      .slice(0, 6)
      .flatMap<Command>((task) => [
        {
          id: `open-${task.id}`,
          label: task.title,
          hint: whenLabel(task.dueAt ?? task.startAt, now, task.allDay) || "buka",
          run: () => {
            onOpenTask(task);
            onClose();
          },
        },
      ]);

    const commandItems = commands.filter(
      (c) => !q || c.label.toLowerCase().includes(q),
    );

    const addItem: Command[] = q
      ? [
          {
            id: "quick-add",
            label: `Tambah “${query.trim()}”`,
            hint: "quick add",
            run: () => {
              onQuickAdd(query.trim());
              onClose();
            },
          },
        ]
      : [];

    const doneItem: Command[] =
      q && taskItems.length > 0
        ? [
            {
              id: "done-first",
              label: `Selesaikan “${tasks.find((t) => t.title.toLowerCase().includes(q))!.title}”`,
              hint: "selesai",
              run: () => {
                const t = tasks.find((x) => x.title.toLowerCase().includes(q));
                if (t) completeTask(t);
                onClose();
              },
            },
          ]
        : [];

    return [...taskItems, ...doneItem, ...commandItems, ...addItem];
  }, [query, tasks, now, commands, onClose, onOpenTask, onQuickAdd]);

  const clamped = Math.min(active, Math.max(items.length - 1, 0));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          variants={fade}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed inset-0 z-50 flex items-start justify-center bg-paper/80 px-4 pt-[12vh] backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            variants={rise}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="card w-full max-w-[var(--max-content)] overflow-hidden"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, items.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  items[clamped]?.run();
                }
              }}
              placeholder="Cari task atau perintah…"
              aria-label="Cari task atau perintah"
              className="w-full bg-transparent px-5 py-4 text-[18px] text-ink outline-none placeholder:text-ink40"
              autoComplete="off"
              spellCheck={false}
            />

            <ul className="max-h-[45vh] overflow-y-auto border-t border-line">
              {items.length === 0 && (
                <li className="px-5 py-4 text-[15px] text-ink40">Gak ada yang cocok.</li>
              )}
              {items.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={item.run}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-3 text-left text-[15px] transition-colors duration-[var(--dur-fast)] ${
                      i === clamped ? "bg-subtle text-ink" : "text-ink70"
                    }`}
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.hint && <span className="t-num shrink-0 text-ink40">{item.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
