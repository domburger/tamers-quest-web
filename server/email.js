const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function emailConfigured() {
  return !!process.env.EMAIL_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmail({ to, subject, html, text }, fetchImpl = fetch) {
  if (!emailConfigured()) {
    console.log(`[email] not configured (EMAIL_API_KEY/EMAIL_FROM) — skipping send to ${to}: "${subject}"`);
    return { ok: false, skipped: true };
  }
  try {
    const r = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, ...(text ? { text } : {}) }),
    });
    if (!r || !r.ok) {
      const t = r && r.text ? await r.text().catch(() => "") : "";
      console.error(`[email] send failed ${r && r.status}: ${String(t).slice(0, 200)}`);
      return { ok: false, status: r && r.status };
    }
    return { ok: true };
  } catch (e) {
    console.error("[email] send error:", e && e.message);
    return { ok: false, error: String((e && e.message) || e) };
  }
}
