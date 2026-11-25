import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { Workspace } from "@brb/protocol";
import { Banner, Header, LinkButton, StatusDot } from "../components/ui";
import { useRelay } from "../relay";
import { colors, spacing } from "../theme";

export function HomeScreen({
  onOpenWorkspace, onOpenTerminal, onPrompts, onSettings,
}: {
  onOpenWorkspace: (workspace: Workspace) => void;
  onOpenTerminal: (workspaceId: string, surfaceId: string, title: string) => void;
  onPrompts: () => void;
  onSettings: () => void;
}) {
  const { client, status, alerts, pendingCount, clearAlerts } = useRelay();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!client || client.connectionStatus !== "open") return;
    try {
      setWorkspaces((await client.listWorkspaces()).sort((a, b) => a.index - b.index));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load workspaces.");
    }
  }, [client]);

  useEffect(() => { void load(); }, [load, status]);

  return (
    <View style={styles.root}>
      <Header
        title="Agents"
        left={<StatusDot status={status} />}
        right={<LinkButton label={pendingCount > 0 ? `Prompts (${pendingCount})` : "Prompts"} onPress={onPrompts} />}
      />
      {alerts.length > 0 && (
        <View style={styles.alerts}>
          {alerts.slice(0, 3).map((alert) => (
            <Pressable
              key={alert.id}
              onPress={() => {
                if (alert.workspaceId && alert.surfaceId) onOpenTerminal(alert.workspaceId, alert.surfaceId, alert.title || "Terminal");
                else onPrompts();
              }}
            >
              <Banner kind="warn" text={`${alert.title || "An agent needs your attention"}${alert.body ? `: ${alert.body}` : ""}`} />
            </Pressable>
          ))}
          <LinkButton label="Dismiss" onPress={clearAlerts} />
        </View>
      )}
      {status !== "open" && <View style={styles.pad}><Banner kind="warn" text="Not connected to your Mac. Check that BRB is running there and that Tailscale is on." /></View>}
      {error && <View style={styles.pad}><Banner kind="error" text={error} /></View>}
      <FlatList
        data={workspaces}
        keyExtractor={(w) => w.id}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.text} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={status === "open" ? <Text style={styles.empty}>No workspaces yet. Open one in cmux on your Mac.</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => onOpenWorkspace(item)}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />
      <View style={styles.footer}><LinkButton label="Settings" onPress={onSettings} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 48 },
  pad: { padding: spacing.lg, paddingBottom: 0 },
  alerts: { padding: spacing.lg, paddingBottom: 0 },
  item: {
    flexDirection: "row", alignItems: "center", padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  itemTitle: { flex: 1, color: colors.text, fontSize: 17 },
  chevron: { color: colors.muted, fontSize: 24 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 48, paddingHorizontal: spacing.xl },
  footer: { padding: spacing.lg, alignItems: "center" },
});
