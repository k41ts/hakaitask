import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Task } from "@hakaitask/core";
import { useKaiStore } from "@hakaitask/core/store";
import { SignIn, useAuth } from "./components/AuthGate.js";
import { CalendarView } from "./components/CalendarView.js";
import { ChatView } from "./components/ChatView.js";
import { CommandPalette, type Command } from "./components/CommandPalette.js";
import { DetailSheet } from "./components/DetailSheet.js";
import { EmptyState } from "./components/EmptyState.js";
import { FocusCard } from "./components/FocusCard.js";
import { Header } from "./components/Header.js";
import { buildEntries, UpcomingList } from "./components/UpcomingList.js";
import { useNow } from "@hakaitask/app";
import { useLenis } from "./lib/hooks.js";
import type { Page } from "./lib/pages.js";
import { useTheme } from "./lib/theme.js";
import { startSync } from "@hakaitask/app/sync";
import { supabase } from "./lib/supabase.js";
import { watchConnectivity } from "./lib/platform.js";
import { useBusyBlocks, useFocus, useTasks } from "@hakaitask/app/tasks";

/** Transisi antar halaman — sengaja objek polos biar gak merambat ke anak. */
const PAGE_ANIM = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.18 },
} as const;

export default function App() {
  const auth = useAuth();

  if (auth.state === "loading") {
    return <div className="min-h-dvh bg-paper" aria-busy="true" />;
  }
  if (auth.state === "signed-out") return <SignIn />;

  return (
    <Dashboard
      userId={auth.userId}
      name={auth.name}
      sync={auth.state === "signed-in"}
      {...(auth.state === "signed-in" ? { onSignOut: auth.signOut } : {})}
    />
  );
}

function Dashboard({
  userId,
  name,
  sync,
  onSignOut,
}: {
  userId: string;
  name: string;
  sync: boolean;
  onSignOut?: () => void;
}) {
  const now = useNow();
  useLenis();
  const { toggle: toggleTheme } = useTheme();

  const hydrated = useKaiStore((s) => s.hydrated);
  const tasks = useTasks();
  const blocks = useBusyBlocks();

  const [page, setPage] = useState<Page>("home");
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  // Default 5 biar dashboard tetap ringkas; kalau dibuka, tampilkan semua.
  const focus = useFocus(now, showAllUpcoming ? 999 : 5);
  const allUpcoming = useFocus(now, 999).upcoming.length;
  const hiddenCount = Math.max(0, allUpcoming - focus.upcoming.length);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  /** Teks yang dititipkan ke kolom chat saat pindah halaman ke sana. */
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (!sync || !supabase) return;
    return startSync({ client: supabase, userId, watchConnectivity }).stop;
  }, [sync, userId]);

  // Task yang lagi kebuka diambil dari store, bukan disalin ke state — biar
  // sheet ikut ke-update kalau datanya berubah dari device lain.
  const openTask = useMemo<Task | null>(
    () => (openTaskId ? (tasks.find((t) => t.id === openTaskId) ?? null) : null),
    [openTaskId, tasks],
  );

  const entries = useMemo(
    () => buildEntries(focus.upcoming, blocks, now),
    [focus.upcoming, blocks, now],
  );

  // Task yang diselesaikan hari ini — bedain "belum punya task" dari "udah kelar semua".
  const doneToday = useMemo(() => {
    const map = useKaiStore.getState().tasks;
    return Object.values(map).filter(
      (t) =>
        t.completedAt !== undefined &&
        new Date(t.completedAt).toDateString() === now.toDateString(),
    ).length;
  }, [now, tasks]);

  /**
   * Satu-satunya jalan masuk buat nambah apa pun sekarang: chat.
   *
   * Kolom ketik di dashboard & kalender dan overlay quick-add dicabut biar
   * gak ada dua tempat ngetik yang perilakunya beda-beda tipis. Tombol
   * "tambah" yang masih ada sekarang ngarahin ke sini, bukan buka kolom
   * sendiri — jadi tetap kelihatan, tanpa jadi input kedua.
   */
  const goToChat = useCallback((draft = "") => {
    setPage("home");
    setChatDraft(draft);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (!typing && (e.key === "n" || e.key === "+")) {
        e.preventDefault();
        goToChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToChat]);

  const commands = useMemo<Command[]>(
    () => [
      { id: "add", label: "Tambah task", hint: "n", run: () => goToChat("tambahin ") },
      // Sejak halaman jadi tiga, tombol "ganti halaman" yang cuma bolak-balik
      // udah gak cukup — tiap tujuan dikasih perintahnya sendiri.
      ...(page !== "home" ? [{ id: "nav-home", label: "Buka chat", run: () => setPage("home") }] : []),
      ...(page !== "dashboard"
        ? [{ id: "nav-dash", label: "Buka dashboard", run: () => setPage("dashboard") }]
        : []),
      ...(page !== "calendar"
        ? [{ id: "nav-cal", label: "Buka kalender", run: () => setPage("calendar") }]
        : []),
      { id: "theme", label: "Ganti mode terang/gelap", run: toggleTheme },
      ...(onSignOut ? [{ id: "signout", label: "Keluar", run: onSignOut }] : []),
    ],
    [goToChat, toggleTheme, onSignOut, page],
  );

  // Sebelum store selesai rehydrate, jangan render apa pun: kalau dirender
  // duluan, dashboard sempat kelihatan kosong lalu isinya "meledak" masuk.
  if (!hydrated) return <div className="min-h-dvh bg-paper" aria-busy="true" />;

  return (
    <div className="min-h-dvh bg-paper">
      {/*
        Navbar nempel di atas biar nav & aksi akun kejangkau tanpa harus
        scroll balik ke pucuk — chat bisa panjang banget.

        Latarnya SOLID, bukan blur transparan: bahasa desainnya (§7.3) sengaja
        gak pakai shadow/blur, elevasinya murni dari kontras. z-30 ditaruh di
        bawah sheet (z-40) & overlay (z-50) supaya gak nutupin keduanya.
      */}
      <div className="sticky top-0 z-30 bg-paper">
        <div className="mx-auto w-full max-w-[var(--max-content)] px-6 py-4">
          <Header
            now={now}
            page={page}
            onNavigate={setPage}
            {...(onSignOut ? { onSignOut } : {})}
          />
        </div>
      </div>

      <main className="mx-auto w-full max-w-[var(--max-content)] px-6 pb-32">
        {/*
          Nilai animasinya ditulis eksplisit, BUKAN label variant. Label itu
          merambat ke semua motion descendant (kartu, baris list), jadi exit-nya
          nunggu mereka semua kelar — dan kalau salah satu gak pernah selesai,
          AnimatePresence nyangkut nahan halaman lama sementara nav & FAB udah
          pindah. Objek biasa gak merambat, jadi aman.
        */}
        <AnimatePresence mode="wait">
          {page === "home" ? (
            <motion.div key="home" {...PAGE_ANIM} className="mt-10">
              <ChatView
                now={now}
                tasks={tasks}
                blocks={blocks}
                userId={userId}
                userName={name}
                draft={chatDraft}
                onDraftUsed={() => setChatDraft(null)}
                onOpenTask={(task) => setOpenTaskId(task.id)}
              />
            </motion.div>
          ) : page === "dashboard" ? (
            /* Dashboard sengaja tanpa sapaan sekarang (§2) — dia alat, bukan
               tempat basa-basi. Sapaan pindah ke chat. */
            <motion.div key="dashboard" className="mt-10" {...PAGE_ANIM}>
              <div className="space-y-6">
                {focus.focus ? (
                  <FocusCard
                    task={focus.focus}
                    now={now}
                    onOpen={() => setOpenTaskId(focus.focus!.id)}
                  />
                ) : (
                  <EmptyState
                    kind={doneToday > 0 ? "all-done" : "fresh"}
                    doneToday={doneToday}
                    onAdd={() => goToChat("tambahin ")}
                  />
                )}

                <UpcomingList
                  entries={entries}
                  now={now}
                  onOpen={(task) => setOpenTaskId(task.id)}
                  hiddenCount={hiddenCount}
                  expanded={showAllUpcoming}
                  onToggleExpand={() => setShowAllUpcoming((v) => !v)}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div key="calendar" {...PAGE_ANIM} className="mt-10">
              <CalendarView
                now={now}
                tasks={tasks}
                blocks={blocks}
                onAdd={goToChat}
                onOpenTask={(task) => setOpenTaskId(task.id)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <DetailSheet task={openTask} now={now} onClose={() => setOpenTaskId(null)} />

      <CommandPalette
        open={paletteOpen}
        tasks={tasks}
        now={now}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
        onOpenTask={(task) => setOpenTaskId(task.id)}
        onQuickAdd={(initial) => goToChat(`tambahin ${initial}`)}
      />
    </div>
  );
}
