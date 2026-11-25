import React, { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { RelayRPCError, type FeedPendingItem, type FeedReply } from "@brb/protocol";
import { Banner, Button, Header, LinkButton } from "../components/ui";
import { replyFor } from "../logic";
import { useRelay } from "../relay";
import { colors, spacing } from "../theme";

const PERMISSION_LABELS: Record<string, string> = { once: "Allow once", always: "Always allow", deny: "Deny" };
const PLAN_LABELS: Record<string, string> = { autoAccept: "Accept (auto-edit)", manual: "Approve step by step", deny: "Reject" };

function Card({ item, canAnswer, onAnswer }: { item: FeedPendingItem; canAnswer: boolean; onAnswer: (reply: FeedReply) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const question = item.questions?.[0];

  async function send(reply: FeedReply | null) {
    if (!reply) return;
    setBusy(true);
    try { await onAnswer(reply); } finally { setBusy(false); }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.source}>{item.source} · {item.kind}</Text>
      {item.title ? <Text style={styles.title}>{item.title}</Text> : null}
      {item.cwd ? <Text style={styles.muted}>{item.cwd}</Text> : null}

      {item.kind === "permission" && (
        <>
          <Text style={styles.body}>{item.tool_name ?? "A tool"} wants to run</Text>
          {item.tool_input ? <Text style={styles.mono} numberOfLines={12}>{item.tool_input}</Text> : null}
          <View style={styles.buttons}>
            {(item.available_modes ?? ["once", "always", "deny"]).map((mode) => (
              <Button key={mode} label={PERMISSION_LABELS[mode] ?? mode} kind={mode === "deny" ? "danger" : mode === "once" ? "primary" : "secondary"}
                disabled={!canAnswer} busy={busy} onPress={() => void send(replyFor(item, mode))} />
            ))}
          </View>
        </>
      )}

      {item.kind === "plan" && (
        <>
          {item.plan_text ? <Text style={styles.mono} numberOfLines={20}>{item.plan_text}</Text> : null}
          <View style={styles.buttons}>
            {(item.available_modes ?? ["autoAccept", "manual", "deny"]).map((mode) => (
              <Button key={mode} label={PLAN_LABELS[mode] ?? mode} kind={mode === "deny" ? "danger" : mode === "autoAccept" ? "primary" : "secondary"}
                disabled={!canAnswer} busy={busy} onPress={() => void send(replyFor(item, mode))} />
            ))}
          </View>
        </>
      )}

      {item.kind === "question" && question && (
        <>
          <Text style={styles.body}>{question.prompt}</Text>
          <View style={styles.buttons}>
            {question.options.map((option) => {
              const on = picked.includes(option.label);
              return (
                <Button key={option.id} label={question.multi_select && on ? `✓ ${option.label}` : option.label}
                  kind={on ? "primary" : "secondary"} disabled={!canAnswer} busy={busy && !question.multi_select}
                  onPress={() => {
                    if (question.multi_select) {
                      setPicked(on ? picked.filter((p) => p !== option.label) : [...picked, option.label]);
                    } else {
                      void send(replyFor(item, "", [option.label]));
                    }
                  }} />
              );
            })}
            {question.multi_select && (
              <Button label="Send answer" disabled={!canAnswer || picked.length === 0} busy={busy}
                onPress={() => void send(replyFor(item, "", picked))} />
            )}
          </View>
          {(item.questions?.length ?? 0) > 1 && <Text style={styles.muted}>This agent asked more than one question; answer the rest in the terminal.</Text>}
        </>
      )}
    </View>
  );
}

export function PromptsScreen({ onBack }: { onBack: () => void }) {
  const { client, status, scope, refreshPending } = useRelay();
  const [items, setItems] = useState<FeedPendingItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!client || client.connectionStatus !== "open") return;
    try {
      setItems((await client.pendingPrompts(50)).items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load prompts.");
    }
    void refreshPending();
  }, [client, refreshPending]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load, status]);

  const answer = useCallback(async (reply: FeedReply) => {
    if (!client) return;
    try {
      await client.answerPrompt(reply);
      setError(null);
    } catch (e) {
      setError(e instanceof RelayRPCError && e.isForbidden
        ? "This phone can only watch. Make a control code on the Mac: brb-relay pair --control"
        : e instanceof Error ? e.message : "That did not go through.");
    }
    await load();
  }, [client, load]);

  return (
    <View style={styles.root}>
      <Header title="Prompts" left={<LinkButton label="‹ Back" onPress={onBack} />} />
      {scope !== "control" && <View style={styles.pad}><Banner text="Watch only: you can read prompts but not answer them from this phone." /></View>}
      {error && <View style={styles.pad}><Banner kind="error" text={error} /></View>}
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.text} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing is waiting for you.</Text>}
        renderItem={({ item }) => <Card item={item} canAnswer={scope === "control"} onAnswer={answer} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 48 },
  pad: { padding: spacing.lg, paddingBottom: 0 },
  card: { backgroundColor: colors.panel, borderRadius: 12, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  source: { color: colors.accent, fontSize: 12, textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  body: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 12 },
  mono: { color: colors.text, backgroundColor: colors.bg, padding: spacing.sm, borderRadius: 6, fontSize: 12, fontFamily: "Menlo" },
  buttons: { gap: spacing.sm, marginTop: spacing.sm },
  empty: { color: colors.muted, textAlign: "center", marginTop: 48 },
});
