import React, { useEffect, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { getPush, type PushInfo } from "@brb/protocol";
import { Banner, Button, Header, LinkButton } from "../components/ui";
import { ntfyDeepLink } from "../logic";
import { useRelay } from "../relay";
import { colors, spacing } from "../theme";

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { pairing, scope, status, unpair } = useRelay();
  const [push, setPush] = useState<PushInfo | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!pairing) return;
    getPush(pairing.baseUrl, pairing.token).then(setPush).catch(() => setPushError("Could not ask the Mac about notifications."));
  }, [pairing, status]);

  async function openNtfy() {
    if (!push?.subscribeUrl) return;
    try {
      await Linking.openURL(ntfyDeepLink(push.subscribeUrl));
    } catch {
      Alert.alert("ntfy isn't installed", "Install the free ntfy app from the App Store, then tap this again, or paste the address into ntfy yourself.");
    }
  }

  return (
    <View style={styles.root}>
      <Header title="Settings" left={<LinkButton label="‹ Back" onPress={onBack} />} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>This phone</Text>
        <Text style={styles.row}>Mac: {pairing?.baseUrl}</Text>
        <Text style={styles.row}>Phone id: {pairing?.deviceId.slice(0, 12)}</Text>
        <Text style={styles.row}>Access: {scope === "control" ? "can type and answer prompts" : "watch only"}</Text>
        {scope !== "control" && (
          <Text style={styles.muted}>To change it, on the Mac: brb-relay devices set-scope {pairing?.deviceId.slice(0, 8)} control</Text>
        )}

        <Text style={styles.section}>Notifications when you're away</Text>
        {pushError && <Banner kind="error" text={pushError} />}
        {push && !push.enabled && (
          <Banner text="Off. On the Mac run `brb-relay push setup`, then come back here." />
        )}
        {push?.enabled && push.subscribeUrl && (
          <>
            <Text style={styles.muted}>
              Install the free ntfy app, then subscribe to this private address. Anyone who has it can read your alerts.
              {push.includeText ? " Alerts include real text." : " Alerts only say an agent needs attention."}
            </Text>
            <Text selectable style={styles.mono}>{push.subscribeUrl}</Text>
            <View style={styles.buttons}>
              <Button label="Open in ntfy" onPress={openNtfy} />
              <Button label={copied ? "Copied" : "Copy address"} kind="secondary"
                onPress={async () => { await Clipboard.setStringAsync(push.subscribeUrl ?? ""); setCopied(true); }} />
            </View>
          </>
        )}

        <Text style={styles.section}>Remove this phone</Text>
        <Text style={styles.muted}>Signs this phone out of your Mac. You will need a new pairing code to use it again.</Text>
        <Button label="Unpair" kind="danger" onPress={() =>
          Alert.alert("Unpair this phone?", "It will stop seeing your agents.", [
            { text: "Cancel", style: "cancel" },
            { text: "Unpair", style: "destructive", onPress: () => void unpair() },
          ])} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 48 },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 64 },
  section: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: spacing.xl },
  row: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13 },
  mono: { color: colors.text, backgroundColor: colors.panel, padding: spacing.md, borderRadius: 8, fontFamily: "Menlo", fontSize: 13 },
  buttons: { gap: spacing.sm, marginTop: spacing.sm },
});
