import * as SecureStore from "expo-secure-store";

export interface Pairing {
  baseUrl: string;
  deviceId: string;
  token: string;
}

const KEY = "brb.pairing.v1";

export async function loadPairing(): Promise<Pairing | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pairing>;
    if (parsed.baseUrl && parsed.deviceId && parsed.token) return parsed as Pairing;
  } catch {
    // Unreadable value: treat as not paired.
  }
  return null;
}

export async function savePairing(pairing: Pairing): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(pairing));
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
