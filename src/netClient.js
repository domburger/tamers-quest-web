import { createNetClient } from "./net.js";

const url = (import.meta.env && import.meta.env.VITE_SERVER_URL) || undefined;

export const net = createNetClient(url ? { url } : {});

// DEV-only: tools/ QA harnesses read globalThis.__net.
if (import.meta.env && import.meta.env.DEV) {
  try { globalThis.__net = net; } catch {}
}
