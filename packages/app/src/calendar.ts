import type { BusyBlock, Task } from "@hakaitask/core";

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Grid 6×7 (Minggu–Sabtu) yang selalu penuh, termasuk hari dari bulan sebelah. */
export function monthMatrix(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = startOfDay(new Date(first.getTime() - first.getDay() * DAY_MS));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
}

export function tasksOnDate(tasks: readonly Task[], date: Date): Task[] {
  return tasks.filter((t) => {
    if (t.deletedAt) return false;
    const d = t.dueAt ?? t.startAt;
    return d !== undefined && sameDay(new Date(d), date);
  });
}

export function blocksOnDate(blocks: readonly BusyBlock[], date: Date): BusyBlock[] {
  return blocks.filter((b) => sameDay(new Date(b.startAt), date));
}

export function monthLabel(date: Date): string {
  const BULAN = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  return `${BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}
