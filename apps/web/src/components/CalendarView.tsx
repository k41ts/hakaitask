import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BusyBlock, Task } from "@hakaitask/core";
import {
  addMonths,
  blocksOnDate,
  monthLabel,
  monthMatrix,
  sameDay,
  tasksOnDate,
} from "@hakaitask/app/calendar";
import { clock, headerDate, isOverdue } from "@hakaitask/app/format";
import { listContainer, listItem, press, rise } from "../lib/motion.js";
import { completeTask } from "@hakaitask/app/tasks";
import { Checkbox, StrikeText } from "./Checkbox.js";

const HARI_PENDEK = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** "12 agustus" — bentuk yang langsung dimengerti parser tanggal. */
const BULAN_PARSER = [
  "januari", "februari", "maret", "april", "mei", "juni",
  "juli", "agustus", "september", "oktober", "november", "desember",
];

function tanggalUntukChat(d: Date): string {
  return `${d.getDate()} ${BULAN_PARSER[d.getMonth()]}`;
}

export function CalendarView({
  now,
  tasks,
  blocks,
  onAdd,
  onOpenTask,
}: {
  now: Date;
  tasks: Task[];
  blocks: BusyBlock[];
  /** Buka chat dengan teks awal. Kalender gak punya kolom ketik sendiri lagi. */
  onAdd: (draft: string) => void;
  onOpenTask: (task: Task) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState<Date>(() => new Date(now));

  const days = useMemo(() => monthMatrix(viewMonth.getFullYear(), viewMonth.getMonth()), [viewMonth]);
  const selectedTasks = useMemo(() => tasksOnDate(tasks, selected), [tasks, selected]);
  const selectedBlocks = useMemo(() => blocksOnDate(blocks, selected), [blocks, selected]);

  return (
    <motion.div variants={rise} initial="hidden" animate="show" className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="t-display min-w-0 text-[32px] leading-9 text-ink">{monthLabel(viewMonth)}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <NavButton label="Bulan sebelumnya" onClick={() => setViewMonth((m) => addMonths(m, -1))}>
            ‹
          </NavButton>
          <button
            type="button"
            onClick={() => {
              setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelected(new Date(now));
            }}
            className="btn-pill-soft py-2 text-[13px]"
          >
            Hari ini
          </button>
          <NavButton label="Bulan berikutnya" onClick={() => setViewMonth((m) => addMonths(m, 1))}>
            ›
          </NavButton>
        </div>
      </div>

      <div className="card p-4">
        <div className="grid grid-cols-7 gap-1.5">
          {HARI_PENDEK.map((h) => (
            <div key={h} className="t-meta pb-1 text-center text-ink40">
              {h}
            </div>
          ))}

          {days.map((day) => {
            const inMonth = day.getMonth() === viewMonth.getMonth();
            const isToday = sameDay(day, now);
            const isSelected = sameDay(day, selected);
            const dayTasks = tasksOnDate(tasks, day);
            const count = dayTasks.length + blocksOnDate(blocks, day).length;
            const anyOverdue = dayTasks.some((t) => isOverdue(t, now));

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelected(day)}
                aria-pressed={isSelected}
                aria-label={`${headerDate(day)}${count > 0 ? `, ${count} agenda` : ", kosong"}`}
                // h-11 (44px) — cukup buat target sentuh, tapi jauh lebih pendek
                // dari aspect-square yang bikin grid makan setengah layar HP.
                className={`relative flex h-11 flex-col items-center justify-center rounded-2xl text-[15px] font-bold transition-colors duration-[var(--dur-fast)] ${
                  isSelected
                    ? "bg-ink text-surface"
                    : isToday
                      ? "bg-subtle text-ink"
                      : inMonth
                        ? "text-ink hover:bg-subtle"
                        : "text-ink40"
                }`}
              >
                <span className="leading-none">{day.getDate()}</span>
                {/* Sampai 3 titik — sekilas kelihatan padat-enggaknya suatu hari,
                    bukan cuma "ada isinya". Merah kalau ada yang lewat deadline. */}
                {count > 0 && (
                  <span aria-hidden className="mt-1 flex gap-0.5">
                    {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-1 w-1 rounded-full ${
                          anyOverdue
                            ? "bg-accent"
                            : isSelected
                              ? "bg-surface"
                              : "bg-ink70"
                        }`}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-extrabold text-ink">{headerDate(selected)}</h2>

        {/*
          Kalender gak lagi punya kolom ketik sendiri — semua penambahan lewat
          chat. Tanggal yang lagi dipilih dititipin sebagai teks awal, jadi
          user tinggal nulis judulnya dan task-nya mendarat di hari yang bener.
        */}
        <motion.button
          type="button"
          whileTap={press}
          onClick={() => onAdd(`tambahin ${tanggalUntukChat(selected)} `)}
          className="btn-pill shrink-0 py-2 text-[13px]"
        >
          + Tambah
        </motion.button>
      </div>

      <div className="space-y-4">

        {selectedTasks.length === 0 && selectedBlocks.length === 0 ? (
          <p className="text-[15px] font-medium text-ink40">Gak ada apa-apa di tanggal ini.</p>
        ) : (
          <motion.ul variants={listContainer} initial="hidden" animate="show" className="space-y-2">
            <AnimatePresence initial={false}>
              {selectedBlocks.map((b) => (
                <motion.li
                  key={b.id}
                  variants={listItem}
                  exit="exit"
                  layout
                  className="card flex items-center gap-3 px-4 py-3"
                >
                  <span className="t-num w-16 shrink-0 text-ink40">{clock(new Date(b.startAt))}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink70">
                    {b.title}
                  </span>
                  <span className="chip shrink-0">sibuk</span>
                </motion.li>
              ))}

              {selectedTasks.map((task) => {
                const done = task.status === "done";
                return (
                  <motion.li
                    key={task.id}
                    variants={listItem}
                    exit="exit"
                    layout
                    className="card flex items-center gap-3 px-4 py-3"
                  >
                    <Checkbox
                      checked={done}
                      onChange={() => completeTask(task)}
                      label={`Selesaikan ${task.title}`}
                      size={20}
                    />
                    {!task.allDay && task.dueAt && (
                      <span className="t-num w-16 shrink-0 text-ink40">
                        {clock(new Date(task.dueAt))}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenTask(task)}
                      className="-my-3 min-w-0 flex-1 truncate py-3 text-left text-[15px] font-semibold text-ink"
                    >
                      <StrikeText done={done}>{task.title}</StrikeText>
                    </button>
                    {task.priority <= 2 && (
                      <span
                        className={
                          task.priority === 1 ? "chip-active !bg-accent shrink-0" : "chip shrink-0"
                        }
                      >
                        P{task.priority}
                      </span>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>
    </motion.div>
  );
}

function NavButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileTap={press}
      onClick={onClick}
      aria-label={label}
      className="icon-btn-paper h-11 w-11 text-[18px] font-bold"
    >
      {children}
    </motion.button>
  );
}
