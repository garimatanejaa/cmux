import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { health } from "@brb/protocol";
import { Banner, Button } from "../components/ui";
import { pairingErrorMessage, useRelay } from "../relay";
import { toBaseUrl } from "../logic";
import { colors, spacing } from "../theme";

export function PairScreen() {
  const { pair } = useRelay();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);

  async function check() {
    const base = toBaseUrl(address);
    if (!base) return setMessage({ text: "Enter the Mac's Tailscale address first.", kind: "error" });
    setBusy(true);
    const ok = await health(base);
    setBusy(false);
    setMessage(ok
      ? { text: "The relay on your Mac answered. Now enter the pairing code.", kind: "info" }
      : { text: "No answer. Is BRB running on the Mac (`brb-relay serve`), and is Tailscale on for both?", kind: "error" });
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      await pair(address, code);
    } catch (error) {
      setMessage({ text: pairingErrorMessage(error), kind: "error" });
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>BRB</Text>
        <Text style={styles.tagline}>Your agents keep going.</Text>

        <Text style={styles.step}>1. On your Mac</Text>
        <Text style={styles.help}>Start the relay and make a pairing code:</Text>
        <Text style={styles.code}>brb-relay serve{"\n"}brb-relay pair</Text>

        <Text style={styles.step}>2. Here</Text>
        <Text style={styles.label}>Mac address (Tailscale)</Text>
        <TextInput
          style={styles.input} value={address} onChangeText={setAddress}
          placeholder="100.101.102.103 or mac.tail1234.ts.net" placeholderTextColor={colors.muted}
          autoCapitalize="none" autoCorrect={false} keyboardType="url"
        />
        <Text style={styles.label}>Pairing code</Text>
        <TextInput
          style={styles.input} value={code} onChangeText={setCode}
          placeholder="XXXX-XXXX-XXXX-XXXX" placeholderTextColor={colors.muted}
          autoCapitalize="characters" autoCorrect={false}
        />
        {message && <Banner text={message.text} kind={message.kind === "error" ? "error" : "info"} />}
        <View style={styles.buttons}>
          <Button label="Check connection" kind="secondary" onPress={check} disabled={busy} />
          <Button label="Pair this phone" onPress={submit} busy={busy} disabled={!address.trim() || !code.trim()} />
        </View>
        <Text style={styles.fine}>
          New phones can only watch. To let this phone type into terminals, make the code with `brb-relay pair --control`.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingTop: 64 },
  title: { color: colors.text, fontSize: 40, fontWeight: "800" },
  tagline: { color: colors.muted, fontSize: 16, marginBottom: spacing.xl },
  step: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.sm },
  help: { color: colors.muted, marginBottom: spacing.sm },
  code: {
    color: colors.text, backgroundColor: colors.panel, padding: spacing.md, borderRadius: 8,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), overflow: "hidden",
  },
  label: { color: colors.muted, marginTop: spacing.md, marginBottom: 6 },
  input: {
    color: colors.text, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1,
    borderRadius: 10, padding: spacing.md, fontSize: 16, marginBottom: spacing.sm,
  },
  buttons: { gap: spacing.sm, marginTop: spacing.md },
  fine: { color: colors.muted, fontSize: 13, marginTop: spacing.lg },
});
