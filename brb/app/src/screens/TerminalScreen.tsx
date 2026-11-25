import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { RelayRPCError, type ScreenState } from "@brb/protocol";
import { QuickKeys, type QuickKey } from "../components/QuickKeys";
import { TerminalView } from "../components/TerminalView";
import { Banner, Button, Header, LinkButton, StatusDot } from "../components/ui";
import { useRelay } from "../relay";
import { colors, spacing } from "../theme";

export function TerminalScreen({
  workspaceId, surfaceId, title, onBack,
}: {
  workspaceId: string;
  surfaceId: string;
  title: string;
  onBack: () => void;
}) {
  const { client, status, scope, relayState, pairing } = useRelay();
  const [screen, setScreen] = useState<ScreenState | undefined>(client?.screenFor(surfaceId));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canType = scope === "control";

  // Live screen: subscribe while this screen is open and again after every reconnect.
  useEffect(() => {
    if (!client) return;
    const off = client.onScreen((s) => { if (s.surfaceId === surfaceId) setScreen(s); });
    const start = () => client.subscribe(workspaceId, surfaceId).catch((e) => setError(e instanceof Error ? e.message : "Could not open the terminal."));
    if (client.connectionStatus === "open") void start();
    return () => {
      off();
      if (client.connectionStatus === "open") void client.unsubscribe(surfaceId).catch(() => {});
    };
  }, [client, workspaceId, surfaceId]);

  // After a reconnect the client re-subscribes by itself; show whatever it has.
  useEffect(() => { setScreen(client?.screenFor(surfaceId)); }, [client, status, surfaceId]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      if (e instanceof RelayRPCError && e.isForbidden) {
        setError(`This phone can only watch. On the Mac run: brb-relay devices set-scope ${pairing?.deviceId.slice(0, 8) ?? "<id>"} control`);
      } else {
        setError(e instanceof Error ? e.message : "That did not go through.");
      }
    }
  }, [pairing]);

  const sendLine = useCallback(() => {
    if (!client || !text) return;
    const line = text;
    setText("");
    void run(async () => {
      await client.sendText(workspaceId, surfaceId, line);
      await client.sendKey(workspaceId, surfaceId, "enter");
    });
  }, [client, text, workspaceId, surfaceId, run]);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Header title={title} left={<LinkButton label="‹ Back" onPress={onBack} />} right={<StatusDot status={status} />} />
      {!canType && <View style={styles.pad}><Banner kind="info" text="Watch only. Ask for a control code on the Mac to type from here." /></View>}
      {error && <View style={styles.pad}><Banner kind="error" text={error} /></View>}
      <TerminalView screen={screen} />
      <QuickKeys
        disabled={!canType || status !== "open"}
        snippets={relayState?.snippets ?? []}
        onKey={(key: QuickKey) => { if (client) void run(() => client.sendKey(workspaceId, surfaceId, key.name, key.modifiers)); }}
        onText={(snippet) => { if (client) void run(() => client.sendText(workspaceId, surfaceId, snippet)); }}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input} value={text} onChangeText={setText}
          placeholder={canType ? "Type to the agent…" : "Watch only"} placeholderTextColor={colors.muted}
          editable={canType} autoCapitalize="none" autoCorrect={false} onSubmitEditing={sendLine} returnKeyType="send"
        />
        <Button label="Send" onPress={sendLine} disabled={!canType || !text || status !== "open"} />
      </View>
      <Text style={styles.hint}>{screen ? `${screen.cols}×${screen.rows.length}` : ""}</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 48 },
  pad: { padding: spacing.md, paddingBottom: 0 },
  inputRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md, alignItems: "center" },
  input: {
    flex: 1, color: colors.text, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1,
    borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 16,
  },
  hint: { color: colors.muted, fontSize: 11, textAlign: "center", paddingBottom: spacing.sm },
});
