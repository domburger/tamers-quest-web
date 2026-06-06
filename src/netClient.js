// Shared net client singleton for the browser. Scenes import { net } and use the
// same connection/session. Server URL: VITE_SERVER_URL in prod (the deployed
// Railway server), else net.js's default (ws://localhost:8080 in local dev).

import { createNetClient } from "./net.js";

const url = (import.meta.env && import.meta.env.VITE_SERVER_URL) || undefined;

export const net = createNetClient(url ? { url } : {});
