import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  RelayClient,
  RelayHTTPError,
  getMe,
  getState,
  register,
  tokenIsValid,
  unpair as unpairRequest,
  type ConnectionStatus,
  type DeviceScope,
  type NotificationInfo,
  type RelayState,
} from "@brb/protocol";
import { toBaseUrl } from "./logic";
import { clearPairing, loadPairing, savePairing, type Pairing } from "./storage";

export interface Alert extends NotificationInfo {
  at: number;
}

interface RelayContextValue {
  ready: boolean;
  pairing: Pairing | null;
  client: RelayClient | null;
  status: ConnectionStatus;
  scope: DeviceScope;
  relayState: RelayState | null;
  alerts: Alert[];
  pendingCount: number;
  pair(address: string, code: string): Promise<void>;
  unpair(): Promise<void>;
  refreshPending(): Promise<void>;
  clearAlerts(): void;
}

const RelayContext = createContext<RelayContextValue | null>(null);

export function useRelay(): RelayContextValue {
  const value = useContext(RelayContext);
  if (!value) throw new Error("useRelay outside RelayProvider");
  return value;
}

/** Message for something that went wrong while pairing, in words a person can act on. */
export function pairingErrorMessage(error: unknown): string {
  if (error instanceof RelayHTTPError) {
    if (error.isLockedOut) {
      return `Too many wrong codes. Try again in ${error.retryAfterSeconds ?? 60} seconds.`;
    }
    if (error.isRefused) {
      return "The Mac refused this code. It may be wrong, expired or already used. Run `brb-relay pair` on the Mac for a new one.";
    }
    if (error.isTailscaleUnavailable) {
      return "The Mac can't see this phone on Tailscale. Open the Tailscale app on the phone and make sure it is connected.";
    }
    return `The Mac answered with an error (${error.status}).`;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function RelayProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [client, setClient] = useState<RelayClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("closed");
  const [scope, setScope] = useState<DeviceScope>("read");
  const [relayState, setRelayState] = useState<RelayState | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const failures = useRef(0);

  useEffect(() => {
    void loadPairing().then((saved) => {
      setPairing(saved);
      setReady(true);
    });
  }, []);

  // One live connection per pairing.
  useEffect(() => {
    if (!pairing) {
      setClient(null);
      setStatus("closed");
      return;
    }
    const next = new RelayClient({
      baseUrl: pairing.baseUrl,
      token: pairing.token,
      deviceId: pairing.deviceId,
    });
    setClient(next);
    failures.current = 0;
    const offStatus = next.onStatus((s) => {
      setStatus(s);
      if (s === "open") {
        failures.current = 0;
        void getMe(pairing.baseUrl, pairing.token).then((me) => setScope(me.scope)).catch(() => {});
        void getState(pairing.baseUrl, pairing.token).then(setRelayState).catch(() => {});
        void next.pendingPrompts(50).then((p) => setPendingCount(p.items.length)).catch(() => {});
      } else if (s === "closed") {
        failures.current += 1;
        // After a few failed reconnects, find out whether the Mac removed this phone.
        if (failures.current >= 3) {
          failures.current = 0;
          void tokenIsValid(pairing.baseUrl, pairing.token)
            .then((valid) => {
              if (!valid) void dropPairing();
            })
            .catch(() => {});
        }
      }
    });
    const offNote = next.onNotification((n) => {
      setAlerts((old) => [{ ...n, at: Date.now() }, ...old].slice(0, 30));
      void next.pendingPrompts(50).then((p) => setPendingCount(p.items.length)).catch(() => {});
    });
    next.connect().catch(() => {
      // Status listeners and reconnects deal with it; the UI shows "offline".
    });
    return () => {
      offStatus();
      offNote();
      next.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

  const dropPairing = useCallback(async () => {
    await clearPairing();
    setPairing(null);
    setAlerts([]);
    setPendingCount(0);
    setScope("read");
  }, []);

  const pair = useCallback(async (address: string, code: string) => {
    const baseUrl = toBaseUrl(address);
    if (!baseUrl) throw new Error("Enter the Mac's Tailscale address, like 100.101.102.103 or mac.tail1234.ts.net");
    if (!code.trim()) throw new Error("Enter the pairing code from the Mac.");
    const result = await register(baseUrl, code);
    const saved = { baseUrl, deviceId: result.deviceId, token: result.token };
    await savePairing(saved);
    setPairing(saved);
  }, []);

  const unpair = useCallback(async () => {
    if (pairing) {
      try {
        await unpairRequest(pairing.baseUrl, pairing.token);
      } catch {
        // The Mac may be unreachable; removing the phone locally still works.
      }
    }
    await dropPairing();
  }, [pairing, dropPairing]);

  const refreshPending = useCallback(async () => {
    if (!client) return;
    try {
      const list = await client.pendingPrompts(50);
      setPendingCount(list.items.length);
    } catch {
      // Keep the old number.
    }
  }, [client]);

  const value = useMemo<RelayContextValue>(
    () => ({
      ready, pairing, client, status, scope, relayState, alerts, pendingCount,
      pair, unpair, refreshPending, clearAlerts: () => setAlerts([]),
    }),
    [ready, pairing, client, status, scope, relayState, alerts, pendingCount, pair, unpair, refreshPending],
  );

  return <RelayContext.Provider value={value}>{children}</RelayContext.Provider>;
}
