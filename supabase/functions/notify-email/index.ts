import "@supabase/functions-js/edge-runtime.d.ts";

const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "no-reply@resend.dev";
// NOTIFY_TO は担当者にメールアドレスが設定されていない場合のフォールバック
const NOTIFY_TO   = Deno.env.get("NOTIFY_TO")   ?? "";

// タイミング攻撃を防ぐ定数時間文字列比較（XOR）
function safeEqual(a: string, b: string): boolean {
  const enc    = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

const PERIOD_LABELS: Record<string, string> = {
  "2026_autumn": "健康博覧会2026・秋　9月30日（水）〜10月2日（金）",
  "2027_spring": "健康博覧会2027・春　3月17日（水）〜19日（金）",
  "undecided":   "未定",
};

const AREA_LABELS: Record<string, string> = {
  "food_supplement":       "健康食品＆サプリメントEXPO",
  "organic_natural":       "オーガニック＆ナチュラルEXPO",
  "beauty_wellness":       "ビューティー＆ウェルネスEXPO",
  "body_mind_recovery":    "ボディ＆マインドリカバリーEXPO",
  "health_beauty_factory": "健康＆美容ファクトリーEXPO",
  "age_tech_lab":          "【特別企画】AGE-TECH Lab. 2026（エイジテック・ラボ）",
  "undecided":             "未定",
};

function esc(s: unknown): string {
  if (s === null || s === undefined || s === "") return "—";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function labelize(values: string[], map: Record<string, string>): string {
  if (!values || values.length === 0) return "—";
  return values.map(v => esc(map[v] ?? v)).join("、");
}

// 確認画面と同じ項目・ラベルでメール本文を生成する
function buildHtml(r: Record<string, unknown>): string {
  const name    = `${r.last_name ?? ""} ${r.first_name ?? ""}`.trim();
  const kana    = `${r.last_name_kana ?? ""} ${r.first_name_kana ?? ""}`.trim();
  const address = [
    r.postal_code ? `〒${String(r.postal_code).replace(/(\d{3})(\d{4})/, "$1-$2")}` : "",
    r.prefecture,
    r.address1,
    r.address2,
  ].filter(Boolean).join("　");

  const periods = labelize(r.exhibit_periods as string[], PERIOD_LABELS);
  const areas   = labelize(r.exhibit_areas   as string[], AREA_LABELS);

  const th = `style="text-align:left;padding:6px 12px;background:#f5f5f5;white-space:nowrap;border:1px solid #ddd;font-weight:normal;"`;
  const td = `style="padding:6px 12px;border:1px solid #ddd"`;
  const sep = `<tr><td colspan="2" style="padding:0;border:none;height:12px"></td></tr>`;

  const row = (label: string, value: unknown) =>
    `<tr><th ${th}>${esc(label)}</th><td ${td}>${esc(value)}</td></tr>`;

  const rowHtml = (label: string, html: string) =>
    `<tr><th ${th}>${esc(label)}</th><td ${td}>${html}</td></tr>`;

  return `
<p style="margin:0 0 16px">資料請求フォームに新しい申込みがありました。</p>
<table style="border-collapse:collapse;font-size:14px;width:100%;max-width:640px">
  ${row("貴社名",   r.company_name)}
  ${row("ご担当者", name)}
  ${row("ふりがな", kana)}
  ${row("部署",     r.department)}
  ${row("役職",     r.job_title)}
  ${sep}
  ${row("メールアドレス",   r.email)}
  ${row("連絡先電話番号",   r.phone)}
  ${row("住所",             address || null)}
  ${row("WEBサイト",        r.website)}
  ${sep}
  ${row("出展予定製品",           r.exhibit_products)}
  ${rowHtml("出展を検討する会期", periods)}
  ${rowHtml("出展を希望するエリア", areas)}
  ${row("該当（創業5年以内）", r.startup_check ? "創業５年以内" : null)}
  ${sep}
  ${row("出会いたい業種",               r.target_industry)}
  ${row("本展以外の出展検討中の展示会", r.other_shows)}
  ${row("オンライン商談希望日時",       r.online_meeting)}
  ${row("その他",                       r.other_notes)}
</table>
<p style="margin:16px 0 0;font-size:12px;color:#888">送信日時: ${esc(r.submitted_at)}</p>
`;
}

// sales_reps テーブルから通知先メールアドレスを取得する
async function getSalesRepEmails(): Promise<string[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return [];

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/sales_reps?select=email&email=not.is.null`,
      {
        headers: {
          "apikey":        serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
        },
      }
    );
    if (!res.ok) return [];
    const reps: { email: string }[] = await res.json();
    return [...new Set(reps.map(r => r.email).filter(Boolean))];
  } catch (e) {
    console.warn("[notify-email] 担当者メールアドレス取得に失敗しました:", e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("WEBHOOK_SECRET is not set");
    return new Response("Server misconfiguration", { status: 500 });
  }
  const incoming = req.headers.get("x-webhook-secret") ?? "";
  if (!safeEqual(incoming, webhookSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const record  = payload?.record as Record<string, unknown> | undefined;

  if (!record) {
    return new Response("No record in payload", { status: 400 });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set");
    return new Response("Server misconfiguration", { status: 500 });
  }

  // 担当者テーブルからメールアドレスを取得し、なければ NOTIFY_TO にフォールバック
  const toAddresses = await getSalesRepEmails();
  if (toAddresses.length === 0 && NOTIFY_TO) toAddresses.push(NOTIFY_TO);
  if (toAddresses.length === 0) {
    console.warn("[notify-email] 送信先アドレスが設定されていません");
    return new Response("No recipients configured", { status: 200 });
  }

  const subject = `【資料請求】${record.company_name ?? "（社名未入力）"} 様より申込みがありました`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    NOTIFY_FROM,
      to:      toAddresses,
      subject,
      html:    buildHtml(record),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    return new Response(`Failed to send email: ${err}`, { status: 502 });
  }

  return new Response("OK", { status: 200 });
});
