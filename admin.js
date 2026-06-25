'use strict';

// Supabase設定・ラベル定義・HTML整形ヘルパーは shared.js を参照（admin.htmlで先読み込み）

// ================================================================
// Supabaseクライアント（認証つき。SELECT/UPDATE/DELETEはRLSでauthenticatedロールのみ許可）
// ================================================================
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================================================================
// DOM references
// ================================================================
const loginScreen    = document.getElementById('loginScreen');
const loginForm      = document.getElementById('loginForm');
const loginEmailEl   = document.getElementById('loginEmail');
const loginPasswordEl = document.getElementById('loginPassword');
const loginErrorEl   = document.getElementById('loginError');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');

const adminApp      = document.getElementById('adminApp');
const loggedInEmail = document.getElementById('loggedInEmail');
const logoutBtn     = document.getElementById('logoutBtn');

const statusFromDateEl       = document.getElementById('statusFromDate');
const statusToDateEl         = document.getElementById('statusToDate');
const applyStatusFilterBtn   = document.getElementById('applyStatusFilter');
const resetStatusFilterBtn   = document.getElementById('resetStatusFilter');

const statusFilters = { fromDate: '', toDate: '' };
let cachedDashboardRecords = [];

const tabButtons = document.querySelectorAll('.admin-tab');
const panels     = document.querySelectorAll('.admin-panel');

// ================================================================
// 認証状態に応じた画面切り替え
// ================================================================
async function showLoggedIn(session) {
  loginScreen.hidden = true;
  adminApp.hidden    = false;
  loggedInEmail.textContent = session?.user?.email ?? '';
  await loadSalesReps();
  populateListFilterControls();
  populateCsvSalesRepOptions();
  renderSalesRepSettingsList();
  fetchAndRenderDashboard();
}

function showLoggedOut() {
  adminApp.hidden    = true;
  loginScreen.hidden = false;
  loginForm.reset();
}

function setLoginSubmitting(loading) {
  loginSubmitBtn.disabled = loading;
  loginSubmitBtn.querySelector('.btn-submit__text').textContent =
    loading ? 'ログイン中...' : 'ログイン';
}

// ================================================================
// ログイン
// ================================================================
async function handleLoginSubmit(e) {
  e.preventDefault();
  loginErrorEl.textContent = '';

  const email    = loginEmailEl.value.trim();
  const password = loginPasswordEl.value;

  if (!email || !password) {
    loginErrorEl.textContent = 'メールアドレスとパスワードを入力してください。';
    return;
  }

  setLoginSubmitting(true);
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      loginErrorEl.textContent = 'メールアドレスまたはパスワードが正しくありません。';
      console.error('[admin] ログインエラー:', error.message);
    }
    // 成功時の画面切り替えは onAuthStateChange で行う
  } catch (err) {
    loginErrorEl.textContent = 'ログインに失敗しました。しばらく時間をおいて再度お試しください。';
    console.error('[admin] ログイン例外:', err);
  } finally {
    setLoginSubmitting(false);
  }
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  // 画面切り替えは onAuthStateChange で行う
}

// ================================================================
// タブ切り替え
// ================================================================
function activateTab(tabName) {
  tabButtons.forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  panels.forEach(panel => {
    panel.hidden = panel.id !== `panel-${tabName}`;
  });
}

function bindTabs() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab);
      if (btn.dataset.tab === 'list')      fetchAndRenderList();
      if (btn.dataset.tab === 'dashboard') fetchAndRenderDashboard();
      if (btn.dataset.tab === 'settings')  renderSalesRepSettingsList();
    });
  });
}

// ================================================================
// 営業担当者（Supabaseから動的ロード）
// ================================================================
const SALES_REPS_TABLE = 'sales_reps';
let salesRepsData = []; // { id, name } の配列

async function loadSalesReps() {
  try {
    const { data, error } = await supabaseClient
      .from(SALES_REPS_TABLE)
      .select('id, name')
      .order('created_at', { ascending: true });
    if (error) throw error;
    salesRepsData = data || [];
  } catch (err) {
    console.error('[admin] 営業担当取得エラー:', err);
    salesRepsData = [];
  }
}

// ================================================================
// 一覧表示・検索・ソート・ページネーション
// ================================================================
const PAGE_SIZE = 20;

const listState = {
  page:           0,
  sortColumn:     'submitted_at',
  sortAsc:        false,
  searchQuery:    '',
  salesRepFilter: '',
  statusFilter:   '',
};

const searchInput          = document.getElementById('searchInput');
const clearSearchBtn       = document.getElementById('clearSearchBtn');
const listCountEl          = document.getElementById('listCount');
const requestsTableBody    = document.getElementById('requestsTableBody');
const listEmptyEl          = document.getElementById('listEmpty');
const listErrorEl          = document.getElementById('listError');
const prevPageBtn          = document.getElementById('prevPageBtn');
const nextPageBtn          = document.getElementById('nextPageBtn');
const pageInfoEl           = document.getElementById('pageInfo');
const sortableHeaders      = document.querySelectorAll('#requestsTable th[data-sort]');
const salesRepFilterSelect = document.getElementById('salesRepFilterSelect');
const statusFilterSelect   = document.getElementById('statusFilterSelect');
const resetListFilterBtn   = document.getElementById('resetListFilterBtn');
const toastEl              = document.getElementById('toast');

function populateListFilterControls() {
  if (salesRepFilterSelect) {
    while (salesRepFilterSelect.options.length > 1) salesRepFilterSelect.remove(1);
    salesRepsData.forEach(rep => {
      const opt = document.createElement('option');
      opt.value = rep.name;
      opt.textContent = rep.name;
      salesRepFilterSelect.appendChild(opt);
    });
  }
  if (statusFilterSelect) {
    while (statusFilterSelect.options.length > 1) statusFilterSelect.remove(1);
    STATUS_ORDER.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = STATUS_LABELS[key];
      statusFilterSelect.appendChild(opt);
    });
  }
}

// PostgREST の .or() に直接埋め込む文字列から、フィルター文法上の特殊文字を除去する
function applySearchFilter(query, rawQ) {
  const q = rawQ.trim();
  if (!q) return query;
  const escaped = q.replace(/[%,.()*[\]]/g, '').slice(0, 100);
  if (!escaped) return query;
  return query.or(
    `company_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,email.ilike.%${escaped}%`
  );
}

function buildListQuery() {
  let query = supabaseClient
    .from(DB_TABLE)
    .select('*', { count: 'exact' });

  query = applySearchFilter(query, listState.searchQuery);

  if (listState.salesRepFilter) {
    query = query.eq('sales_rep', listState.salesRepFilter);
  }
  if (listState.statusFilter) {
    query = query.eq('status', listState.statusFilter);
  }

  const from = listState.page * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  return query
    .order(listState.sortColumn, { ascending: listState.sortAsc, nullsFirst: false })
    .range(from, to);
}

function renderSalesRepSelect(id, currentRep) {
  const options = [
    `<option value=""></option>`,
    ...salesRepsData.map(rep =>
      `<option value="${escapeHtml(rep.name)}"${currentRep === rep.name ? ' selected' : ''}>${escapeHtml(rep.name)}</option>`
    ),
  ].join('');
  return `<select class="table-select table-select--sales" data-id="${escapeHtml(id)}" aria-label="営業担当">${options}</select>`;
}

function renderTableStatusSelect(id, status) {
  const options = STATUS_ORDER.map(key =>
    `<option value="${key}"${status === key ? ' selected' : ''}>${escapeHtml(STATUS_LABELS[key])}</option>`
  ).join('');
  return `<select class="status-select table-select table-select--status" data-status="${escapeHtml(status)}" data-id="${escapeHtml(id)}" aria-label="対応状況">${options}</select>`;
}

function renderListRows(records) {
  requestsTableBody.innerHTML = records.map(r => `
    <tr data-id="${escapeHtml(r.id)}">
      <td class="col-select">${renderSalesRepSelect(r.id, r.sales_rep)}</td>
      <td class="col-select">${renderTableStatusSelect(r.id, r.status)}</td>
      <td>${escapeHtml(formatDateTimeJa(r.submitted_at))}</td>
      <td>${escapeHtml(r.company_name)}</td>
      <td class="col-circle">${r.online_meeting ? '○' : ''}</td>
      <td class="col-circle">${r.startup_check ? '○' : ''}</td>
    </tr>
  `).join('');
}

function updatePaginationUI(total) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  pageInfoEl.textContent = `${listState.page + 1} / ${totalPages} ページ`;
  prevPageBtn.disabled = listState.page <= 0;
  nextPageBtn.disabled = listState.page >= totalPages - 1;
  listCountEl.textContent = `全${total}件`;
}

// ================================================================
// トースト通知
// ================================================================
let toastTimeoutId = null;

function showToast(message, type = 'success') {
  if (!toastEl) return;
  clearTimeout(toastTimeoutId);
  toastEl.textContent = message;
  toastEl.className = 'toast';
  toastEl.classList.add(`toast--${type}`, 'is-visible');
  toastTimeoutId = setTimeout(() => toastEl.classList.remove('is-visible'), 3000);
}

// ================================================================
// スケルトンローダー
// ================================================================
const SKELETON_ROW_HTML = Array(6).fill(
  `<tr class="skeleton-row">
      <td><span class="skeleton-cell skeleton-cell--short"></span></td>
      <td><span class="skeleton-cell skeleton-cell--short"></span></td>
      <td><span class="skeleton-cell"></span></td>
      <td><span class="skeleton-cell"></span></td>
      <td><span class="skeleton-cell skeleton-cell--icon"></span></td>
      <td><span class="skeleton-cell skeleton-cell--icon"></span></td>
    </tr>`
).join('');

function renderSkeletonRows() {
  requestsTableBody.innerHTML = SKELETON_ROW_HTML;
}

async function fetchAndRenderList() {
  listErrorEl.hidden = true;
  listEmptyEl.hidden = true;
  renderSkeletonRows();

  try {
    const { data, error, count } = await buildListQuery();
    if (error) throw error;

    renderListRows(data || []);
    listEmptyEl.hidden = (data || []).length !== 0;
    updatePaginationUI(count || 0);
  } catch (err) {
    console.error('[admin] 一覧取得エラー:', err);
    requestsTableBody.innerHTML = '';
    listErrorEl.textContent = '一覧の取得に失敗しました。しばらく時間をおいて再度お試しください。';
    listErrorEl.hidden = false;
  }
}

// ================================================================
// CSVエクスポート（現在の検索条件に一致する全件を対象、ページングは無視）
// ================================================================
const exportCsvBtn = document.getElementById('exportCsvBtn');

const CSV_COLUMNS = [
  ['company_name',     '貴社名'],
  ['last_name',        '姓'],
  ['first_name',       '名'],
  ['last_name_kana',   'せい'],
  ['first_name_kana',  'めい'],
  ['department',       '部署'],
  ['job_title',        '役職'],
  ['email',             'メールアドレス'],
  ['phone',             '電話番号'],
  ['postal_code',       '郵便番号'],
  ['prefecture',        '都道府県'],
  ['address1',          '市区町村・番地'],
  ['address2',          'ビル名ほか'],
  ['website',           'WEBサイト'],
  ['exhibit_products',  '出展予定製品'],
  ['exhibit_periods',   '出展を検討する会期'],
  ['exhibit_areas',     '出展を希望するエリア'],
  ['startup_check',     '創業5年以内'],
  ['target_industry',   '出会いたい業種'],
  ['other_shows',       '本展以外の出展検討中の展示会'],
  ['online_meeting',    'オンライン商談希望日時'],
  ['other_notes',       'その他'],
  ['status',            '対応状況'],
  ['submitted_at',      '送信日時'],
];

function csvField(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function formatCsvValue(column, record) {
  const value = record[column];
  if (column === 'exhibit_periods') return (value || []).map(v => PERIOD_LABELS[v] || v).join('、');
  if (column === 'exhibit_areas')   return (value || []).map(v => AREA_LABELS[v] || v).join('、');
  if (column === 'status')          return STATUS_LABELS[value] || value;
  if (column === 'startup_check')   return value ? '創業５年以内' : '';
  if (column === 'submitted_at')    return formatDateTimeJa(value);
  return value ?? '';
}

function recordsToCsv(records) {
  const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const rows = records.map(r =>
    CSV_COLUMNS.map(([col]) => csvField(formatCsvValue(col, r))).join(',')
  );
  return [header, ...rows].join('\r\n');
}

function bindListControls() {
  let searchDebounceId = null;
  searchInput?.addEventListener('input', () => {
    if (clearSearchBtn) clearSearchBtn.hidden = !searchInput.value;
    clearTimeout(searchDebounceId);
    searchDebounceId = setTimeout(() => {
      listState.searchQuery = searchInput.value;
      listState.page = 0;
      fetchAndRenderList();
    }, 300);
  });
  clearSearchBtn?.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.hidden = true;
    listState.searchQuery = '';
    listState.page = 0;
    fetchAndRenderList();
    searchInput.focus();
  });

  salesRepFilterSelect?.addEventListener('change', () => {
    listState.salesRepFilter = salesRepFilterSelect.value;
    listState.page = 0;
    fetchAndRenderList();
  });

  statusFilterSelect?.addEventListener('change', () => {
    listState.statusFilter = statusFilterSelect.value;
    listState.page = 0;
    fetchAndRenderList();
  });

  resetListFilterBtn?.addEventListener('click', () => {
    if (salesRepFilterSelect) salesRepFilterSelect.value = '';
    if (statusFilterSelect)   statusFilterSelect.value   = '';
    listState.salesRepFilter = '';
    listState.statusFilter   = '';
    listState.page = 0;
    fetchAndRenderList();
  });

  sortableHeaders.forEach(th => {
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if (listState.sortColumn === column) {
        listState.sortAsc = !listState.sortAsc;
      } else {
        listState.sortColumn = column;
        listState.sortAsc = true;
      }
      listState.page = 0;

      sortableHeaders.forEach(h => h.classList.remove('is-sorted-asc', 'is-sorted-desc'));
      th.classList.add(listState.sortAsc ? 'is-sorted-asc' : 'is-sorted-desc');

      fetchAndRenderList();
    });
  });

  prevPageBtn?.addEventListener('click', () => {
    if (listState.page > 0) {
      listState.page -= 1;
      fetchAndRenderList();
    }
  });

  nextPageBtn?.addEventListener('click', () => {
    listState.page += 1;
    fetchAndRenderList();
  });
}

// ================================================================
// 詳細モーダル
// ================================================================
const detailModal        = document.getElementById('detailModal');
const detailModalTitle   = document.getElementById('detailModalTitle');
const detailStatusSelect = document.getElementById('detailStatusSelect');
const detailStatusSaved  = document.getElementById('detailStatusSaved');
const detailModalBody    = document.getElementById('detailModalBody');
const closeDetailModalBtn = document.getElementById('closeDetailModalBtn');
const editRequestBtn     = document.getElementById('editRequestBtn');
const saveRequestBtn     = document.getElementById('saveRequestBtn');
const cancelEditBtn      = document.getElementById('cancelEditBtn');

let currentDetailId     = null;
let currentDetailRecord = null;
let isEditMode          = false;

function populateStatusSelectOptions(selectEl) {
  selectEl.innerHTML = STATUS_ORDER
    .map(key => `<option value="${key}">${escapeHtml(STATUS_LABELS[key])}</option>`)
    .join('');
}

function setDetailModalStatus(status) {
  detailStatusSelect.value = status;
  detailStatusSelect.dataset.status = status;
}

function enterEditMode() {
  isEditMode = true;
  detailModalBody.innerHTML = buildRequestEditHtml(currentDetailRecord);
  editRequestBtn.hidden    = true;
  deleteRequestBtn.hidden  = true;
  saveRequestBtn.hidden    = false;
  cancelEditBtn.hidden     = false;
  detailModal.querySelector('.modal-footer')?.classList.add('modal-footer--edit');
}

function exitEditMode() {
  isEditMode = false;
  editRequestBtn.hidden   = false;
  deleteRequestBtn.hidden = false;
  saveRequestBtn.hidden   = true;
  cancelEditBtn.hidden    = true;
  detailModal.querySelector('.modal-footer')?.classList.remove('modal-footer--edit');
}

function openDetailModal(record) {
  currentDetailId     = record.id;
  currentDetailRecord = record;
  isEditMode          = false;
  detailModalTitle.textContent = `${record.company_name} 様`;
  setDetailModalStatus(record.status);
  detailModalBody.innerHTML = buildRequestDetailHtml(record);
  exitEditMode();
  detailModal.hidden = false;
}

function closeDetailModal() {
  isEditMode = false;
  detailModal.hidden = true;
  detailModalBody.innerHTML = '';
  currentDetailId     = null;
  currentDetailRecord = null;
}

async function handleStatusChange() {
  if (!currentDetailId) return;
  const newStatus = detailStatusSelect.value;

  detailStatusSelect.disabled = true;
  try {
    const { error } = await supabaseClient
      .from(DB_TABLE)
      .update({ status: newStatus })
      .eq('id', currentDetailId);
    if (error) throw error;

    detailStatusSelect.dataset.status = newStatus;
    if (currentDetailRecord) currentDetailRecord.status = newStatus;
    showToast('対応状況を保存しました');
  } catch (err) {
    console.error('[admin] 対応状況の更新エラー:', err);
    showToast('保存に失敗しました', 'error');
  } finally {
    detailStatusSelect.disabled = false;
  }
}

// ================================================================
// 詳細編集フォーム生成
// ================================================================
function buildRequestEditHtml(rec) {
  function editRow(label, inputHtml) {
    return `<div class="edit-row"><span class="edit-label">${escapeHtml(label)}</span><div class="edit-input-wrap">${inputHtml}</div></div>`;
  }
  function textInput(name, val, type = 'text') {
    return `<input type="${type}" name="${name}" class="form-input edit-input" value="${escapeHtml(val || '')}">`;
  }
  function textareaInput(name, val) {
    return `<textarea name="${name}" class="form-textarea edit-input">${escapeHtml(val || '')}</textarea>`;
  }
  function checkboxGroup(name, vals, labelsMap) {
    return `<div class="edit-checkboxes">${
      Object.entries(labelsMap).map(([key, label]) =>
        `<label class="edit-check-item"><input type="checkbox" name="${name}" value="${escapeHtml(key)}"${(vals || []).includes(key) ? ' checked' : ''}><span>${escapeHtml(label)}</span></label>`
      ).join('')
    }</div>`;
  }
  function singleCheckbox(name, checked, label) {
    return `<label class="edit-check-item"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}><span>${escapeHtml(label)}</span></label>`;
  }

  return `<form id="editRequestForm" class="edit-form" novalidate>
    <div class="edit-section">
      <div class="edit-section-title">貴社・ご担当者情報</div>
      ${editRow('貴社名',    textInput('company_name',    rec.company_name))}
      ${editRow('姓',        textInput('last_name',       rec.last_name))}
      ${editRow('名',        textInput('first_name',      rec.first_name))}
      ${editRow('せい',      textInput('last_name_kana',  rec.last_name_kana))}
      ${editRow('めい',      textInput('first_name_kana', rec.first_name_kana))}
      ${editRow('部署',      textInput('department',      rec.department))}
      ${editRow('役職',      textInput('job_title',       rec.job_title))}
    </div>
    <div class="edit-section">
      <div class="edit-section-title">連絡先情報</div>
      ${editRow('メールアドレス',  textInput('email',      rec.email, 'email'))}
      ${editRow('電話番号',        textInput('phone',      rec.phone, 'tel'))}
      ${editRow('郵便番号',        textInput('postal_code', rec.postal_code))}
      ${editRow('都道府県',        textInput('prefecture',  rec.prefecture))}
      ${editRow('市区町村・番地',  textInput('address1',    rec.address1))}
      ${editRow('ビル名ほか',      textInput('address2',    rec.address2))}
      ${editRow('WEBサイト',       textInput('website',     rec.website))}
    </div>
    <div class="edit-section">
      <div class="edit-section-title">出展について</div>
      ${editRow('出展予定製品',         textareaInput('exhibit_products', rec.exhibit_products))}
      ${editRow('出展を検討する会期',    checkboxGroup('exhibit_periods', rec.exhibit_periods, PERIOD_LABELS))}
      ${editRow('出展を希望するエリア',  checkboxGroup('exhibit_areas',   rec.exhibit_areas,   AREA_LABELS))}
      ${editRow('創業5年以内',           singleCheckbox('startup_check', rec.startup_check, '創業5年以内に該当する'))}
    </div>
    <div class="edit-section">
      <div class="edit-section-title">その他</div>
      ${editRow('出会いたい業種',                textareaInput('target_industry', rec.target_industry))}
      ${editRow('本展以外の出展検討中の展示会',  textareaInput('other_shows',     rec.other_shows))}
      ${editRow('オンライン商談希望日時',         textInput('online_meeting',  rec.online_meeting))}
      ${editRow('その他',                         textareaInput('other_notes', rec.other_notes))}
    </div>
  </form>`;
}

function collectEditFormData() {
  const form = document.getElementById('editRequestForm');
  if (!form) return null;
  const val  = name => (form.querySelector(`[name="${name}"]`)?.value ?? '').trim();
  const chk  = name => !!(form.querySelector(`[name="${name}"]`)?.checked);
  const vals = name => Array.from(form.querySelectorAll(`[name="${name}"]:checked`)).map(el => el.value);
  return {
    company_name:    val('company_name'),
    last_name:       val('last_name'),
    first_name:      val('first_name'),
    last_name_kana:  val('last_name_kana'),
    first_name_kana: val('first_name_kana'),
    department:      val('department'),
    job_title:       val('job_title'),
    email:           val('email'),
    phone:           val('phone'),
    postal_code:     val('postal_code').replace(/\D/g, '') || null,
    prefecture:      val('prefecture'),
    address1:        val('address1'),
    address2:        val('address2') || null,
    website:         val('website')  || null,
    exhibit_products: val('exhibit_products'),
    exhibit_periods:  vals('exhibit_periods'),
    exhibit_areas:    vals('exhibit_areas'),
    startup_check:    chk('startup_check'),
    target_industry:  val('target_industry') || null,
    other_shows:      val('other_shows')     || null,
    online_meeting:   val('online_meeting')  || null,
    other_notes:      val('other_notes')     || null,
  };
}

async function handleSaveEdit() {
  const updates = collectEditFormData();
  if (!updates) return;

  saveRequestBtn.disabled     = true;
  saveRequestBtn.textContent  = '保存中...';
  try {
    const { error } = await supabaseClient
      .from(DB_TABLE).update(updates).eq('id', currentDetailId);
    if (error) throw error;

    const { data, error: fetchErr } = await supabaseClient
      .from(DB_TABLE).select('*').eq('id', currentDetailId).single();
    if (fetchErr) throw fetchErr;

    currentDetailRecord = data;
    detailModalTitle.textContent  = `${data.company_name} 様`;
    detailModalBody.innerHTML     = buildRequestDetailHtml(data);
    setDetailModalStatus(data.status);
    exitEditMode();
    fetchAndRenderList();
    showToast('修正内容を保存しました');
  } catch (err) {
    console.error('[admin] 編集保存エラー:', err);
    showToast('保存に失敗しました', 'error');
  } finally {
    saveRequestBtn.disabled    = false;
    saveRequestBtn.textContent = '修正を保存';
  }
}

function handleCancelEdit() {
  detailModalBody.innerHTML = buildRequestDetailHtml(currentDetailRecord);
  exitEditMode();
}

async function handleTableSelectChange(e) {
  const select = e.target.closest('select.table-select');
  if (!select) return;
  const id = select.dataset.id;
  if (!id || !select.isConnected || !requestsTableBody.contains(select)) return;
  const field = select.classList.contains('table-select--status') ? 'status' : 'sales_rep';
  const value = select.value;

  select.disabled = true;
  try {
    const { error } = await supabaseClient
      .from(DB_TABLE)
      .update({ [field]: value || null })
      .eq('id', id)
      .select('id');
    if (error) throw error;

    if (field === 'status') {
      select.dataset.status = value;
      if (currentDetailId === id) setDetailModalStatus(value);
    }
  } catch (err) {
    console.error('[admin] 一覧更新エラー:', err);
    showToast('更新に失敗しました', 'error');
    fetchAndRenderList();
  } finally {
    if (select.isConnected) select.disabled = false;
  }
}

async function handleRowClick(e) {
  if (e.target.closest('select')) return; // プルダウン操作は行クリック対象外
  const row = e.target.closest('tr[data-id]');
  if (!row) return;

  const id = row.dataset.id;
  try {
    const { data, error } = await supabaseClient
      .from(DB_TABLE)
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    openDetailModal(data);
  } catch (err) {
    console.error('[admin] 詳細取得エラー:', err);
    showToast('詳細の取得に失敗しました', 'error');
  }
}

const deleteRequestBtn = document.getElementById('deleteRequestBtn');

async function handleDeleteRequest() {
  if (isEditMode) return;
  if (!currentDetailId) return;
  if (!confirm('この申込みを削除します。この操作は取り消せません。よろしいですか？')) return;

  deleteRequestBtn.disabled = true;
  try {
    const { error } = await supabaseClient
      .from(DB_TABLE)
      .delete()
      .eq('id', currentDetailId);
    if (error) throw error;

    closeDetailModal();
    fetchAndRenderList();
    showToast('削除しました');
  } catch (err) {
    console.error('[admin] 削除エラー:', err);
    showToast('削除に失敗しました', 'error');
  } finally {
    deleteRequestBtn.disabled = false;
  }
}

// ================================================================
// 営業メモ 自動保存
// ================================================================
let memoDebounceId = null;

async function handleMemoInput(e) {
  const textarea = e.target;
  if (!currentDetailId) return;

  clearTimeout(memoDebounceId);
  memoDebounceId = setTimeout(async () => {
    const memo = textarea.value;
    try {
      const { error } = await supabaseClient
        .from(DB_TABLE)
        .update({ memo })
        .eq('id', currentDetailId);
      if (error) throw error;
      if (currentDetailRecord) currentDetailRecord.memo = memo;
      showToast('メモを保存しました');
    } catch (err) {
      console.error('[admin] メモ保存エラー:', err);
      showToast('メモの保存に失敗しました', 'error');
    }
  }, 800);
}

function bindDetailModal() {
  populateStatusSelectOptions(detailStatusSelect);
  requestsTableBody?.addEventListener('click', handleRowClick);
  requestsTableBody?.addEventListener('change', handleTableSelectChange);
  closeDetailModalBtn?.addEventListener('click', closeDetailModal);
  detailStatusSelect?.addEventListener('change', handleStatusChange);
  deleteRequestBtn?.addEventListener('click', handleDeleteRequest);
  editRequestBtn?.addEventListener('click', enterEditMode);
  saveRequestBtn?.addEventListener('click', handleSaveEdit);
  cancelEditBtn?.addEventListener('click', handleCancelEdit);
  detailModalBody?.addEventListener('input', (e) => {
    if (e.target.id === 'detailMemoTextarea') handleMemoInput(e);
  });
  detailModal?.addEventListener('click', (e) => {
    if (e.target === detailModal) closeDetailModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !detailModal.hidden) closeDetailModal();
  });
}

// ================================================================
// CSVフィルターモーダル
// ================================================================
const csvFilterModal       = document.getElementById('csvFilterModal');
const csvFromDateEl        = document.getElementById('csvFromDate');
const csvToDateEl          = document.getElementById('csvToDate');
const csvSalesRepEl        = document.getElementById('csvSalesRep');
const csvStatusBoxesEl     = document.getElementById('csvStatusCheckboxes');
const closeCsvFilterBtn    = document.getElementById('closeCsvFilterBtn');
const executeCsvBtn        = document.getElementById('executeCsvBtn');

function populateCsvSalesRepOptions() {
  if (!csvSalesRepEl) return;
  while (csvSalesRepEl.options.length > 1) csvSalesRepEl.remove(1);
  salesRepsData.forEach(rep => {
    const opt = document.createElement('option');
    opt.value = rep.name;
    opt.textContent = rep.name;
    csvSalesRepEl.appendChild(opt);
  });
}

function populateCsvFilterControls() {
  populateCsvSalesRepOptions();
  if (csvStatusBoxesEl) {
    csvStatusBoxesEl.innerHTML = STATUS_ORDER.map(key => `
      <label class="csv-status-check">
        <input type="checkbox" name="csv_status" value="${key}" checked>
        <span class="status-badge" data-status="${key}">${escapeHtml(STATUS_LABELS[key])}</span>
      </label>
    `).join('');
  }
}

function openCsvFilterModal()  { csvFilterModal.hidden = false; }
function closeCsvFilterModal() { csvFilterModal.hidden = true;  }

async function handleExecuteCsv() {
  const fromDate = csvFromDateEl?.value ?? '';
  const toDate   = csvToDateEl?.value   ?? '';
  const salesRep = csvSalesRepEl?.value ?? '';
  const statuses = Array.from(
    csvStatusBoxesEl?.querySelectorAll('input[name="csv_status"]:checked') ?? []
  ).map(el => el.value);

  closeCsvFilterModal();
  exportCsvBtn.disabled    = true;
  exportCsvBtn.textContent = '出力中...';
  try {
    let query = applySearchFilter(
      supabaseClient.from(DB_TABLE).select('*'),
      listState.searchQuery
    );
    if (fromDate) query = query.gte('submitted_at', fromDate + 'T00:00:00+09:00');
    if (toDate)   query = query.lte('submitted_at', toDate   + 'T23:59:59.999+09:00');
    if (salesRep) query = query.eq('sales_rep', salesRep);
    if (statuses.length > 0 && statuses.length < STATUS_ORDER.length) {
      query = query.in('status', statuses);
    }
    const { data, error } = await query.order(listState.sortColumn, { ascending: listState.sortAsc, nullsFirst: false });
    if (error) throw error;

    const csv  = recordsToCsv(data || []);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `document_requests_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[admin] CSV出力エラー:', err);
    showToast('CSVの出力に失敗しました', 'error');
  } finally {
    exportCsvBtn.disabled    = false;
    exportCsvBtn.textContent = 'CSVダウンロード';
  }
}

function handleDownloadTemplateCsv() {
  const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const blob   = new Blob(['﻿' + header + '\r\n'], { type: 'text/csv;charset=utf-8;' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href     = url;
  a.download = 'document_requests_import_template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bindCsvFilter() {
  exportCsvBtn?.addEventListener('click', openCsvFilterModal);
  closeCsvFilterBtn?.addEventListener('click', closeCsvFilterModal);
  executeCsvBtn?.addEventListener('click', handleExecuteCsv);
  csvFilterModal?.addEventListener('click', (e) => {
    if (e.target === csvFilterModal) closeCsvFilterModal();
  });
}

// ================================================================
// ダッシュボード
// ================================================================
const kpiTotalEl        = document.getElementById('kpiTotal');
const kpiTodayEl        = document.getElementById('kpiToday');
const kpiWeekEl         = document.getElementById('kpiWeek');
const kpiMonthEl        = document.getElementById('kpiMonth');
const kpiTodayLabelEl   = document.getElementById('kpiTodayLabel');
const kpiWeekLabelEl    = document.getElementById('kpiWeekLabel');
const kpiMonthLabelEl   = document.getElementById('kpiMonthLabel');
const kpiTotalLabelEl   = document.getElementById('kpiTotalLabel');
const dashboardErrorEl  = document.getElementById('dashboardError');

const charts           = {}; // canvasId -> Chart.js instance
const statusChartIds   = []; // 動的生成した対応状況チャートのID追跡用

function destroyChart(canvasId) {
  charts[canvasId]?.destroy();
  delete charts[canvasId];
}

// ISO日時文字列 → "YYYY-MM-DD"（ローカルタイムゾーン基準）
function toDateKey(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function renderStatusChart(records) {
  let filtered = records;
  if (statusFilters.fromDate) {
    filtered = filtered.filter(r => { const k = toDateKey(r.submitted_at); return k && k >= statusFilters.fromDate; });
  }
  if (statusFilters.toDate) {
    filtered = filtered.filter(r => { const k = toDateKey(r.submitted_at); return k && k <= statusFilters.toDate; });
  }

  statusChartIds.forEach(id => destroyChart(id));
  statusChartIds.length = 0;

  const container = document.getElementById('statusChartContainer');
  if (!container) return;
  container.innerHTML = '';

  const groups = [
    { label: '全員', recs: filtered },
    ...salesRepsData.map(rep => ({ label: rep.name, recs: filtered.filter(r => r.sales_rep === rep.name) })),
  ];

  const legendSpacingPlugin = {
    id: 'legendSpacing',
    beforeInit(chart) {
      const orig = chart.legend.fit.bind(chart.legend);
      chart.legend.fit = function () { orig(); this.height += 10; };
    },
  };

  groups.forEach(({ label, recs }, idx) => {
    const counts = STATUS_ORDER.map(key => recs.filter(r => r.status === key).length);
    const total  = counts.reduce((a, b) => a + b, 0);
    const canvasId = `statusChart_${idx}`;
    statusChartIds.push(canvasId);

    const groupEl = document.createElement('div');
    groupEl.className = 'status-group';
    groupEl.innerHTML = `
      <span class="status-group-label">${escapeHtml(label)}</span>
      <div class="chart-canvas-wrap chart-canvas-wrap--status">
        <canvas id="${canvasId}"></canvas>
      </div>
    `;
    container.appendChild(groupEl);

    charts[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'bar',
      plugins: [legendSpacingPlugin],
      data: {
        labels: [''],
        datasets: STATUS_ORDER.map((key, i) => ({
          label: STATUS_LABELS[key],
          data: [counts[i]],
          backgroundColor: STATUS_COLORS[key],
          barPercentage: 1.0,
          categoryPercentage: 1.0,
          borderRadius: 4,
        })),
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        layout: { padding: 0 },
        scales: {
          x: { stacked: true, display: false },
          y: { stacked: true, display: false },
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 11,
              font: { size: 11 },
              padding: 8,
              generateLabels: (chart) => chart.data.datasets.map((ds, i) => {
                const pct = total === 0 ? 0 : Math.round(counts[i] / total * 100);
                return {
                  text: `${ds.label}　${counts[i]}件(${pct}%)`,
                  fillStyle: ds.backgroundColor,
                  strokeStyle: ds.backgroundColor,
                  lineWidth: 0,
                  hidden: false,
                  datasetIndex: i,
                };
              }),
            },
            onClick: () => {},
          },
          datalabels: { display: false },
        },
      },
    });
  });
}


function renderKpis(records) {
  const now            = new Date();
  const todayKey       = toDateKey(now.toISOString());
  const daysFromMonday = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const monday         = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday);
  const sunday         = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart      = toDateKey(monday.toISOString());

  const monthStartKey  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // 今年度: 4月以降なら今年4/1〜翌年3/31、1〜3月なら前年4/1〜今年3/31
  const fiscalStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fiscalStartKey  = `${fiscalStartYear}-04-01`;
  const fiscalEndKey    = `${fiscalStartYear + 1}-03-31`;

  // ラベルに日付範囲を表示
  const md         = d => `${d.getMonth() + 1}/${d.getDate()}`;
  const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthLast  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  if (kpiTodayLabelEl) kpiTodayLabelEl.textContent = `本日（${md(now)}）`;
  if (kpiWeekLabelEl)  kpiWeekLabelEl.textContent  = `今週（${md(monday)}〜${md(sunday)}）`;
  if (kpiMonthLabelEl) kpiMonthLabelEl.textContent = `今月（${md(monthFirst)}〜${md(monthLast)}）`;
  if (kpiTotalLabelEl) kpiTotalLabelEl.textContent = `今年度（4/1〜3/31）`;

  const todayCount  = records.filter(r => toDateKey(r.submitted_at) === todayKey).length;
  const weekCount   = records.filter(r => {
    const key = toDateKey(r.submitted_at);
    return key && key >= weekStart;
  }).length;
  const monthCount  = records.filter(r => {
    const key = toDateKey(r.submitted_at);
    return key && key >= monthStartKey;
  }).length;
  const fiscalCount = records.filter(r => {
    const key = toDateKey(r.submitted_at);
    return key && key >= fiscalStartKey && key <= fiscalEndKey;
  }).length;

  kpiTodayEl.textContent = `${todayCount}件`;
  kpiWeekEl.textContent  = `${weekCount}件`;
  kpiMonthEl.textContent = `${monthCount}件`;
  kpiTotalEl.textContent = `${fiscalCount}件`;
}

async function fetchAndRenderDashboard() {
  dashboardErrorEl.hidden = true;
  try {
    const { data, error } = await supabaseClient
      .from(DB_TABLE)
      .select('submitted_at, status, sales_rep')
      .limit(5000);
    if (error) throw error;
    cachedDashboardRecords = data || [];

    renderKpis(cachedDashboardRecords);
    renderStatusChart(cachedDashboardRecords);
  } catch (err) {
    console.error('[admin] ダッシュボード取得エラー:', err);
    dashboardErrorEl.textContent = 'ダッシュボードの取得に失敗しました。しばらく時間をおいて再度お試しください。';
    dashboardErrorEl.hidden = false;
  }
}

// ================================================================
// 対応状況フィルター
// ================================================================
function bindStatusFilter() {
  applyStatusFilterBtn?.addEventListener('click', () => {
    statusFilters.fromDate = statusFromDateEl?.value ?? '';
    statusFilters.toDate   = statusToDateEl?.value   ?? '';
    renderStatusChart(cachedDashboardRecords);
  });
  resetStatusFilterBtn?.addEventListener('click', () => {
    if (statusFromDateEl) statusFromDateEl.value = '';
    if (statusToDateEl)   statusToDateEl.value   = '';
    statusFilters.fromDate = '';
    statusFilters.toDate   = '';
    renderStatusChart(cachedDashboardRecords);
  });
}

// ================================================================
// CSVインポート
// ================================================================
const importCsvBtn         = document.getElementById('importCsvBtn');
const csvImportModal       = document.getElementById('csvImportModal');
const csvImportDrop        = document.getElementById('csvImportDrop');
const csvImportFile        = document.getElementById('csvImportFile');
const csvImportStep1       = document.getElementById('csvImportStep1');
const csvImportStep2       = document.getElementById('csvImportStep2');
const csvImportStep3       = document.getElementById('csvImportStep3');
const csvImportPreviewInfo = document.getElementById('csvImportPreviewInfo');
const csvImportPreviewWrap = document.getElementById('csvImportPreviewWrap');
const csvImportResultEl    = document.getElementById('csvImportResult');
const closeCsvImportBtn    = document.getElementById('closeCsvImportBtn');
const cancelCsvImportBtn   = document.getElementById('cancelCsvImportBtn');
const executeCsvImportBtn  = document.getElementById('executeCsvImportBtn');

const CSV_HEADER_TO_COLUMN = Object.fromEntries(CSV_COLUMNS.map(([col, label]) => [label, col]));
const PERIOD_LABEL_TO_KEY  = Object.fromEntries(Object.entries(PERIOD_LABELS).map(([k, v]) => [v, k]));
const AREA_LABEL_TO_KEY    = Object.fromEntries(Object.entries(AREA_LABELS).map(([k, v]) => [v, k]));
const STATUS_LABEL_TO_KEY  = Object.fromEntries(Object.entries(STATUS_LABELS).map(([k, v]) => [v, k]));

let importParsedRecords = [];

function parseCsvText(text) {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const rows = [];
  let field = '', row = [], inQuote = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"')                   { inQuote = false; }
      else                                   { field += ch; }
    } else {
      if      (ch === '"')                          { inQuote = true; }
      else if (ch === ',')                          { row.push(field); field = ''; }
      else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(f => f !== '')) rows.push(row);
        row = [];
      } else { field += ch; }
    }
  }
  if (row.length || field) { row.push(field); if (row.some(f => f !== '')) rows.push(row); }
  return rows;
}

function csvRowToRecord(headers, row) {
  const rec = {};
  headers.forEach((header, i) => {
    const col = CSV_HEADER_TO_COLUMN[header];
    if (!col) return;
    const raw = (row[i] ?? '').trim();

    switch (col) {
      case 'exhibit_periods':
        rec[col] = raw ? raw.split('、').map(v => PERIOD_LABEL_TO_KEY[v.trim()] ?? v.trim()).filter(Boolean) : [];
        break;
      case 'exhibit_areas':
        rec[col] = raw ? raw.split('、').map(v => AREA_LABEL_TO_KEY[v.trim()] ?? v.trim()).filter(Boolean) : [];
        break;
      case 'startup_check':
        rec[col] = raw === '創業５年以内';
        break;
      case 'status':
        rec[col] = STATUS_LABEL_TO_KEY[raw] ?? 'lead';
        break;
      case 'submitted_at': {
        if (!raw) { rec[col] = null; break; }
        const m = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
        if (m) {
          rec[col] = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
        } else {
          const d = new Date(raw);
          rec[col] = isNaN(d.getTime()) ? null : d.toISOString();
        }
        break;
      }
      case 'postal_code':
        rec[col] = raw.replace(/\D/g, '') || null;
        break;
      default:
        rec[col] = raw || null;
    }
  });
  return rec;
}

function buildImportPreviewHtml(records) {
  const preview  = records.slice(0, 5);
  const cols     = ['submitted_at', 'company_name', 'last_name', 'first_name', 'email', 'status'];
  const labelMap = Object.fromEntries(CSV_COLUMNS);
  const ths = cols.map(c => `<th>${escapeHtml(labelMap[c] || c)}</th>`).join('');
  const trs = preview.map(r => {
    const tds = cols.map(col => {
      let val = r[col] ?? '';
      if (col === 'submitted_at' && val) val = formatDateTimeJa(String(val));
      if (col === 'status') val = STATUS_LABELS[val] || val;
      return `<td>${escapeHtml(String(val))}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return `<table class="csv-import-preview-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function resetCsvImport() {
  if (csvImportFile) csvImportFile.value = '';
  importParsedRecords = [];
  if (csvImportStep1) csvImportStep1.hidden = false;
  if (csvImportStep2) csvImportStep2.hidden = true;
  if (csvImportStep3) csvImportStep3.hidden = true;
  if (executeCsvImportBtn) {
    executeCsvImportBtn.disabled    = true;
    executeCsvImportBtn.textContent = 'インポート実行';
  }
  csvImportDrop?.classList.remove('csv-import-drop--active');
}

function openCsvImportModal()  { resetCsvImport(); csvImportModal.hidden = false; }
function closeCsvImportModal() { csvImportModal.hidden = true; }

function handleCsvFileSelected(file) {
  if (!file || !file.name.toLowerCase().endsWith('.csv')) {
    showToast('CSVファイルを選択してください', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const rows = parseCsvText(e.target.result);
    if (rows.length < 2) { showToast('CSVにデータが含まれていません', 'error'); return; }
    const headers = rows[0];
    importParsedRecords = rows.slice(1).map(row => csvRowToRecord(headers, row));
    csvImportPreviewInfo.textContent = `${importParsedRecords.length} 件のデータを読み込みました（先頭5件プレビュー）`;
    csvImportPreviewWrap.innerHTML   = buildImportPreviewHtml(importParsedRecords);
    csvImportStep1.hidden = true;
    csvImportStep2.hidden = false;
    executeCsvImportBtn.disabled = false;
  };
  reader.readAsText(file, 'UTF-8');
}

async function handleExecuteCsvImport() {
  if (!importParsedRecords.length) return;
  executeCsvImportBtn.disabled    = true;
  executeCsvImportBtn.textContent = 'インポート中...';
  cancelCsvImportBtn.disabled     = true;

  let succeeded = 0, failed = 0;
  const BATCH = 100;
  try {
    for (let i = 0; i < importParsedRecords.length; i += BATCH) {
      const batch = importParsedRecords.slice(i, i + BATCH);
      const { error } = await supabaseClient.from(DB_TABLE).insert(batch);
      if (error) { console.error('[admin] インポートエラー:', error); failed += batch.length; }
      else        { succeeded += batch.length; }
    }
  } finally {
    cancelCsvImportBtn.disabled     = false;
    executeCsvImportBtn.textContent = 'インポート実行';
  }

  csvImportStep2.hidden = true;
  csvImportStep3.hidden = false;

  if (failed === 0) {
    csvImportResultEl.className   = 'csv-import-result csv-import-result--success';
    csvImportResultEl.textContent = `${succeeded} 件のインポートが完了しました。`;
  } else if (succeeded === 0) {
    csvImportResultEl.className   = 'csv-import-result csv-import-result--error';
    csvImportResultEl.textContent = `インポートに失敗しました（${failed} 件すべてエラー）。`;
  } else {
    csvImportResultEl.className   = 'csv-import-result csv-import-result--warn';
    csvImportResultEl.textContent = `${succeeded} 件成功、${failed} 件失敗しました。`;
  }
  if (succeeded > 0) fetchAndRenderList();
}

// ================================================================
// 設定パネル（営業担当者管理）
// ================================================================
function renderSalesRepSettingsList() {
  const listEl = document.getElementById('salesRepList');
  if (!listEl) return;
  if (salesRepsData.length === 0) {
    listEl.innerHTML = '<li class="settings-rep-empty">担当者が登録されていません</li>';
    return;
  }
  listEl.innerHTML = salesRepsData.map(rep => `
    <li class="settings-rep-item">
      <span class="settings-rep-name">${escapeHtml(rep.name)}</span>
      <button type="button" class="btn-back settings-rep-delete"
              data-id="${escapeHtml(rep.id)}" data-name="${escapeHtml(rep.name)}">削除</button>
    </li>
  `).join('');
}

async function handleAddSalesRep() {
  const input   = document.getElementById('newSalesRepInput');
  const errorEl = document.getElementById('salesRepAddError');
  const name    = input?.value.trim() ?? '';

  errorEl.textContent = '';
  if (!name) { errorEl.textContent = '担当者名を入力してください。'; return; }

  const addBtn = document.getElementById('addSalesRepBtn');
  addBtn.disabled = true;
  try {
    const { data, error } = await supabaseClient
      .from(SALES_REPS_TABLE)
      .insert({ name })
      .select('id, name')
      .single();
    if (error) throw error;
    salesRepsData.push(data);
    input.value = '';
    renderSalesRepSettingsList();
    refreshRepDropdowns();
    showToast(`「${data.name}」を追加しました`);
  } catch (err) {
    errorEl.textContent = err?.code === '23505'
      ? 'その名前はすでに登録されています。'
      : '追加に失敗しました。';
    console.error('[admin] 担当者追加エラー:', err);
  } finally {
    addBtn.disabled = false;
  }
}

async function handleDeleteSalesRep(id, name) {
  if (!confirm(`「${name}」を削除します。よろしいですか？`)) return;
  try {
    const { error } = await supabaseClient
      .from(SALES_REPS_TABLE)
      .delete()
      .eq('id', id);
    if (error) throw error;
    salesRepsData = salesRepsData.filter(r => r.id !== id);
    renderSalesRepSettingsList();
    refreshRepDropdowns();
    showToast(`「${name}」を削除しました`);
  } catch (err) {
    console.error('[admin] 担当者削除エラー:', err);
    showToast('削除に失敗しました', 'error');
  }
}

function refreshRepDropdowns() {
  populateListFilterControls();
  populateCsvSalesRepOptions();
  const panelList = document.getElementById('panel-list');
  if (panelList && !panelList.hidden) fetchAndRenderList();
}

function bindSettingsPanel() {
  document.getElementById('addSalesRepBtn')?.addEventListener('click', handleAddSalesRep);
  document.getElementById('newSalesRepInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAddSalesRep();
  });
  document.getElementById('salesRepList')?.addEventListener('click', e => {
    const btn = e.target.closest('.settings-rep-delete');
    if (!btn) return;
    handleDeleteSalesRep(btn.dataset.id, btn.dataset.name);
  });
}

function bindCsvImport() {
  importCsvBtn?.addEventListener('click', openCsvImportModal);
  closeCsvImportBtn?.addEventListener('click', closeCsvImportModal);
  cancelCsvImportBtn?.addEventListener('click', closeCsvImportModal);
  executeCsvImportBtn?.addEventListener('click', handleExecuteCsvImport);
  csvImportModal?.addEventListener('click', e => { if (e.target === csvImportModal) closeCsvImportModal(); });

  document.getElementById('importTemplateDownloadBtn')?.addEventListener('click', handleDownloadTemplateCsv);
  csvImportFile?.addEventListener('change', e => handleCsvFileSelected(e.target.files[0]));

  csvImportDrop?.addEventListener('dragover',  e => { e.preventDefault(); csvImportDrop.classList.add('csv-import-drop--active'); });
  csvImportDrop?.addEventListener('dragleave', ()  => csvImportDrop.classList.remove('csv-import-drop--active'));
  csvImportDrop?.addEventListener('drop', e => {
    e.preventDefault();
    csvImportDrop.classList.remove('csv-import-drop--active');
    handleCsvFileSelected(e.dataTransfer.files[0]);
  });
}

// ================================================================
// Init
// ================================================================
loginForm?.addEventListener('submit', handleLoginSubmit);
logoutBtn?.addEventListener('click', handleLogout);
bindTabs();
bindListControls();
bindDetailModal();
bindStatusFilter();
bindCsvFilter();
bindCsvImport();
bindSettingsPanel();

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showLoggedIn(session);
  } else {
    showLoggedOut();
  }
});

// 初回チェック（onAuthStateChangeは初期化時にも一度呼ばれるが、念のため明示的にも確認）
supabaseClient.auth.getSession().then(({ data }) => {
  if (data.session) {
    showLoggedIn(data.session);
  } else {
    showLoggedOut();
  }
});
