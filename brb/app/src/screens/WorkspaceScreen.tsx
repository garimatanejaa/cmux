import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { isTerminalSurface, type Surface, type Workspace } from "@brb/protocol";
import { Banner, Header, LinkButton } from "../components/ui";
import { useRelay } from "../relay";
import { colors, spacing } from "../theme";

export function WorkspaceScreen({
  workspace, onBack, onOpenTerminal,
}: {
  workspace: Workspace;
  onBack: () => void;
  onOpenTerminal: (workspaceId: string, surfaceId: string, title: string) => void;
}) {
  const { client, status } = useRelay();
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!client || client.connectionStatus !== "open") return;
    try {
      const list = await client.listSurfaces(workspace.id);
      setSurfaces(list.filter(isTerminalSurface).sort((a, b) => a.index - b.index));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load terminals.");
    }
  }, [client, workspace.id]);

  useEffect(() => { void load(); }, [load, status]);

  return (
    <View style={styles.root}>
      <Header title={workspace.title} left={<LinkButton label="‹ Back" onPress={onBack} />} />
      {error && <View style={styles.pad}><Banner kind="error" text={error} /></View>}
      <FlatList
        data={surfaces}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.text} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<Text style={styles.empty}>No terminals in this workspace.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => onOpenTerminal(workspace.id, item.id, item.title)}>
            <Text style={styles.itemTitle}>{item.title || "Terminal"}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 48 },
  pad: { padding: spacing.lg, paddingBottom: 0 },
  item: {
    flexDirection: "row", alignItems: "center", padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  itemTitle: { flex: 1, color: colors.text, fontSize: 17 },
  chevron: { color: colors.muted, fontSize: 24 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 48 },
});
