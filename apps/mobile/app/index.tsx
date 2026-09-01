/**
 * Galeri primitif — layar verifikasi tahap 5.
 *
 * Tiap primitif dirender di sini biar bisa dicek dua-duanya, terang & gelap,
 * tanpa nunggu layar aslinya jadi. Sekalian ngebuktiin `openingMessage()`
 * jalan dari core dan MMKV masih nyimpen antar restart.
 */
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { openingMessage } from "@hakaitask/core/chat";
import { makeTask } from "@hakaitask/core";
import { useKaiStore } from "@hakaitask/core/store";
import { newId, useTasks } from "@hakaitask/app/tasks";
import { headerDate, clock, whenLabel } from "@hakaitask/app/format";
import { Card, Chip, IconButton, Pill, Screen, Switch, T, Tappable } from "../src/ui";
import { useTheme, useThemePref } from "../src/theme";

export default function Gallery() {
  const th = useTheme();
  const { toggle, pref } = useThemePref();
  const [now] = useState(() => new Date());
  const [chipOn, setChipOn] = useState(true);
  const [sw, setSw] = useState(false);
  const tasks = useTasks();

  const salam = useMemo(
    () => openingMessage({ now, tasks, blocks: [], userName: "Kai" }).text,
    [now, tasks],
  );

  const g = th.space[3];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingVertical: th.space[4], gap: g }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T variant="meta" tone="ink40">{headerDate(now)}</T>
          <T variant="num" tone="ink40" tabular>{clock(now)}</T>
        </View>

        <T variant="display">Selamat datang.</T>

        <Card>
          <T variant="body">{salam}</T>
        </Card>

        <T variant="meta" tone="ink40">Tipografi</T>
        <Card style={{ gap: 6 }}>
          <T variant="h1">Judul besar</T>
          <T variant="h2">Judul sedang</T>
          <T variant="body">Teks isi — 16px, tinggi baris 24.</T>
          <T variant="bodySm" tone="ink70">Teks kecil, ink70.</T>
          <T variant="meta" tone="ink40">Label meta</T>
          <T variant="num" tabular>09:41 · 1234567890</T>
          <T variant="mono">mono 13px</T>
          <T variant="body" tone="accent">Aksen — cuma buat telat & P1</T>
        </Card>

        <T variant="meta" tone="ink40">Tombol</T>
        <View style={{ gap: g }}>
          <Pill label="Tombol utama" onPress={() => {}} />
          <Pill label="Tombol lembut" tone="soft" onPress={() => {}} />
          <Pill label="Nonaktif" disabled />
        </View>

        <T variant="meta" tone="ink40">Chip</T>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip label="Aktif" active={chipOn} onPress={() => setChipOn(true)} />
          <Chip label="Pasif" active={!chipOn} onPress={() => setChipOn(false)} />
          <Chip label="#konten" />
        </View>

        <T variant="meta" tone="ink40">Ikon & switch</T>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: g }}>
          <IconButton onPress={() => {}}><T variant="body">＋</T></IconButton>
          <IconButton on="paper" onPress={() => {}}><T variant="body">✓</T></IconButton>
          <View style={{ flex: 1 }} />
          <Switch value={sw} onChange={setSw} />
        </Card>

        <T variant="meta" tone="ink40">Tema — sekarang: {pref} ({th.scheme})</T>
        <Pill label="Ganti terang / gelap" tone="soft" onPress={toggle} />

        <T variant="meta" tone="ink40">Uji simpan ({tasks.length} task)</T>
        <Pill
          label="Tambah task uji"
          onPress={() =>
            useKaiStore.getState().upsertTask(
              makeTask({
                id: newId(),
                userId: "local",
                title: `Uji ${clock(new Date())}`,
                allDay: false,
                tags: [],
                subtasks: [],
                dueAt: new Date(Date.now() + 86_400_000).toISOString(),
              }),
            )
          }
        />
        {tasks.map((t) => (
          <Tappable key={t.id} onPress={() => {}}>
            <Card style={{ borderRadius: th.radius.sm, paddingVertical: 12 }}>
              <T variant="body">{t.title}</T>
              <T variant="meta" tone="ink40">{whenLabel(t.dueAt, now, t.allDay)}</T>
            </Card>
          </Tappable>
        ))}
      </ScrollView>
    </Screen>
  );
}
