import React, { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { Workspace } from "@brb/protocol";
import { RelayProvider, useRelay } from "./src/relay";
import { HomeScreen } from "./src/screens/HomeScreen";
import { PairScreen } from "./src/screens/PairScreen";
import { PromptsScreen } from "./src/screens/PromptsScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TerminalScreen } from "./src/screens/TerminalScreen";
import { WorkspaceScreen } from "./src/screens/WorkspaceScreen";
import { colors } from "./src/theme";

type Route =
  | { name: "home" }
  | { name: "workspace"; workspace: Workspace }
  | { name: "terminal"; workspaceId: string; surfaceId: string; title: string; back: Route }
  | { name: "prompts" }
  | { name: "settings" };

function Root() {
  const { ready, pairing } = useRelay();
  const [route, setRoute] = useState<Route>({ name: "home" });

  const goBack = (): boolean => {
    if (route.name === "home") return false;
    setRoute(route.name === "terminal" ? route.back : { name: "home" });
    return true;
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", goBack);
    return () => sub.remove();
  });

  // Back to the start when this phone is unpaired.
  useEffect(() => { if (!pairing) setRoute({ name: "home" }); }, [pairing]);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}><ActivityIndicator color={colors.text} /></View>;
  }
  if (!pairing) return <PairScreen />;

  const openTerminal = (workspaceId: string, surfaceId: string, title: string, back: Route) =>
    setRoute({ name: "terminal", workspaceId, surfaceId, title, back });

  switch (route.name) {
    case "workspace":
      return (
        <WorkspaceScreen
          workspace={route.workspace}
          onBack={() => setRoute({ name: "home" })}
          onOpenTerminal={(w, s, t) => openTerminal(w, s, t, route)}
        />
      );
    case "terminal":
      return <TerminalScreen workspaceId={route.workspaceId} surfaceId={route.surfaceId} title={route.title} onBack={() => setRoute(route.back)} />;
    case "prompts":
      return <PromptsScreen onBack={() => setRoute({ name: "home" })} />;
    case "settings":
      return <SettingsScreen onBack={() => setRoute({ name: "home" })} />;
    default:
      return (
        <HomeScreen
          onOpenWorkspace={(workspace) => setRoute({ name: "workspace", workspace })}
          onOpenTerminal={(w, s, t) => openTerminal(w, s, t, { name: "home" })}
          onPrompts={() => setRoute({ name: "prompts" })}
          onSettings={() => setRoute({ name: "settings" })}
        />
      );
  }
}

export default function App() {
  return (
    <RelayProvider>
      <StatusBar style="light" />
      <Root />
    </RelayProvider>
  );
}
