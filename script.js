'use strict';

// ================================================================
// Supabase 設定
// ================================================================
const SUPABASE_URL      = 'https://wgxggqckupviquasiket.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndneGdncWNrdXB2aXF1YXNpa2V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDkwNTEsImV4cCI6MjA5NjgyNTA1MX0.6uL7c6hT1lhm1fHqejdAQBUgr4agvOW9Uou_5XJNbZY';
const DB_TABLE          = 'document_requests';

// ================================================================
// チェックボックスの選択肢ラベル（確認ページ表示用）
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

// ================================================================
// DOM references
// ================================================================
const formWrapper      = document.getElementById('formWrapper');
const form             = document.getElementById('documentRequestForm');
const submitBtn        = document.getElementById('submitBtn');
const submittedAtEl    = document.getElementById('submittedAt');
const confirmationPage = document.getElementById('confirmationPage');
const backToFormBtn    = document.getElementById('backToFormBtn');
const finalSubmitBtn   = document.getElementById('finalSubmitBtn');
const successMessage   = document.getElementById('successMessage');
const errorMessage     = document.getElementById('errorMessage');

// ================================================================
// State
// ================================================================
let pendingData          = null;
let autoFilledPrefecture = '';
let autoFilledAddress1   = '';
let postalAbortController = null;

// ================================================================
// Helpers
// ================================================================
function getValue(id) {
  return (document.getElementById(id)?.value ?? '').trim();
}

function setError(rule) {
  const msg = typeof rule.message === 'function' ? rule.message() : rule.message;
  const el  = document.getElementById(rule.errorId);
  if (el) el.textContent = msg;
  if (rule.inputId) document.getElementById(rule.inputId)?.classList.add('is-error');
}

function clearError(rule) {
  const el = document.getElementById(rule.errorId);
  if (el) el.textContent = '';
  if (rule.inputId) document.getElementById(rule.inputId)?.classList.remove('is-error');
}

function clearAllErrors() {
  RULES.forEach(r => clearError(r));
}

// ================================================================
// Validation rules
// ================================================================
const RULES = [
  {
    inputId:  'companyName',
    errorId:  'error-companyName',
    scrollId: 'group-companyName',
    validate: () => getValue('companyName').length > 0,
    message:  '貴社名を入力してください。',
  },
  {
    inputId:  'lastName',
    errorId:  'error-lastName',
    scrollId: 'group-name',
    validate: () => getValue('lastName').length > 0,
    message:  '姓を入力してください。',
  },
  {
    inputId:  'firstName',
    errorId:  'error-firstName',
    scrollId: 'group-name',
    validate: () => getValue('firstName').length > 0,
    message:  '名を入力してください。',
  },
  {
    inputId:  'lastNameKana',
    errorId:  'error-lastNameKana',
    scrollId: 'group-nameKana',
    validate: () => getValue('lastNameKana').length > 0,
    message:  'せいを入力してください。',
  },
  {
    inputId:  'firstNameKana',
    errorId:  'error-firstNameKana',
    scrollId: 'group-nameKana',
    validate: () => getValue('firstNameKana').length > 0,
    message:  'めいを入力してください。',
  },
  {
    inputId:  'department',
    errorId:  'error-department',
    scrollId: 'group-department',
    validate: () => getValue('department').length > 0,
    message:  '部署を入力してください。',
  },
  {
    inputId:  'jobTitle',
    errorId:  'error-jobTitle',
    scrollId: 'group-jobTitle',
    validate: () => getValue('jobTitle').length > 0,
    message:  '役職を入力してください。',
  },
  {
    inputId:  'email',
    errorId:  'error-email',
    scrollId: 'group-email',
    validate: () => {
      const val = getValue('email');
      return val.length > 0 && !document.getElementById('email')?.validity.typeMismatch;
    },
    message: () =>
      getValue('email').length === 0
        ? 'メールアドレスを入力してください。'
        : '有効なメールアドレスを入力してください。',
  },
  {
    inputId:  'emailConfirm',
    errorId:  'error-emailConfirm',
    scrollId: 'group-emailConfirm',
    validate: () => {
      const val = getValue('emailConfirm');
      return val.length > 0 && val === getValue('email');
    },
    message: () =>
      getValue('emailConfirm').length === 0
        ? 'メールアドレス（確認用）を入力してください。'
        : 'メールアドレスが一致しません。',
  },
  {
    inputId:  'phone',
    errorId:  'error-phone',
    scrollId: 'group-phone',
    validate: () => getValue('phone').length > 0,
    message:  '連絡先電話番号を入力してください。',
  },
  // 郵便番号 + 都道府県（自動入力が完了しているかを含めてチェック）
  {
    inputId:  'postalCode',
    errorId:  'error-postalCode',
    scrollId: 'group-address',
    validate: () => {
      const digits = getValue('postalCode').replace(/\D/g, '');
      return digits.length === 7 && getValue('prefecture').length > 0;
    },
    message: () => {
      const digits = getValue('postalCode').replace(/\D/g, '');
      if (digits.length === 0)  return '郵便番号を入力してください。';
      if (digits.length !== 7)  return '郵便番号は7桁で入力してください。';
      return '有効な郵便番号を入力してください（都道府県が自動入力されます）。';
    },
  },
  {
    inputId:  'address1',
    errorId:  'error-address1',
    scrollId: 'group-address',
    validate: () => getValue('address1').length > 0,
    message:  '市区町村・番地を入力してください。',
  },
  {
    inputId:  'exhibitProducts',
    errorId:  'error-exhibitProducts',
    scrollId: 'group-exhibitProducts',
    validate: () => getValue('exhibitProducts').length > 0,
    message:  '出展予定製品を入力してください。',
  },
  {
    inputId:  null,
    errorId:  'error-exhibitPeriods',
    scrollId: 'group-exhibitPeriods',
    validate: () =>
      document.querySelectorAll('input[name="exhibit_periods"]:checked').length > 0,
    message:  '出展を検討する会期を1つ以上選択してください。',
  },
  {
    inputId:  null,
    errorId:  'error-exhibitAreas',
    scrollId: 'group-exhibitAreas',
    validate: () =>
      document.querySelectorAll('input[name="exhibit_areas"]:checked').length > 0,
    message:  '出展を希望するエリアを1つ以上選択してください。',
  },
];

// ================================================================
// Validation
// ================================================================
function validateForm() {
  let firstFailScrollId = null;

  RULES.forEach(rule => {
    if (rule.validate()) {
      clearError(rule);
    } else {
      setError(rule);
      if (!firstFailScrollId) firstFailScrollId = rule.scrollId;
    }
  });

  if (firstFailScrollId) {
    document.getElementById(firstFailScrollId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    return false;
  }

  return true;
}

// ================================================================
// Data collection
// ================================================================
function collectFormData() {
  const rawPostal = getValue('postalCode').replace(/\D/g, '');
  return {
    company_name:     getValue('companyName'),
    last_name:        getValue('lastName'),
    first_name:       getValue('firstName'),
    last_name_kana:   getValue('lastNameKana'),
    first_name_kana:  getValue('firstNameKana'),
    department:       getValue('department'),
    job_title:        getValue('jobTitle'),
    email:            getValue('email'),
    phone:            getValue('phone'),
    postal_code:      rawPostal,
    prefecture:       getValue('prefecture'),
    address1:         getValue('address1'),
    address2:         getValue('address2'),
    website:          getValue('website'),
    exhibit_products: getValue('exhibitProducts'),
    exhibit_periods:  Array.from(
      document.querySelectorAll('input[name="exhibit_periods"]:checked'),
      el => el.value
    ),
    exhibit_areas: Array.from(
      document.querySelectorAll('input[name="exhibit_areas"]:checked'),
      el => el.value
    ),
    startup_check:   document.getElementById('startupCheck')?.checked ?? false,
    target_industry: getValue('targetIndustry'),
    other_shows:     getValue('otherShows'),
    online_meeting:  getValue('onlineMeeting'),
    other_notes:     getValue('otherNotes'),
    source:          document.getElementById('formSource')?.value ?? 'exhibition_2025',
    submitted_at:    '',
  };
}

// ================================================================
// Confirmation page — 動的生成
// ================================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function makeBlock(title, rows) {
  return `<div class="confirm-block">
    <dl class="confirm-list">${rows.join('')}</dl>
  </div>`;
}

function populateConfirmation(data) {
  const postal = data.postal_code
    ? `〒${data.postal_code.slice(0, 3)}-${data.postal_code.slice(3)}`
    : '';
  const address = [postal, data.prefecture, data.address1, data.address2]
    .filter(Boolean).join('　');

  const html = [
    makeBlock('貴社・ご担当者情報', [
      makeRow('貴社名',   data.company_name),
      makeRow('ご担当者', `${data.last_name} ${data.first_name}`),
      makeRow('ふりがな', `${data.last_name_kana} ${data.first_name_kana}`),
      makeRow('部署',     data.department),
      makeRow('役職',     data.job_title),
    ]),
    makeBlock('連絡先情報', [
      makeRow('メールアドレス',   data.email),
      makeRow('連絡先電話番号',   data.phone),
      makeRow('住所',             address || null),
      makeRow('WEBサイト',        data.website || null),
    ]),
    makeBlock('出展について', [
      makeRow('出展予定製品',
        data.exhibit_products),
      makeRow('出展を検討する会期',
        data.exhibit_periods.map(v => PERIOD_LABELS[v] || v)),
      makeRow('出展を希望するエリア',
        data.exhibit_areas.map(v => AREA_LABELS[v] || v)),
      makeRow('該当（創業5年以内）',
        data.startup_check ? '創業５年以内' : null),
    ]),
    makeBlock('その他', [
      makeRow('出会いたい業種',               data.target_industry || null),
      makeRow('本展以外の出展検討中の展示会',  data.other_shows     || null),
      makeRow('オンライン商談希望日時',        data.online_meeting  || null),
      makeRow('その他',                       data.other_notes     || null),
    ]),
  ].join('');

  document.getElementById('confirmationContent').innerHTML = html;
}

// ================================================================
// Postal code auto-fill  (zipcloud API)
// ================================================================
async function lookupPostalCode(digits) {
  // 前のリクエストをキャンセルして競合を防ぐ
  if (postalAbortController) postalAbortController.abort();
  postalAbortController = new AbortController();

  const prefEl  = document.getElementById('prefecture');
  const addr1El = document.getElementById('address1');

  try {
    const res  = await fetch(
      `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits}`,
      { signal: postalAbortController.signal }
    );
    const data = await res.json();

    if (data.status === 200 && data.results?.length > 0) {
      const r = data.results[0];

      // 都道府県は常に上書き
      autoFilledPrefecture = r.address1;
      prefEl.value = r.address1;

      // 空 or 以前に自動入力した値のときのみ更新（手動入力は保持）
      if (!addr1El.value.trim() || addr1El.value === autoFilledAddress1) {
        autoFilledAddress1 = r.address2 + r.address3;
        addr1El.value      = autoFilledAddress1;
      }

      // エラーが出ていれば即時解除
      const postalRule = RULES.find(r => r.inputId === 'postalCode');
      const addr1Rule  = RULES.find(r => r.inputId === 'address1');
      if (postalRule?.validate()) clearError(postalRule);
      if (addr1Rule?.validate())  clearError(addr1Rule);
    } else {
      const errEl = document.getElementById('error-postalCode');
      if (errEl) errEl.textContent = '郵便番号が見つかりませんでした。正しい郵便番号を入力してください。';
      document.getElementById('postalCode')?.classList.add('is-error');
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.warn('[postal] 郵便番号APIに接続できませんでした。');
  }
}

// ================================================================
// Submission
async function submitToServer(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${DB_TABLE}`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
}

// ================================================================
// UI state helpers
// ================================================================
function setFinalSubmitting(loading) {
  finalSubmitBtn.disabled = loading;
  finalSubmitBtn.querySelector('.btn-submit__text').textContent =
    loading ? '送信中...' : '資料を請求する';
}

function showResult(type) {
  formWrapper.hidden      = true;
  confirmationPage.hidden = true;
  successMessage.hidden   = type !== 'success';
  errorMessage.hidden     = type !== 'error';
  const target = type === 'success' ? successMessage : errorMessage;
  requestAnimationFrame(() =>
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  );
}

// ================================================================
// Real-time validation
// ================================================================
function bindRealtimeValidation() {
  // テキスト系
  [
    'companyName', 'lastName', 'firstName', 'lastNameKana', 'firstNameKana',
    'department', 'jobTitle', 'email', 'emailConfirm', 'phone',
    'exhibitProducts', 'address1',
  ].forEach(id => {
    const rule = RULES.find(r => r.inputId === id);
    document.getElementById(id)?.addEventListener('input', () => {
      if (rule?.validate()) clearError(rule);
    });
  });

  // email 変更 → emailConfirm の既存エラーも再チェック
  document.getElementById('email')?.addEventListener('input', () => {
    const confirmRule = RULES.find(r => r.inputId === 'emailConfirm');
    const errEl = document.getElementById('error-emailConfirm');
    if (errEl?.textContent && confirmRule?.validate()) clearError(confirmRule);
  });

  // 郵便番号: 7桁揃ったら自動検索 / 空になったら自動入力をクリア
  function handlePostalInput(e) {
    const raw     = e.target.value;
    const digits  = raw.replace(/\D/g, '');
    const prefEl  = document.getElementById('prefecture');
    const addr1El = document.getElementById('address1');

    if (digits.length === 0) {
      // 郵便番号が空になったら、自動入力した値だけをクリア
      if (prefEl.value  === autoFilledPrefecture) prefEl.value  = '';
      if (addr1El.value === autoFilledAddress1)   addr1El.value = '';
      autoFilledPrefecture = '';
      autoFilledAddress1   = '';
    } else if (digits.length === 7) {
      lookupPostalCode(digits);
    }

    // postalCode 自体のリアルタイムエラー解除
    const postalRule = RULES.find(r => r.inputId === 'postalCode');
    if (postalRule?.validate()) clearError(postalRule);
  }

  const postalEl = document.getElementById('postalCode');
  postalEl?.addEventListener('input',  handlePostalInput);
  postalEl?.addEventListener('change', handlePostalInput); // ペースト・ブラウザ自動入力にも対応

  // address1 を手動編集したら autoFilled フラグをリセット
  document.getElementById('address1')?.addEventListener('input', () => {
    const addr1El = document.getElementById('address1');
    if (addr1El.value !== autoFilledAddress1) autoFilledAddress1 = '';
  });

  // 出展会期
  const periodsRule = RULES.find(r => r.errorId === 'error-exhibitPeriods');
  document.querySelectorAll('input[name="exhibit_periods"]').forEach(el =>
    el.addEventListener('change', () => {
      if (periodsRule?.validate()) clearError(periodsRule);
    })
  );

  // 出展エリア
  const areasRule = RULES.find(r => r.errorId === 'error-exhibitAreas');
  document.querySelectorAll('input[name="exhibit_areas"]').forEach(el =>
    el.addEventListener('change', () => {
      if (areasRule?.validate()) clearError(areasRule);
    })
  );
}

// ================================================================
// Form submit → 確認ページへ
// ================================================================
async function handleSubmit(e) {
  e.preventDefault();
  clearAllErrors();

  if (!validateForm()) return;

  pendingData = collectFormData();
  populateConfirmation(pendingData);

  formWrapper.hidden      = true;
  confirmationPage.hidden = false;
  confirmationPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ================================================================
// Confirmation: 「入力に戻る」
// ================================================================
function handleBackToForm() {
  confirmationPage.hidden = true;
  formWrapper.hidden      = false;
  formWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ================================================================
// Confirmation: 「資料を請求する」（最終送信）
// ================================================================
async function handleFinalSubmit() {
  pendingData.submitted_at = new Date().toISOString();
  submittedAtEl.value = pendingData.submitted_at;

  setFinalSubmitting(true);
  try {
    await submitToServer(pendingData);
    showResult('success');
  } catch (err) {
    console.error('[document-request] 送信エラー:', err);
    showResult('error');
  } finally {
    setFinalSubmitting(false);
  }
}

// ================================================================
// Init
// ================================================================
if (form) {
  form.addEventListener('submit', handleSubmit);
  backToFormBtn?.addEventListener('click', handleBackToForm);
  finalSubmitBtn?.addEventListener('click', handleFinalSubmit);
  bindRealtimeValidation();
}
