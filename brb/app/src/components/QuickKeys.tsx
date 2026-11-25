import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import type { KeyModifier } from "@brb/protocol";
import { colors, spacing } from "../theme";

export interface QuickKey {
  label: string;
  name: string;
  modifiers?: KeyModifier[];
}

export const DEFAULT_KEYS: QuickKey[] = [
  { label: "Enter", name: "enter" },
  { label: "Esc", name: "esc" },
  { label: "Tab", name: "tab" },
  { label: "↑", name: "up" },
  { label: "↓", name: "down" },
  { label: "←", name: "left" },
  { label: "→", name: "right" },
  { label: "Ctrl+C", name: "c", modifiers: ["ctrl"] },
  { label: "Ctrl+D", name: "d", modifiers: ["ctrl"] },
];

export function QuickKeys({
  disabled, onKey, onText, snippets,
}: {
  disabled: boolean;
  onKey: (key: QuickKey) => void;
  onText: (text: string) => void;
  snippets: { label: string; text: string }[];
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="always">
      {DEFAULT_KEYS.map((key) => (
        <Chip key={key.label} label={key.label} disabled={disabled} onPress={() => onKey(key)} />
      ))}
      {snippets.map((snippet) => (
        <Chip key={snippet.label} label={snippet.label} disabled={disabled} onPress={() => onText(snippet.text)} />
      ))}
    </ScrollView>
  );
}

function Chip({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.chip, disabled && { opacity: 0.35 }, pressed && !disabled && { opacity: 0.7 }]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 44, alignItems: "center",
  },
  chipText: { color: colors.text, fontSize: 15 },
});
