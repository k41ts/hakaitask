/**
 * Format tanggal & waktu gaya Indonesia (§7.5).
 * Jam pakai titik — "14.00", bukan "14:00" — sesuai kebiasaan tulis Indonesia.
 */

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const DAY_MS = 86_400_000;

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "KAMIS, 7 AGUSTUS" — dipakai di header, di-uppercase lewat CSS. */
export function headerDate(d: Date): string {
  return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]}`;
}

/** "07.05" */
export function clock(d: Date): string {
  return `${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Selisih hari kalender, bukan selisih 24 jam. */
export function dayDiff(target: Date, now: Date): number {
  return Math.round(
    (startOfDay(target).getTime() - startOfDay(now).getTime()) / DAY_MS,
  );
}

/**
 * Label waktu ringkas buat baris upcoming:
 * hari ini → jam, besok/lusa → kata, dalam seminggu → nama hari, sisanya → tanggal.
 */
export function whenLabel(iso: string | undefined, now: Date, allDay = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = dayDiff(d, now);

  if (diff === 0) return allDay ? "Hari ini" : clock(d);
  if (diff === 1) return "Besok";
  if (diff === 2) return "Lusa";
  if (diff === -1) return "Kemarin";
  if (diff > 2 && diff < 7) return HARI[d.getDay()]!;
  if (diff < 0) return `${Math.abs(diff)} hari lalu`;
  return `${d.getDate()} ${BULAN[d.getMonth()]!.slice(0, 3)}`;
}

/** Baris meta focus card: "P1 · 14.00 · ~90 menit" */
export function metaLine(parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(" · ");
}

export function durationLabel(min: number | undefined): string | undefined {
  if (min === undefined) return undefined;
  if (min < 60) return `~${min} menit`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `~${h} jam` : `~${h} jam ${m} menit`;
}

export function isOverdue(task: { dueAt?: string; status: string }, now: Date): boolean {
  if (!task.dueAt || task.status === "done" || task.status === "archived") return false;
  return new Date(task.dueAt).getTime() < now.getTime();
}

/** "besok jam 9" untuk snooze cepat (§5.1 #5). */
export function snoozeTargets(now: Date): Array<{ label: string; at: Date }> {
  const besok = startOfDay(new Date(now.getTime() + DAY_MS));
  besok.setHours(9, 0, 0, 0);

  // Akhir pekan = Sabtu terdekat. Kalau hari ini udah Sabtu/Minggu, ambil Sabtu depan.
  const akhirPekan = startOfDay(now);
  const toSat = (6 - akhirPekan.getDay() + 7) % 7 || 7;
  akhirPekan.setDate(akhirPekan.getDate() + toSat);
  akhirPekan.setHours(9, 0, 0, 0);

  // Minggu depan = Senin berikutnya.
  const mingguDepan = startOfDay(now);
  const toMon = (1 - mingguDepan.getDay() + 7) % 7 || 7;
  mingguDepan.setDate(mingguDepan.getDate() + toMon);
  mingguDepan.setHours(9, 0, 0, 0);

  return [
    { label: "Besok", at: besok },
    { label: "Akhir pekan", at: akhirPekan },
    { label: "Minggu depan", at: mingguDepan },
  ];
}
