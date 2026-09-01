/**
 * Cakupan kosakata.
 *
 * Kamus diperluas besar-besaran biar user gak perlu ngapalin "kata ajaib" —
 * dia nulis apa adanya dan tetap kebaca. Perluasan tanpa tes cuma klaim:
 * kata gampang ditambah ke JSON tapi diam-diam ketimpa aturan lain, persis
 * yang kejadian waktu "setengah" ditambah sebagai durasi dan langsung
 * ngerusak pembacaan "setengah 8 malem".
 *
 * Acuan waktu: Jumat, 7 Agustus 2026, 10:00.
 */
import { describe, expect, it } from "vitest";
import { analyze } from "./intent.js";
import { chatTurn, type ChatContext, type Effect, type Pending } from "./machine.js";
import { makeTask, type Task } from "../types.js";
import { parseQuickAdd } from "../parser/index.js";
import lex from "../parser/lexicon.id.json";
import chatLex from "./lexicon.chat.id.json";

const NOW = new Date(2026, 7, 7, 10, 0, 0);

function iso(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

function ctx(over: Partial<ChatContext> = {}): ChatContext {
  return { now: NOW, tasks: [], blocks: [], vocab: [], pending: null, userName: "Kai", ...over };
}

function conv(base: Partial<ChatContext> = {}) {
  let pending: Pending = null;
  return {
    send(input: string) {
      const r = chatTurn(input, { ...ctx(base), pending });
      pending = r.pending;
      return r;
    },
  };
}

function textOf(r: { messages: { text: string }[] }): string {
  return r.messages.map((m) => m.text).join("\n");
}

const CONTOH: Task[] = [
  makeTask({ id: "t1", userId: "u1", title: "Bikin laporan", dueAt: iso(2026, 8, 8, 9, 0) }),
];

// ── verba ────────────────────────────────────────────────────────────────────

describe("cakupan — verba dikenali dari banyak bentuk", () => {
  const kasus: Record<string, string[]> = {
    list: [
      "tampilkan task gw", "liatin task gw", "tunjukin task gw", "coba lihat task gw",
      "cekin task gw", "nyariin task laporan", "munculin task gw", "sebutin task gw",
      "rekap task gw", "keluarin task gw", "mencari task laporan",
    ],
    complete: [
      "selesein laporan", "selesain laporan", "menyelesaikan laporan",
      "kelarin laporan", "rampungin laporan", "tuntasin laporan",
      "centangin laporan", "contreng laporan", "tandain selesai laporan",
    ],
    uncomplete: [
      "batalkan selesai laporan", "buka lagi laporan", "uncheck laporan",
      "batalin centang laporan", "lepas centang laporan",
    ],
    reschedule: [
      "ubahin laporan", "gantiin laporan", "mindahin laporan", "geserin laporan",
      "undurin laporan", "majuin laporan", "tundain laporan", "atur ulang laporan",
    ],
    delete: [
      "hapusin laporan", "apusin laporan", "buangin laporan",
      "singkirin laporan", "ilangin laporan", "menghapus laporan",
    ],
    help: [
      "bantuan", "kamu bisa apa", "fitur apa aja", "cara pakainya", "panduan",
      "bisa ngapain aja",
    ],
    teach: ["ajarkan", "mengajari", "tambah kosakata", "daftarin istilah"],
  };

  for (const [verba, kalimat] of Object.entries(kasus)) {
    it(`${verba} (${kalimat.length} bentuk)`, () => {
      for (const s of kalimat) {
        expect(analyze(s, NOW).verb, s).toBe(verba);
      }
    });
  }

  it("frasa terpanjang tetap menang: 'buka lagi' ≠ 'buka'", () => {
    expect(analyze("buka lagi laporan", NOW).verb).toBe("uncomplete");
    expect(analyze("buka task gw", NOW).verb).toBe("list");
  });
});

// ── objek & status ───────────────────────────────────────────────────────────

describe("cakupan — objek & status", () => {
  it("banyak sebutan buat hal yang sama", () => {
    for (const kata of ["task", "tugas", "kerjaan", "pr", "agenda", "jadwal", "kegiatan", "acara", "rencana", "deadline"]) {
      expect(analyze(`tampilin ${kata} gw besok`, NOW).range?.label, kata).toBe("besok");
    }
  });

  it("status belum selesai", () => {
    for (const s of ["belum kelar", "belum rampung", "belum dikerjain", "masih ada", "pending"]) {
      expect(analyze(`tampilin task yang ${s}`, NOW).status, s).toBe("todo");
    }
  });

  it("status sudah selesai", () => {
    for (const s of ["udah beres", "sudah rampung", "udah tuntas", "kelar", "tuntas"]) {
      expect(analyze(`tampilin task yang ${s}`, NOW).status, s).toBe("done");
    }
  });

  it("status telat", () => {
    for (const s of ["terlambat", "kelewatan", "lewat deadline", "molor", "kadaluarsa"]) {
      expect(analyze(`tampilin task yang ${s}`, NOW).status, s).toBe("overdue");
    }
  });
});

// ── kategori ─────────────────────────────────────────────────────────────────

describe("cakupan — kategori baru", () => {
  const kasus: Record<string, string[]> = {
    rapat: ["standup", "kickoff", "retro", "townhall", "video call", "sync up"],
    kuliah: ["praktikum", "responsi", "matkul", "uts", "sempro", "bimbingan"],
    olahraga: ["badminton", "yoga", "gowes", "hiking", "renang"],
    medis: ["puskesmas", "fisioterapi", "dokter gigi", "imunisasi", "mcu"],
    sosial: ["kondangan", "bukber", "arisan", "nobar", "reuni"],
    ibadah: ["sholat", "jumatan", "pengajian", "tarawih", "misa"],
    kerja: ["lembur", "ngantor", "invoice", "onboarding", "piket"],
    perjalanan: ["boarding", "checkout", "mudik", "penerbangan", "stasiun"],
    rumah: ["nyetrika", "ngepel", "belanja bulanan", "buang sampah", "cuci baju"],
  };

  for (const [topik, kata] of Object.entries(kasus)) {
    it(`${topik}: ${kata.join(", ")}`, () => {
      for (const k of kata) {
        expect(analyze(`tampilin ${k} gw`, NOW).topic, k).toBe(topik);
      }
    });
  }

  it("kata generik nyapu kategori, kata spesifik nyaring", () => {
    const tasks = [
      makeTask({ id: "a", userId: "u1", title: "Zoom sama klien", dueAt: iso(2026, 8, 8, 10, 0) }),
      makeTask({ id: "b", userId: "u1", title: "Standup tim", dueAt: iso(2026, 8, 8, 9, 0) }),
    ];
    const generik = textOf(conv({ tasks }).send("tampilin semua rapat gw"));
    expect(generik).toContain("Zoom sama klien");
    expect(generik).toContain("Standup tim");

    const spesifik = textOf(conv({ tasks }).send("tampilin standup gw"));
    expect(spesifik).toContain("Standup tim");
    expect(spesifik).not.toContain("Zoom sama klien");
  });
});

// ── basa-basi & jawaban ──────────────────────────────────────────────────────

describe("cakupan — basa-basi gak ninggalin jejak", () => {
  it("banyak bentuk terima kasih", () => {
    for (const s of ["makasih", "makasih ya", "trims", "tengkyu", "thx", "tq", "thank you"]) {
      const r = conv().send(s);
      expect(r.effects, s).toHaveLength(0);
      expect(textOf(r), s).toBe("Sama-sama.");
    }
  });

  it("sapaan & reaksi juga aman", () => {
    for (const s of ["halo", "hai", "mantap", "wkwkwk", "noted", "gapapa", "keren"]) {
      expect(conv().send(s).effects, s).toHaveLength(0);
    }
  });
});

describe("cakupan — jawaban ya/tidak", () => {
  it("banyak bentuk setuju", () => {
    for (const s of ["ya", "iyaa", "gaskeun", "oke deh", "sipp", "boleh deh", "yaudah", "setuju"]) {
      const c = conv({ tasks: CONTOH });
      c.send("hapus laporan");
      expect(c.send(s).effects, s).toHaveLength(1);
    }
  });

  it("banyak bentuk menolak", () => {
    for (const s of ["gausah", "gak jadi", "nggak usah", "lupain", "cancel", "stop", "batal"]) {
      const c = conv({ tasks: CONTOH });
      c.send("hapus laporan");
      expect(c.send(s).effects, s).toHaveLength(0);
    }
  });

  it("'yang terakhir' nunjuk pilihan paling bawah", () => {
    const banyak = [
      makeTask({ id: "x1", userId: "u1", title: "Rapat pagi", dueAt: iso(2026, 8, 8, 8, 0) }),
      makeTask({ id: "x2", userId: "u1", title: "Rapat siang", dueAt: iso(2026, 8, 8, 12, 0) }),
      makeTask({ id: "x3", userId: "u1", title: "Rapat sore", dueAt: iso(2026, 8, 8, 16, 0) }),
    ];
    const c = conv({ tasks: banyak });
    c.send("selesaiin rapat");
    expect(c.send("yang terakhir").effects[0]).toMatchObject({ id: "x3" });
  });
});

// ── parser: singkatan, salah ketik, kata benda ───────────────────────────────

describe("cakupan — singkatan & salah ketik waktu", () => {
  const p = (s: string) => parseQuickAdd(s, { now: NOW });

  it("singkatan hari & tanggal", () => {
    expect(p("rapat bsk").dueAt?.getDate()).toBe(8);
    expect(p("rapat tggl 25").dueAt?.getDate()).toBe(25);
  });

  it("kata masa lalu SENGAJA gak bikin tanggal — orang gak bikin task ke belakang", () => {
    // Di jalur CARI, "kemarin" tetap kebaca (lihat chat.test.ts). Yang gak
    // berlaku cuma di jalur BIKIN.
    expect(p("rapat kmrin").dueAt).toBeUndefined();
  });

  it("singkatan nama hari", () => {
    expect(p("rapat sen").dueAt?.getDate()).toBe(10);
    expect(p("rapat jum").dueAt?.getDate()).toBe(14);
  });

  it("variasi bagian hari", () => {
    expect(p("olahraga besok pagii").dueAt?.getHours()).toBe(8);
    expect(p("rapat besok malem").dueAt?.getHours()).toBe(20);
  });

  it("REGRESI: 'setengah' tetap dibaca jam, bukan durasi", () => {
    const r = p("kelas setengah 8 malem");
    expect(r.dueAt?.getHours()).toBe(19);
    expect(r.dueAt?.getMinutes()).toBe(30);
  });
});

describe("cakupan — kata benda & prioritas baru", () => {
  const p = (s: string) => parseQuickAdd(s, { now: NOW });

  it("prioritas dari kalimat sehari-hari", () => {
    expect(p("kirim proposal segera").priority).toBe(1);
    expect(p("kirim proposal mepet").priority).toBe(1);
    expect(p("kirim proposal lumayan penting").priority).toBe(2);
    expect(p("beresin meja opsional").priority).toBe(4);
    expect(p("beresin meja santai").priority).toBe(4);
  });

  it("durasi dari kalimat sehari-hari", () => {
    expect(p("meeting dua jam").estimateMin).toBe(120);
    expect(p("beresin setengah hari").estimateMin).toBe(240);
    expect(p("telepon klien cepet").estimateMin).toBe(15);
  });

  it("kata benda baru gak bikin judulnya rusak", () => {
    for (const s of ["bayar ukt besok", "nyetrika besok", "deploy besok", "fisioterapi besok"]) {
      const r = p(s);
      expect(r.title.length, s).toBeGreaterThan(0);
      expect(r.dueAt?.getDate(), s).toBe(8);
    }
  });
});

// ── audit: jangan sampai ada entri kamus yang gak pernah kepakai ────────────

describe("audit kamus — tiap entri harus beneran berpengaruh", () => {
  /**
   * Kata gampang ditambah ke JSON, tapi diam-diam bisa gak pernah kena karena
   * kata pendampingnya udah dibuang di tahap sampah yang jalan lebih dulu.
   * "penting banget" pernah begitu: `banget` masuk daftar filler, jadi frasa
   * itu gak akan pernah cocok dan cuma jadi hiasan di kamus.
   */
  it("semua priorityWords berpengaruh", () => {
    const mati: string[] = [];
    for (const [frasa, nilai] of Object.entries(lex.priorityWords as Record<string, number>)) {
      const r = parseQuickAdd(`kirim proposal ${frasa}`, { now: NOW });
      if (r.priority !== nilai) mati.push(`${frasa} (dapet ${r.priority ?? "-"}, harusnya ${nilai})`);
    }
    expect(mati).toEqual([]);
  });

  it("semua durationPhrase berpengaruh", () => {
    const mati: string[] = [];
    for (const [frasa, nilai] of Object.entries(lex.durationPhrase as Record<string, number>)) {
      const r = parseQuickAdd(`kirim proposal ${frasa}`, { now: NOW });
      if (r.estimateMin !== nilai) mati.push(`${frasa} (dapet ${r.estimateMin ?? "-"}, harusnya ${nilai})`);
    }
    expect(mati).toEqual([]);
  });

  it("semua verba chat kedeteksi sebagai verbanya sendiri", () => {
    const mati: string[] = [];
    for (const [verba, daftar] of Object.entries(chatLex.verbs as Record<string, string[]>)) {
      for (const frasa of daftar) {
        if (analyze(`${frasa} laporan`, NOW).verb !== verba) mati.push(`${verba}: ${frasa}`);
      }
    }
    expect(mati).toEqual([]);
  });

  it("semua kata kategori kepetain ke kategorinya", () => {
    const mati: string[] = [];
    for (const [topik, daftar] of Object.entries(chatLex.topicGroups as Record<string, string[]>)) {
      for (const kata of daftar) {
        if (analyze(`tampilin ${kata} gw`, NOW).topic !== topik) mati.push(`${topik}: ${kata}`);
      }
    }
    expect(mati).toEqual([]);
  });
});
