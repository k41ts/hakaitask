/**
 * Audit kemurnian lintas platform — penjaga sebenarnya buat §2.2.
 *
 * Aturan "core & app gak boleh nyentuh DOM" selama ini cuma dijaga kebiasaan.
 * Dikira dijaga `lib: ["ES2022"]` di tsconfig.base, padahal ENGGAK:
 * `types: ["vitest/globals"]` narik balik lib DOM secara transitif, jadi
 * `localStorage.getItem("x")` lolos tsc mulus — di app maupun di core.
 * Dicek langsung waktu packages/app dibikin, dan emang lolos.
 *
 * Jadi penjaganya di sini. Bukan gaya-gayaan: satu `window.` nyelip ke core
 * baru ketahuan pas app-nya crash di Hermes, jauh dari tempat nulisnya.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = {
  "@hakaitask/app": HERE,
  "@hakaitask/core": join(HERE, "..", "..", "core", "src"),
};

/** Global yang cuma ada di browser — masing-masing bikin app mati di Hermes. */
const TERLARANG = [
  { pola: /\bwindow\s*\./, nama: "window" },
  { pola: /\bdocument\s*\./, nama: "document" },
  { pola: /\blocalStorage\b/, nama: "localStorage" },
  { pola: /\bsessionStorage\b/, nama: "sessionStorage" },
  { pola: /\bnavigator\s*\./, nama: "navigator" },
  { pola: /\bimport\.meta\.env\b/, nama: "import.meta.env" },
  { pola: /from\s+["']react-dom["']/, nama: "react-dom" },
  { pola: /from\s+["']react-native["']/, nama: "react-native" },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Komentar dibuang dulu — file ini sendiri nyebut nama-nama itu di prosa. */
function kode(isi: string): string {
  return isi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("kemurnian lintas platform (§2.2)", () => {
  for (const [paket, root] of Object.entries(ROOTS)) {
    describe(paket, () => {
      for (const file of sourceFiles(root)) {
        const rel = relative(root, file).split(sep).join("/");
        it(`${rel} bebas global khusus browser`, () => {
          const isi = kode(readFileSync(file, "utf8"));
          const ketemu = TERLARANG.filter(({ pola }) => pola.test(isi)).map((t) => t.nama);
          expect(ketemu).toEqual([]);
        });
      }
    });
  }
});
