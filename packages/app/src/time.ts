import { useEffect, useState } from "react";

/**
 * Jam yang jalan. Nge-tick di detik ke-0 tiap menit, bukan tiap 60 detik dari
 * mount — biar tampilan jam gak pernah telat sampai satu menit.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()));
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  return now;
}
