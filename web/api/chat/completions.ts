// Egress proxy at the exact path the adapter hits: with FUGU_API_URL set to
// https://<this-app>/api on the TEE, the adapter's `${FUGU_API_URL}/chat/completions`
// lands here. We re-originate the call from Vercel's IP to OpenRouter — if Sakana
// blocks the enclave's datacenter IP but not Vercel's, real fugu-ultra works.
//
// Authorization is forwarded from the caller (the TEE's sealed OPENROUTER_API_KEY);
// OPENROUTER_API_KEY in Vercel env is an optional fallback for direct testing.
export const config = { maxDuration: 60 };

const TARGET = "https://openrouter.ai/api/v1/chat/completions";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const auth =
    req.headers["authorization"] ||
    (process.env.OPENROUTER_API_KEY ? `Bearer ${process.env.OPENROUTER_API_KEY}` : "");
  try {
    const r = await fetch(TARGET, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: auth,
        "HTTP-Referer": "https://github.com/zeeshan8281/waybill",
        "X-Title": "Waybill",
      },
      body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader("content-type", r.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (e: any) {
    res.status(502).json({ error: "egress proxy failed", detail: String(e?.message ?? e) });
  }
}
