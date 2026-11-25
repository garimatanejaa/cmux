import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { ConnectionStatus } from "@brb/protocol";
import { colors, spacing } from "../theme";

export function Button({
  label, onPress, disabled, busy, kind = "primary", style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  kind?: "primary" | "secondary" | "danger";
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        kind === "secondary" && styles.buttonSecondary,
        kind === "danger" && styles.buttonDanger,
        off && styles.buttonOff,
        pressed && !off && { opacity: 0.8 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

export function StatusDot({ status }: { status: ConnectionStatus }) {
  const color = status === "open" ? colors.good : status === "connecting" ? colors.warn : colors.bad;
  const label = status === "open" ? "connected" : status === "connecting" ? "connecting" : "offline";
  return (
    <View style={styles.statusRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function Banner({ text, kind = "info" }: { text: string; kind?: "info" | "warn" | "error" }) {
  const color = kind === "error" ? colors.bad : kind === "warn" ? colors.warn : colors.accent;
  return (
    <View style={[styles.banner, { borderColor: color }]}>
      <Text style={{ color: colors.text }}>{text}</Text>
    </View>
  );
}

export function Header({ title, left, right }: { title: string; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>{left}</View>
      <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
      <View style={[styles.headerSide, { alignItems: "flex-end" }]}>{right}</View>
    </View>
  );
}

export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10}>
      <Text style={{ color: colors.accent, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, paddingHorizontal: spacing.lg,
    alignItems: "center", justifyContent: "center", minHeight: 44,
  },
  buttonSecondary: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.bad },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  muted: { color: colors.muted, fontSize: 13 },
  banner: { borderWidth: 1, borderRadius: 10, padding: spacing.md, backgroundColor: colors.panel, marginBottom: spacing.md },
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  headerSide: { width: 90, justifyContent: "center" },
  headerTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: "600", textAlign: "center" },
});
