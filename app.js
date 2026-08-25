'use strict';

/* ==================== 数据 ==================== */
const STORAGE_KEY = 'habit-tracker.v1';
const PALETTE = ['#7c6cf0', '#4f8ef7', '#2fb8a6', '#f2a93b', '#f26d6d', '#e05fa8', '#58b368', '#8a6cf0'];
const EMOJIS = ['💧', '🧘', '📖', '🏃', '💪', '🥗', '😴', '✍️', '🎧', '🚶', '🌿', '☀️'];
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const DEFAULT_HABITS = [
  { name: '喝水', icon: '💧', color: '#4f8ef7' },
  { name: '活动肩膀', icon: '🧘', color: '#2fb8a6' },
  { name: '读书', icon: '📖', color: '#f2a93b' },
];

let state = loadState();

const view = {
  mode: 'today',
  ym: { y: new Date().getFullYear(), m: new Date().getMonth() },
  dayDetail: null,
  habitForm: null,
  manage: false,
  confirmDelete: null,
};

let formName = '';
let formIcon = EMOJIS[0];
let formColor = PALETTE[0];
let toastTimer = null;
let lastStamp = null; // { key, id } 最近一次盖章的位置,用于播放盖章动画
let swipeOpenId = null; // 当前左滑展开的习惯行 id
let swipeDrag = null;   // 正在进行的滑动手势
const SWIPE_W = 130;    // 操作层宽度,需与 CSS 中 .entry-actions 一致

/* ==================== 工具函数 ==================== */
const $ = (sel) => document.querySelector(sel);

function pad2(n) { return String(n).padStart(2, '0'); }

function dateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function todayKey() { return dateKey(new Date()); }

function uid() {
  return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ==================== 状态读写 ==================== */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.habits) && data.records) return data;
    }
  } catch (e) { /* 数据损坏时重新初始化 */ }

  const habits = DEFAULT_HABITS.map((h, i) => ({ id: uid() + i, ...h }));
  const fresh = { habits, records: {} };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function doneIds(key) { return state.records[key] || []; }

function isDone(key, hid) { return doneIds(key).includes(hid); }

function setDone(key, hid, on) {
  if (!state.records[key]) state.records[key] = [];
  const arr = state.records[key];
  const i = arr.indexOf(hid);
  if (on && i === -1) arr.push(hid);
  if (!on && i !== -1) arr.splice(i, 1);
  if (arr.length === 0) delete state.records[key];
  lastStamp = { key, id: hid };
  swipeOpenId = null;
  saveState();
  render();
}

function isJustStamped(key, hid) {
  return !!lastStamp && lastStamp.key === key && lastStamp.id === hid;
}

function getHabit(id) { return state.habits.find((h) => h.id === id); }

function addHabit(name, icon, color) {
  state.habits.push({ id: uid(), name, icon, color });
  saveState();
}

function updateHabit(id, patch) {
  const h = getHabit(id);
  if (h) { Object.assign(h, patch); saveState(); }
}

function removeHabit(id) {
  state.habits = state.habits.filter((h) => h.id !== id);
  for (const k of Object.keys(state.records)) {
    state.records[k] = state.records[k].filter((x) => x !== id);
    if (state.records[k].length === 0) delete state.records[k];
  }
  swipeOpenId = null;
  saveState();
}

/* ==================== 统计 ==================== */
function dayProgress(key) {
  const total = state.habits.length;
  const done = doneIds(key).length;
  return { total, done, pct: total ? done / total : 0 };
}

function habitStreak(hid) {
  let d = new Date();
  if (!isDone(dateKey(d), hid)) d = addDays(d, -1);
  let streak = 0;
  while (isDone(dateKey(d), hid)) {
    streak++;
    d = addDays(d, -1);
  }
  return streak;
}

function monthDates(y, m, weeks = 6) {
  const first = new Date(y, m, 1);
  const start = (first.getDay() + 6) % 7; // 周一为一周开始
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(y, m, 1 - start + i);
    return {
      d,
      key: dateKey(d),
      inMonth: d.getMonth() === m,
      today: dateKey(d) === todayKey(),
    };
  });
}

function monthRate(y, m) {
  const now = new Date();
  const isCurrent = y === now.getFullYear() && m === now.getMonth();
  const maxDay = isCurrent ? now.getDate() : new Date(y, m + 1, 0).getDate();
  let sum = 0;
  for (let day = 1; day <= maxDay; day++) {
    const key = y + '-' + pad2(m + 1) + '-' + pad2(day);
    sum += dayProgress(key).pct;
  }
  return maxDay ? sum / maxDay : 0;
}

function yearStats(y) {
  const now = new Date();
  const last = y === now.getFullYear() ? now : new Date(y, 11, 31);
  let days = 0, total = 0, perfect = 0, best = 0, cur = 0;
  const t = state.habits.length;
  for (let d = new Date(y, 0, 1); d <= last; d = addDays(d, 1)) {
    const n = doneIds(dateKey(d)).length;
    if (n > 0) {
      days++;
      total += n;
      if (t > 0 && n === t) perfect++;
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return { days, total, perfect, best };
}

/* ==================== 视图渲染 ==================== */
function render() {
  renderToday();
  renderMonth();
  renderYear();
  renderModal();
  switchView();
}

function switchView() {
  $('#view-today').classList.toggle('hidden', view.mode !== 'today');
  $('#view-month').classList.toggle('hidden', view.mode !== 'month');
  $('#view-year').classList.toggle('hidden', view.mode !== 'year');
  document.querySelectorAll('.tab').forEach((b) => (
    b.classList.toggle('active', b.dataset.tab === view.mode)
  ));
}

function renderToday() {
  const wrap = $('#view-today');
  const key = todayKey();
  const { done, total, pct } = dayProgress(key);
  const d = new Date();

  let stripHtml = '';
  let rowsHtml;

  if (state.habits.length === 0) {
    rowsHtml = `
      <div class="empty">
        <span class="empty-emoji">🌱</span>
        还没有习惯,先添加一个吧
      </div>`;
  } else {
    stripHtml = state.habits.map((h) => {
      const on = isDone(key, h.id);
      const just = isJustStamped(key, h.id) ? ' just' : '';
      return `
        <button class="stamp-cell ${on ? 'done' : ''}${just}" data-action="toggle" data-id="${h.id}" data-date="${key}"
          aria-label="${on ? '取消' : '完成'}「${esc(h.name)}」" title="${esc(h.name)}">
          <span class="cell-emoji">${esc(h.icon)}</span>
          <span class="stamp-mark">✓</span>
        </button>`;
    }).join('');

    rowsHtml = state.habits.map((h) => {
      const on = isDone(key, h.id);
      const streak = habitStreak(h.id);
      const just = isJustStamped(key, h.id) ? ' just' : '';
      const open = h.id === swipeOpenId ? ' open' : '';
      const streakText = streak > 0 ? '连续 ' + streak + ' 天' : '今天还没开始';
      return `
        <div class="entry-wrap" data-id="${h.id}">
          <div class="entry-actions">
            <button class="action-btn action-edit" data-action="edit-habit" data-id="${h.id}">编辑</button>
            <button class="action-btn action-delete" data-action="delete-habit" data-id="${h.id}">删除</button>
          </div>
          <div class="entry-row${open}" data-id="${h.id}">
            <button class="entry-main" data-action="edit-habit" data-id="${h.id}" title="编辑习惯">
              <span class="entry-icon">${esc(h.icon)}</span>
              <span class="entry-info">
                <span class="entry-name">${esc(h.name)}</span>
                <span class="entry-streak">${streakText}</span>
              </span>
            </button>
            <button class="stamp ${on ? 'on' : ''}${just}" data-action="toggle" data-id="${h.id}" data-date="${key}"
              aria-label="${on ? '取消完成' : '标记完成'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7.5"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');
  }

  let desc;
  if (total === 0) {
    desc = '添加习惯,开始打卡吧';
  } else if (pct === 1) {
    desc = '今天全部完成,盖章收工 🎉';
  } else if (done === 0) {
    desc = '今天还没盖章,开始吧';
  } else {
    desc = `已完成 <b>${done}</b> / <b>${total}</b> 项,还差 ${total - done} 项`;
  }

  wrap.innerHTML = `
    <div class="hero">
      <div class="hero-text">
        <p class="kicker">星期${'日一二三四五六'[d.getDay()]} · 今日打卡</p>
        <h1 class="display">${d.getMonth() + 1}月${d.getDate()}日</h1>
        <p class="hero-desc">${desc}</p>
      </div>
      ${stripHtml ? `<div class="stamp-strip">${stripHtml}</div>` : ''}
    </div>
    <div class="sheet">
      <div class="sheet-head">
        <span class="sheet-title">今日清单</span>
        <span class="sheet-tools">
          <span class="sheet-hint">左滑行可操作</span>
          <button class="link-btn" data-action="open-manage">管理习惯</button>
        </span>
      </div>
      ${rowsHtml}
      <div class="add-line">
        <span class="add-plus">＋</span>
        <input id="new-habit-name" placeholder="写下下一个想坚持的习惯…" maxlength="12" autocomplete="off">
        <button class="btn primary" data-action="open-new">添加</button>
      </div>
    </div>`;

  const quick = $('#new-habit-name');
  if (quick) {
    quick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openHabitForm('new');
    });
  }
  document.querySelectorAll('.entry-wrap').forEach((wrap) => {
    attachSwipe(wrap.querySelector('.entry-row'));
  });
  lastStamp = null;
}

function renderMonth() {
  const wrap = $('#view-month');
  const { y, m } = view.ym;
  const days = monthDates(y, m);
  const cells = days.map(({ d, key, inMonth, today }) => {
    const { done, total, pct } = dayProgress(key);
    return `
      <button class="cal-cell ${inMonth ? '' : 'muted'} ${today ? 'today' : ''}" data-action="open-day" data-date="${key}">
        <span class="cal-num">${d.getDate()}</span>
        ${total > 0 ? `<span class="cal-meta">${done}/${total}</span>` : ''}
        ${done > 0 ? `<span class="cal-seal ${pct >= 1 ? 'full' : ''}"></span>` : ''}
      </button>`;
  }).join('');

  wrap.innerHTML = `
    <div class="cal-shell">
      <div class="cal-nav">
        <button class="icon-btn" data-action="prev-month" title="上个月">‹</button>
        <h2 class="cal-title">${y}年 ${m + 1}月</h2>
        <button class="icon-btn" data-action="next-month" title="下个月">›</button>
        <button class="btn ghost" data-action="goto-today">今天</button>
      </div>
      <div class="cal-dow">${WEEK_LABELS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </div>`;
}

function renderYear() {
  const wrap = $('#view-year');
  const y = view.ym.y;
  const cards = Array.from({ length: 12 }, (_, m) => {
    const rate = monthRate(y, m);
    const squares = monthDates(y, m).map(({ key, inMonth }) => {
      const { pct } = dayProgress(key);
      const a = 0.05 + pct * 0.85;
      return `<i class="sq ${inMonth ? '' : 'out'}" style="background:rgba(213,76,50,${a.toFixed(2)})"></i>`;
    }).join('');
    return `
      <button class="year-card" data-action="goto-month" data-y="${y}" data-m="${m}">
        <div class="year-head"><span>${m + 1}月</span><span class="year-rate">${(rate * 100).toFixed(0)}%</span></div>
        <div class="year-mini">${squares}</div>
      </button>`;
  }).join('');

  const s = yearStats(y);
  const stats = [
    { num: s.total, label: '累计完成项' },
    { num: s.days, label: '打卡天数' },
    { num: s.perfect, label: '完美天数' },
    { num: s.best, label: '最佳连续天数' },
  ].map((x) => `
    <div class="stat"><b>${x.num}</b><span>${x.label}</span></div>
  `).join('');

  wrap.innerHTML = `
    <div class="cal-nav">
      <button class="icon-btn" data-action="prev-year" title="上一年">‹</button>
      <h2 class="cal-title">${y}年</h2>
      <button class="icon-btn" data-action="next-year" title="下一年">›</button>
      <button class="btn ghost" data-action="goto-today">今年</button>
    </div>
    <div class="stat-row">${stats}</div>
    <div class="year-grid">${cards}</div>`;
}

function renderModal() {
  const root = $('#modal-root');
  const body = $('#modal-body');

  if (view.dayDetail) {
    renderDayModal(body);
  } else if (view.habitForm) {
    renderHabitFormModal(body);
  } else if (view.manage) {
    renderManageModal(body);
  } else if (view.confirmDelete) {
    renderConfirmModal(body);
  }

  root.classList.toggle(
    'hidden',
    !view.dayDetail && !view.habitForm && !view.manage && !view.confirmDelete
  );
}

function renderDayModal(body) {
  const d = parseKey(view.dayDetail);
  const { done, total } = dayProgress(view.dayDetail);
  const rows = state.habits.map((h) => {
    const on = isDone(view.dayDetail, h.id);
    return `
      <div class="day-row">
        <span class="day-icon">${esc(h.icon)}</span>
        <span class="day-name">${esc(h.name)}</span>
        <button class="stamp ${on ? 'on' : ''}" data-action="toggle" data-id="${h.id}" data-date="${view.dayDetail}"
          aria-label="${on ? '取消完成' : '标记完成'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7.5"/></svg>
        </button>
      </div>`;
  }).join('');

  body.innerHTML = `
    <div class="modal-head">
      <button class="icon-btn" data-action="day-prev" title="前一天">‹</button>
      <div class="modal-title">
        <h3>${d.getMonth() + 1}月${d.getDate()}日 · 星期${'日一二三四五六'[d.getDay()]}</h3>
        <p>${total === 0 ? '暂无习惯' : `${done}/${total} 项完成`}</p>
      </div>
      <button class="icon-btn" data-action="day-next" title="后一天">›</button>
      <button class="icon-btn close" data-action="close-modal" title="关闭">×</button>
    </div>
    <div class="day-list">${rows || '<div class="empty">这一天还没有可打卡的习惯</div>'}</div>`;
}

function renderHabitFormModal(body) {
  const editing = view.habitForm !== 'new';
  const emojiHtml = EMOJIS.map((e) => `
    <button class="emoji-opt ${e === formIcon ? 'sel' : ''}" data-action="pick-emoji" data-emoji="${e}">${e}</button>
  `).join('');

  body.innerHTML = `
    <div class="modal-head">
      <h3 style="flex:1">${editing ? '编辑习惯' : '添加习惯'}</h3>
      <button class="icon-btn close" data-action="close-modal" title="关闭">×</button>
    </div>
    <div class="form-body">
      <label class="field-label">名称</label>
      <input type="text" id="habit-name-input" placeholder="例如:早睡" maxlength="12" autocomplete="off" value="${esc(formName)}">

      <label class="field-label">图标</label>
      <div class="emoji-row">${emojiHtml}</div>

      <div class="form-actions">
        ${editing ? '<button class="btn danger" data-action="delete-habit" data-id="' + view.habitForm + '">删除</button>' : ''}
        <button class="btn ghost" data-action="close-modal">取消</button>
        <button class="btn primary" data-action="save-habit">保存</button>
      </div>
    </div>`;

  const input = $('#habit-name-input');
  if (input) {
    input.focus();
    if (editing) input.select();
    input.addEventListener('input', () => { formName = input.value; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveHabitForm();
    });
  }
}

function renderManageModal(body) {
  const rows = state.habits.length
    ? state.habits.map((h) => {
        const streak = habitStreak(h.id);
        return `
          <div class="manage-row">
            <span class="manage-icon">${esc(h.icon)}</span>
            <span class="manage-info">
              <span class="manage-name">${esc(h.name)}</span>
              <span class="manage-streak">${streak > 0 ? '连续 ' + streak + ' 天' : '暂未开始'}</span>
            </span>
            <button class="btn ghost" data-action="edit-habit" data-id="${h.id}">编辑</button>
            <button class="btn danger" data-action="delete-habit" data-id="${h.id}">删除</button>
          </div>`;
      }).join('')
    : '<div class="empty"><span class="empty-emoji">🌱</span>还没有习惯,先添加一个吧</div>';

  body.innerHTML = `
    <div class="modal-head">
      <h3 style="flex:1">管理习惯</h3>
      <button class="icon-btn close" data-action="close-modal" title="关闭">×</button>
    </div>
    <div class="manage-list">${rows}</div>`;
}

function renderConfirmModal(body) {
  const h = getHabit(view.confirmDelete);
  body.innerHTML = `
    <div class="modal-head">
      <h3 style="flex:1">删除习惯</h3>
      <button class="icon-btn close" data-action="close-modal" title="关闭">×</button>
    </div>
    <div class="confirm-body">
      <p class="confirm-text">确定删除「${h ? esc(h.name) : '这个习惯'}」吗?</p>
      <p class="confirm-sub">该习惯的历史打卡记录也会一并删除,删除后无法恢复。</p>
      <div class="form-actions">
        <button class="btn ghost" data-action="close-modal">取消</button>
        <button class="btn danger" data-action="confirm-delete" data-id="${view.confirmDelete}">确认删除</button>
      </div>
    </div>`;
}

/* ==================== 交互 ==================== */
function attachSwipe(row) {
  if (!row) return;

  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    row._suppressClick = false;
    swipeDrag = {
      id: row.dataset.id,
      startX: e.clientX,
      startY: e.clientY,
      open: row.classList.contains('open'),
      moved: false,
      dx: 0,
      dy: 0,
    };
  });

  row.addEventListener('pointermove', (e) => {
    const d = swipeDrag;
    if (!d || d.id !== row.dataset.id) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    d.dx = dx;
    d.dy = dy;
    if (!d.moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) d.moved = true;
    if (!d.moved) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      row.style.transition = 'none';
      const x = Math.min(0, Math.max(-SWIPE_W, (d.open ? -SWIPE_W : 0) + dx));
      row.style.transform = 'translateX(' + x + 'px)';
    }
  });

  const endSwipe = (e) => {
    const d = swipeDrag;
    if (!d || d.id !== row.dataset.id) return;
    row.style.transition = '';
    row.style.transform = '';
    if (!d.moved) {
      if (d.open) {
        // 轻点已展开的行:如果是印章按钮,允许它继续盖章;其余情况只收起、不触发点击
        const onStamp = e.target && e.target.closest && e.target.closest('.stamp');
        if (!onStamp) row._suppressClick = true;
        closeSwipe();
      }
    } else if (Math.abs(d.dx) > Math.abs(d.dy)) {
      row._suppressClick = true;
      if (d.dx < -SWIPE_W * 0.3) openSwipe(row.dataset.id);
      else closeSwipe();
    }
    swipeDrag = null;
  };

  row.addEventListener('pointerup', endSwipe);
  row.addEventListener('pointercancel', endSwipe);

  // 拦截滑动/轻点收起后浏览器补发的 click,避免误触编辑或盖章
  row.addEventListener('click', (e) => {
    if (row._suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      row._suppressClick = false;
    }
  }, true);
}

function openSwipe(id) {
  closeSwipe();
  swipeOpenId = id;
  const row = document.querySelector('.entry-row[data-id="' + id + '"]');
  if (row) row.classList.add('open');
}

function closeSwipe() {
  if (!swipeOpenId) return;
  const row = document.querySelector('.entry-row[data-id="' + swipeOpenId + '"]');
  if (row) row.classList.remove('open');
  swipeOpenId = null;
}

function setTab(mode) {
  view.mode = mode;
  switchView();
}

function openHabitForm(id) {
  swipeOpenId = null;
  view.habitForm = id;
  if (id === 'new') {
    const quick = $('#new-habit-name');
    formName = quick ? quick.value.trim() : '';
    formIcon = EMOJIS[state.habits.length % EMOJIS.length];
    formColor = PALETTE[state.habits.length % PALETTE.length];
  } else {
    const h = getHabit(id);
    if (h) {
      formName = h.name;
      formIcon = h.icon;
      formColor = h.color;
    }
  }
  render();
}

function closeModal() {
  view.dayDetail = null;
  view.habitForm = null;
  view.manage = false;
  view.confirmDelete = null;
  render();
}

function saveHabitForm() {
  const name = formName.trim();
  if (!name) {
    showToast('请输入习惯名称');
    const input = $('#habit-name-input');
    if (input) input.focus();
    return;
  }
  if (view.habitForm === 'new') {
    addHabit(name, formIcon, formColor);
    showToast('已添加「' + name + '」✓');
  } else {
    updateHabit(view.habitForm, { name, icon: formIcon });
    showToast('已保存 ✓');
  }
  closeModal();
}

function deleteHabitFlow(id) {
  const h = getHabit(id);
  if (!h) return;
  swipeOpenId = null;
  view.dayDetail = null;
  view.habitForm = null;
  view.manage = false;
  view.confirmDelete = id;
  render();
}

function confirmDeleteHabit() {
  const id = view.confirmDelete;
  if (!id) return;
  const h = getHabit(id);
  removeHabit(id);
  closeModal();
  if (h) showToast('已删除「' + h.name + '」');
}

function shiftMonth(dir) {
  view.ym.m += dir;
  if (view.ym.m < 0) { view.ym.m = 11; view.ym.y--; }
  if (view.ym.m > 11) { view.ym.m = 0; view.ym.y++; }
  render();
}

function gotoToday() {
  const n = new Date();
  view.ym = { y: n.getFullYear(), m: n.getMonth() };
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '习惯打卡备份-' + todayKey() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('备份已导出 ✓');
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ==================== 事件绑定 ==================== */
document.addEventListener('click', (e) => {
  if (e.target === $('#modal-root')) {
    closeModal();
    return;
  }
  if (swipeOpenId) {
    const openWrap = e.target.closest ? e.target.closest('.entry-wrap[data-id="' + swipeOpenId + '"]') : null;
    if (!openWrap) closeSwipe();
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const key = el.dataset.date;
  const id = el.dataset.id;

  switch (action) {
    case 'toggle':
      setDone(key, id, !isDone(key, id));
      break;
    case 'tab':
      setTab(el.dataset.tab);
      break;
    case 'open-day':
      view.dayDetail = key;
      render();
      break;
    case 'day-prev':
      view.dayDetail = dateKey(addDays(parseKey(view.dayDetail), -1));
      render();
      break;
    case 'day-next':
      view.dayDetail = dateKey(addDays(parseKey(view.dayDetail), 1));
      render();
      break;
    case 'prev-month':
      shiftMonth(-1);
      break;
    case 'next-month':
      shiftMonth(1);
      break;
    case 'prev-year':
      view.ym.y--;
      render();
      break;
    case 'next-year':
      view.ym.y++;
      render();
      break;
    case 'goto-today':
      gotoToday();
      break;
    case 'goto-month':
      view.ym.y = parseInt(el.dataset.y, 10);
      view.ym.m = parseInt(el.dataset.m, 10);
      setTab('month');
      render();
      break;
    case 'open-new':
      openHabitForm('new');
      break;
    case 'edit-habit':
      openHabitForm(id);
      break;
    case 'open-manage':
      view.manage = true;
      render();
      break;
    case 'pick-emoji':
      formIcon = el.dataset.emoji;
      render();
      break;
    case 'pick-color':
      formColor = el.dataset.color;
      render();
      break;
    case 'save-habit':
      saveHabitForm();
      break;
    case 'delete-habit':
      deleteHabitFlow(id);
      break;
    case 'confirm-delete':
      confirmDeleteHabit();
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'export':
      exportData();
      break;
    case 'import':
      $('#import-file').click();
      break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

$('#import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.habits)) throw new Error('bad format');
      state = { habits: data.habits, records: data.records || {} };
      saveState();
      render();
      showToast('数据已导入 ✓');
    } catch (err) {
      showToast('导入失败:文件格式不正确');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ==================== 启动 ==================== */
render();
