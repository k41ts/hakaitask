import { motion } from "framer-motion";
import { headerDate } from "@hakaitask/app/format";
import { press } from "../lib/motion.js";
import { SyncBadge } from "./SyncBadge.js";
import { Toggle } from "./Toggle.js";
import { useTheme } from "../lib/theme.js";
import type { Page } from "../lib/pages.js";

/**
 * Header sengaja dijaga tipis. Jam dicabut (OS udah punya), status sync cuma
 * nongol kalau ADA yang perlu diketahui, dan label "terang/gelap" dibuang
 * karena switch-nya sendiri udah ngomong. Sisanya: tanggal, nav, aksi akun.
 */
export function Header({
  now,
  page,
  onNavigate,
  onSignOut,
}: {
  now: Date;
  page: Page;
  onNavigate: (page: Page) => void;
  onSignOut?: () => void;
}) {
  const { resolved, toggle } = useTheme();

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="t-meta text-ink40">{headerDate(now)}</div>

      {/* Tiga item, tetap pill — keputusan P4. Sidebar itu redesign layout
          tersendiri, bukan bagian dari pekerjaan chat. */}
      <nav aria-label="Halaman" className="flex gap-1 rounded-full bg-surface p-1">
        <NavTab active={page === "home"} onClick={() => onNavigate("home")}>
          Chat
        </NavTab>
        <NavTab active={page === "dashboard"} onClick={() => onNavigate("dashboard")}>
          Dashboard
        </NavTab>
        <NavTab active={page === "calendar"} onClick={() => onNavigate("calendar")}>
          Kalender
        </NavTab>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <SyncBadge />

        <Toggle
          on={resolved === "dark"}
          onChange={toggle}
          label={resolved === "dark" ? "Pakai mode terang" : "Pakai mode gelap"}
        />

        {onSignOut && (
          <motion.button
            type="button"
            whileTap={press}
            onClick={onSignOut}
            className="t-num -my-2 py-2 text-ink70 transition-colors duration-[var(--dur-fast)] hover:text-ink"
          >
            Keluar
          </motion.button>
        )}
      </div>
    </header>
  );
}

function NavTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`t-meta flex min-h-11 items-center rounded-full px-4 transition-colors duration-[var(--dur-fast)] ${
        active ? "bg-ink text-surface" : "text-ink70 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
