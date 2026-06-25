'use strict';

// ================================================================
// Supabase 設定（index.html / admin.html 共通）
// ================================================================
const SUPABASE_URL      = 'https://wgxggqckupviquasiket.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndneGdncWNrdXB2aXF1YXNpa2V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDkwNTEsImV4cCI6MjA5NjgyNTA1MX0.6uL7c6hT1lhm1fHqejdAQBUgr4agvOW9Uou_5XJNbZY';
const DB_TABLE          = 'document_requests';

// ================================================================
// チェックボックスの選択肢ラベル（確認ページ・管理画面共通）
// ================================================================
const PERIOD_LABELS = {
  '2026_autumn': '健康博覧会2026・秋　9月30日（水）〜10月2日（金）',
  '2027_spring': '健康博覧会2027・春　3月17日（水）〜19日（金）',
  'undecided':   '未定',
};

const AREA_LABELS = {
  'food_supplement':       '健康食品＆サプリメントEXPO',
  'organic_natural':       'オーガニック＆ナチュラルEXPO',
  'beauty_wellness':       'ビューティー＆ウェルネスEXPO',
  'body_mind_recovery':    'ボディ＆マインドリカバリーEXPO',
  'health_beauty_factory': '健康＆美容ファクトリーEXPO',
  'age_tech_lab':          '【特別企画】AGE-TECH Lab. 2026（エイジテック・ラボ）',
  'undecided':             '未定',
};

// 対応状況（admin.html）
const STATUS_LABELS = {
  'lead':         'リード',
  'approach':     'アプローチ',
  'considering':  '検討中',
  'won':          '受注',
  'lost':         '失注',
  'unreachable':  '連絡つかず',
  'not_target':   '営業対象外',
};

const STATUS_ORDER = ['lead', 'approach', 'considering', 'won', 'lost', 'unreachable', 'not_target'];

// ダッシュボードのグラフで使う対応状況ごとの配色
const STATUS_COLORS = {
  'lead':         '#9aa0a6',
  'approach':     '#1565c0',
  'considering':  '#caa000',
  'won':          '#2e7d32',
  'lost':         '#c0392b',
  'unreachable':  '#e07b13',
  'not_target':   '#757575',
};

// ================================================================
// HTML生成ヘルパー（確認ページ・管理画面の詳細表示で共通利用）
// ================================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toHtml(value) {
  if (value === null || value === undefined || value === false || value === '') return '—';
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(v => escapeHtml(String(v))).join('<br>') : '—';
  }
  return escapeHtml(String(value));
}

function makeRow(label, value) {
  return `<div class="confirm-row"><dt>${escapeHtml(label)}</dt><dd>${toHtml(value)}</dd></div>`;
}

function makeBlock(rows) {
  return `<div class="confirm-block">
    <dl class="confirm-list">${rows.join('')}</dl>
  </div>`;
}

// 〒123-4567 形式の住所文字列を組み立てる
function formatAddress(record) {
  const postal = record.postal_code
    ? `〒${String(record.postal_code).slice(0, 3)}-${String(record.postal_code).slice(3)}`
    : '';
  return [postal, record.prefecture, record.address1, record.address2]
    .filter(Boolean).join('　');
}

// ISO日時文字列を "2026/06/16 18:00" 形式に整形（管理画面共通）
function formatDateTimeJa(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// document_requests の1レコードを makeBlock 用のHTMLに整形（確認ページ・詳細モーダル共通）
function buildRequestDetailHtml(data) {
  return [
    makeBlock([
      makeRow('貴社名',   data.company_name),
      makeRow('ご担当者', `${data.last_name} ${data.first_name}`),
      makeRow('ふりがな', `${data.last_name_kana} ${data.first_name_kana}`),
      makeRow('部署',     data.department),
      makeRow('役職',     data.job_title),
    ]),
    makeBlock([
      makeRow('メールアドレス', data.email),
      makeRow('連絡先電話番号', data.phone),
      makeRow('住所',           formatAddress(data) || null),
      makeRow('WEBサイト',      data.website || null),
    ]),
    makeBlock([
      makeRow('出展予定製品',
        data.exhibit_products),
      makeRow('出展を検討する会期',
        (data.exhibit_periods || []).map(v => PERIOD_LABELS[v] || v)),
      makeRow('出展を希望するエリア',
        (data.exhibit_areas || []).map(v => AREA_LABELS[v] || v)),
      makeRow('該当（創業5年以内）',
        data.startup_check ? '創業５年以内' : null),
    ]),
    makeBlock([
      makeRow('出会いたい業種',               data.target_industry || null),
      makeRow('本展以外の出展検討中の展示会',  data.other_shows     || null),
      makeRow('オンライン商談希望日時',        data.online_meeting  || null),
      makeRow('その他',                       data.other_notes     || null),
    ]),
    `<div class="memo-block">
      <div class="memo-label">営業メモ</div>
      <textarea id="detailMemoTextarea" class="memo-textarea" placeholder="メモを入力...">${escapeHtml(data.memo || '')}</textarea>
      <span class="memo-saved-msg" id="memoSavedMsg" aria-live="polite"></span>
    </div>`,
  ].join('');
}
