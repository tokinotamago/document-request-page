import "@supabase/functions-js/edge-runtime.d.ts";

const NOTIFY_TO   = "sanonoriaki@gmail.com"; // テスト用。本番はドメイン認証後に noriaki.sano@informa.com へ変更
const NOTIFY_FROM = "no-reply@resend.dev"; // 本番ドメイン取得後に変更

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
  "age_tech_lab":          "【特別企画】AGE-TECH Lab. 2026",
  "undecided":             "未定",
};

function esc(s: unknown): string {
  if (s === null || s === undefined || s === "") return "—";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function labelize(values: string[], map: Record<string, string>): string {
  if (!values || values.length === 0) return "—";
  return values.map(v => esc(map[v] ?? v)).join("、");
}

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

  const row = (label: string, value: unknown) =>
    `<tr><th style="text-align:left;padding:6px 12px;background:#f5f5f5;white-space:nowrap;border:1px solid #ddd">${esc(label)}</th>` +
    `<td style="padding:6px 12px;border:1px solid #ddd">${esc(value)}</td></tr>`;

  const rowHtml = (label: string, html: string) =>
    `<tr><th style="text-align:left;padding:6px 12px;background:#f5f5f5;white-space:nowrap;border:1px solid #ddd">${esc(label)}</th>` +
    `<td style="padding:6px 12px;border:1px solid #ddd">${html}</td></tr>`;

  return `
<p>資料請求フォームに新しい申込みがありました。</p>
<table style="border-collapse:collapse;font-size:14px;width:100%;max-width:640px">
  ${row("貴社名",             r.company_name)}
  ${row("担当者",             name)}
  ${row("ふりがな",           kana)}
  ${row("部署",               r.department)}
  ${row("役職",               r.job_title)}
  ${row("メールアドレス",     r.email)}
  ${row("電話番号",           r.phone)}
  ${row("住所",               address)}
  ${row("WEBサイト",          r.website)}
  ${row("出展予定製品",       r.exhibit_products)}
  ${rowHtml("出展検討会期",   periods)}
  ${rowHtml("希望エリア",     areas)}
  ${row("創業5年以内",        r.startup_check ? "該当" : "非該当")}
  ${row("出会いたい業種",     r.target_industry)}
  ${row("他展示会",           r.other_shows)}
  ${row("オンライン商談希望", r.online_meeting)}
  ${row("その他",             r.other_notes)}
  ${row("送信日時",           r.submitted_at)}
</table>
`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
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

  const subject = `【資料請求】${record.company_name ?? "（社名未入力）"} 様より申込みがありました`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    NOTIFY_FROM,
      to:      [NOTIFY_TO],
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
