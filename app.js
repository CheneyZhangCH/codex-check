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
};

let formName = '';
let formIcon = EMOJIS[0];
let formColor = PALETTE[0];
let toastTimer = null;

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
  saveState();
  render();
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
  const C = 2 * Math.PI * 52;

  let habitsHtml;
  if (state.habits.length === 0) {
    habitsHtml = `
      <div class="empty">
        <span class="empty-emoji">🌱</span>
        还没有习惯,先添加一个吧
      </div>`;
  } else {
    habitsHtml = state.habits.map((h) => {
      const on = isDone(key, h.id);
      const streak = habitStreak(h.id);
      const streakText = streak > 0 ? '🔥 连续 ' + streak + ' 天' : '今天还没开始';
      return `
        <div class="habit-row">
          <button class="habit-main" data-action="edit-habit" data-id="${h.id}" title="编辑习惯">
            <span class="habit-icon" style="background:${h.color}1a;color:${h.color}">${esc(h.icon)}</span>
            <span class="habit-info">
              <span class="habit-name">${esc(h.name)}</span>
              <span class="habit-streak">${streakText}</span>
            </span>
          </button>
          <button class="check ${on ? 'on' : ''}" data-action="toggle" data-id="${h.id}" data-date="${key}"
            style="${on ? `background:${h.color};border-color:${h.color}` : ''}" aria-label="${on ? '取消完成' : '标记完成'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7.5"/></svg>
          </button>
        </div>`;
    }).join('');
  }

  wrap.innerHTML = `
    <div class="hero">
      <div class="hero-ring">
        <svg class="ring" viewBox="0 0 120 120">
          <circle class="ring-bg" cx="60" cy="60" r="52"/>
          <circle class="ring-fg" cx="60" cy="60" r="52" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/>
          <text x="60" y="61" class="ring-num">${done}</text>
          <text x="60" y="80" class="ring-sub">/ ${total} 项</text>
        </svg>
      </div>
      <div class="hero-text">
        <h2>${d.getMonth() + 1}月${d.getDate()}日<span>星期${'日一二三四五六'[d.getDay()]}</span></h2>
        <p class="hero-desc">${
          total === 0
            ? '添加习惯,开始打卡吧 ✨'
            : pct === 1
              ? '太棒了,今天全部完成!🎉'
              : done === 0
                ? '今天还没有打卡,加油!'
                : `已完成 ${done}/${total},还差 ${total - done} 项`
        }</p>
      </div>
    </div>
    <div class="card list-card">${habitsHtml}</div>
    <div class="card add-card">
      <input id="new-habit-name" placeholder="想坚持什么?比如 早睡、拉伸…" maxlength="12" autocomplete="off">
      <button class="btn primary" data-action="open-new">＋ 添加习惯</button>
    </div>`;

  const quick = $('#new-habit-name');
  if (quick) {
    quick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openHabitForm('new');
    });
  }
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
        ${total > 0 ? `
          <span class="cal-frac">${done}/${total}</span>
          <span class="cal-bar"><i style="width:${(pct * 100).toFixed(0)}%"></i></span>` : ''}
      </button>`;
  }).join('');

  wrap.innerHTML = `
    <div class="cal-nav">
      <button class="icon-btn" data-action="prev-month" title="上个月">‹</button>
      <h2 class="cal-title">${y}年 ${m + 1}月</h2>
      <button class="icon-btn" data-action="next-month" title="下个月">›</button>
      <button class="btn ghost" data-action="goto-today">今天</button>
    </div>
    <div class="cal-dow">${WEEK_LABELS.map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>`;
}

function renderYear() {
  const wrap = $('#view-year');
  const y = view.ym.y;
  const cards = Array.from({ length: 12 }, (_, m) => {
    const rate = monthRate(y, m);
    const squares = monthDates(y, m).map(({ key, inMonth }) => {
      const { pct } = dayProgress(key);
      const a = 0.06 + pct * 0.8;
      return `<i class="sq ${inMonth ? '' : 'out'}" style="background:rgba(124,108,240,${a.toFixed(2)})"></i>`;
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
  }

  root.classList.toggle('hidden', !view.dayDetail && !view.habitForm);
}

function renderDayModal(body) {
  const d = parseKey(view.dayDetail);
  const { done, total } = dayProgress(view.dayDetail);
  const rows = state.habits.map((h) => {
    const on = isDone(view.dayDetail, h.id);
    return `
      <div class="day-row">
        <span class="day-icon" style="background:${h.color}1a">${esc(h.icon)}</span>
        <span class="day-name">${esc(h.name)}</span>
        <button class="check ${on ? 'on' : ''}" data-action="toggle" data-id="${h.id}" data-date="${view.dayDetail}"
          style="${on ? `background:${h.color};border-color:${h.color}` : ''}" aria-label="${on ? '取消完成' : '标记完成'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7.5"/></svg>
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
  const colorHtml = PALETTE.map((c) => `
    <button class="color-opt ${c === formColor ? 'sel' : ''}" data-action="pick-color" data-color="${c}"
      style="background:${c};color:${c}" aria-label="颜色"></button>
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

      <label class="field-label">颜色</label>
      <div class="color-row">${colorHtml}</div>

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

/* ==================== 交互 ==================== */
function setTab(mode) {
  view.mode = mode;
  switchView();
}

function openHabitForm(id) {
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
    updateHabit(view.habitForm, { name, icon: formIcon, color: formColor });
    showToast('已保存 ✓');
  }
  closeModal();
}

function deleteHabitFlow(id) {
  const h = getHabit(id);
  if (!h) return;
  if (confirm('确定删除「' + h.name + '」吗?它的历史打卡记录也会一并删除。')) {
    removeHabit(id);
    closeModal();
    showToast('已删除「' + h.name + '」');
  }
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
