/* 份子钱记账本 —— 纯前端单页应用，数据保存在浏览器 localStorage */
(function () {
  'use strict';

  /* ========== 工具 ========== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const money = n => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const sum = arr => arr.reduce((a, b) => a + (Number(b) || 0), 0);
  const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);
  const byDateAsc = (a, b) => -byDateDesc(a, b);
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  /* ========== 数据层 ========== */
  const KEY = 'fzq_data_v1';
  const DEFAULT_SETTINGS = {
    eventTypes: ['婚礼', '满月', '周岁', '升学', '乔迁', '生日', '丧事', '开业', '住院探望', '其他'],
    methods: ['现金', '微信', '支付宝', '银行转账', '礼品'],
    backupRemindDays: 30,
    returnRatio: 1.0
  };
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        d.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
        d.meta = d.meta || {};
        d.contacts = d.contacts || []; d.events = d.events || []; d.records = d.records || [];
        return d;
      }
    } catch (e) { console.error('读取数据失败', e); }
    return { contacts: [], events: [], records: [], settings: { ...DEFAULT_SETTINGS }, meta: { createdAt: Date.now() } };
  }
  function save() {
    state.meta.updatedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  const contactById = id => state.contacts.find(c => c.id === id);
  const eventById = id => state.events.find(e => e.id === id);
  const contactLabel = c => c ? (c.name + (c.unit || c.dept ? `（${[c.unit, c.dept].filter(Boolean).join('-')}）` : '')) : '（已删除）';
  const eventLabel = e => e ? e.title : '（未关联事由）';

  /* 同名检测：同名联系人存在时，显示带单位的名字 */
  function displayName(c) {
    if (!c) return '（已删除）';
    const dup = state.contacts.filter(x => x.name === c.name).length > 1;
    return dup ? contactLabel(c) : c.name;
  }

  /* ========== 统计核心 ========== */
  function recordsOf(filter = {}) {
    return state.records.filter(r =>
      (!filter.contactId || r.contactId === filter.contactId) &&
      (!filter.eventId || r.eventId === filter.eventId)
    );
  }
  function totals(recs) {
    const inn = recs.filter(r => r.direction === 'in');
    const out = recs.filter(r => r.direction === 'out');
    return { inAmt: sum(inn.map(r => r.amount)), outAmt: sum(out.map(r => r.amount)), inCnt: inn.length, outCnt: out.length, count: recs.length };
  }
  /* 单人往来差额：正数=我欠人情（应回礼），负数=对方欠我 */
  function balanceOf(contactId) {
    const t = totals(recordsOf({ contactId }));
    return t.inAmt - t.outAmt;
  }
  function groupBy(arr, keyFn) {
    const m = new Map();
    arr.forEach(x => { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return m;
  }

  /* ========== 弹窗 / 提示 ========== */
  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    $('#toastRoot').appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  function openModal(html) {
    closeModal();
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal">${html}</div>`;
    mask.addEventListener('mousedown', e => { if (e.target === mask) closeModal(); });
    $('#modalRoot').appendChild(mask);
    const first = $('input:not([type=hidden]),select,textarea', mask);
    if (first) setTimeout(() => first.focus(), 30);
    return mask;
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function confirmDialog(msg, onOk, okText = '确定', danger = true) {
    const m = openModal(`
      <h2>请确认</h2>
      <p>${msg}</p>
      <div class="actions">
        <button class="btn" data-cancel>取消</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${okText}</button>
      </div>`);
    $('[data-cancel]', m).onclick = closeModal;
    $('[data-ok]', m).onclick = () => { closeModal(); onOk(); };
  }

  /* 表单辅助 */
  const options = (list, sel, blank) => (blank ? `<option value="">${blank}</option>` : '') + list.map(v => `<option value="${esc(v.value ?? v)}" ${(v.value ?? v) === sel ? 'selected' : ''}>${esc(v.label ?? v)}</option>`).join('');
  function formData(form) {
    const o = {};
    new FormData(form).forEach((v, k) => o[k] = typeof v === 'string' ? v.trim() : v);
    return o;
  }

  /* ========== 联系人 表单 ========== */
  function contactForm(c = {}, onSaved) {
    const m = openModal(`
      <h2>${c.id ? '编辑联系人' : '新增联系人'}</h2>
      <form id="f" class="form-grid">
        <div class="field"><label>姓名 *</label><input name="name" required value="${esc(c.name)}"></div>
        <div class="field"><label>关系</label><input name="relation" list="relList" value="${esc(c.relation)}" placeholder="同事 / 亲戚 / 同学 / 朋友">
          <datalist id="relList">${['同事', '亲戚', '同学', '朋友', '邻居', '领导', '老乡'].map(v => `<option value="${v}">`).join('')}</datalist></div>
        <div class="field"><label>单位</label><input name="unit" list="unitList" value="${esc(c.unit)}">
          <datalist id="unitList">${[...new Set(state.contacts.map(x => x.unit).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>
        <div class="field"><label>科室 / 部门</label><input name="dept" list="deptList" value="${esc(c.dept)}">
          <datalist id="deptList">${[...new Set(state.contacts.map(x => x.dept).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>
        <div class="field"><label>电话</label><input name="phone" value="${esc(c.phone)}"></div>
        <div class="field full"><label>备注</label><textarea name="note">${esc(c.note)}</textarea></div>
      </form>
      <div class="actions">
        ${c.id ? '<button class="btn danger left" data-del>删除</button>' : ''}
        <button class="btn" data-cancel>取消</button>
        <button class="btn primary" data-ok>保存</button>
      </div>`);
    $('[data-cancel]', m).onclick = closeModal;
    const submit = () => {
      const f = $('#f', m); if (!f.reportValidity()) return;
      const d = formData(f);
      const dupe = state.contacts.find(x => x.id !== c.id && x.name === d.name && (x.unit || '') === d.unit && (x.dept || '') === d.dept);
      if (dupe && !confirm(`已存在同名同单位的联系人「${contactLabel(dupe)}」，仍要保存吗？`)) return;
      let obj;
      if (c.id) { obj = contactById(c.id); Object.assign(obj, d); }
      else { obj = { id: uid(), createdAt: Date.now(), ...d }; state.contacts.push(obj); }
      save(); closeModal(); toast('已保存'); onSaved && onSaved(obj); render();
    };
    $('[data-ok]', m).onclick = submit;
    $('#f', m).onsubmit = e => { e.preventDefault(); submit(); };
    if (c.id) $('[data-del]', m).onclick = () => deleteContact(c.id);
  }
  function deleteContact(id) {
    const n = recordsOf({ contactId: id }).length;
    confirmDialog(`删除联系人「${esc(contactLabel(contactById(id)))}」？${n ? `其关联的 <b>${n}</b> 条记录也会一并删除。` : ''}`, () => {
      state.contacts = state.contacts.filter(c => c.id !== id);
      state.records = state.records.filter(r => r.contactId !== id);
      state.events.forEach(e => { if (e.host === id) e.host = ''; });
      save(); toast('已删除'); location.hash = '#/contacts';
    });
  }

  /* ========== 事件 表单 ========== */
  function eventForm(ev = {}, onSaved) {
    const m = openModal(`
      <h2>${ev.id ? '编辑事由' : '新增事由'}</h2>
      <form id="f" class="form-grid">
        <div class="field full"><label>事由名称 *</label><input name="title" required value="${esc(ev.title)}" placeholder="如：张三儿子婚礼、我家乔迁"></div>
        <div class="field"><label>类型</label><select name="type">${options(state.settings.eventTypes, ev.type || state.settings.eventTypes[0])}</select></div>
        <div class="field"><label>日期 *</label><input type="date" name="date" required value="${esc(ev.date || today())}"></div>
        <div class="field"><label>谁的事</label>
          <select name="isMine"><option value="0" ${!ev.isMine ? 'selected' : ''}>别人办事（我送礼）</option><option value="1" ${ev.isMine ? 'selected' : ''}>我家办事（收礼）</option></select></div>
        <div class="field autocomplete"><label>主办人（可选）</label><input name="hostName" autocomplete="off" value="${esc(contactById(ev.host)?.name || '')}" placeholder="输入姓名联想"><input type="hidden" name="host" value="${esc(ev.host || '')}"><div class="hint">别人办事时填对方姓名，方便统计</div></div>
        <div class="field full"><label>地点</label><input name="place" value="${esc(ev.place)}"></div>
        <div class="field full"><label>备注</label><textarea name="note">${esc(ev.note)}</textarea></div>
      </form>
      <div class="actions">
        ${ev.id ? '<button class="btn danger left" data-del>删除</button>' : ''}
        <button class="btn" data-cancel>取消</button>
        <button class="btn primary" data-ok>保存</button>
      </div>`);
    bindContactAutocomplete($('[name=hostName]', m), $('[name=host]', m));
    $('[data-cancel]', m).onclick = closeModal;
    const submit = () => {
      const f = $('#f', m); if (!f.reportValidity()) return;
      const d = formData(f);
      d.isMine = d.isMine === '1';
      if (d.hostName && !d.host) {
        const found = state.contacts.find(c => c.name === d.hostName);
        if (found) d.host = found.id;
        else { const c = { id: uid(), name: d.hostName, unit: '', dept: '', createdAt: Date.now() }; state.contacts.push(c); d.host = c.id; toast(`已自动新建联系人「${d.hostName}」`); }
      }
      delete d.hostName;
      let obj;
      if (ev.id) { obj = eventById(ev.id); Object.assign(obj, d); }
      else { obj = { id: uid(), createdAt: Date.now(), ...d }; state.events.push(obj); }
      save(); closeModal(); toast('已保存'); onSaved && onSaved(obj); render();
    };
    $('[data-ok]', m).onclick = submit;
    $('#f', m).onsubmit = e => { e.preventDefault(); submit(); };
    if (ev.id) $('[data-del]', m).onclick = () => deleteEvent(ev.id);
  }
  function deleteEvent(id) {
    const n = recordsOf({ eventId: id }).length;
    confirmDialog(`删除事由「${esc(eventById(id)?.title)}」？${n ? `其下的 <b>${n}</b> 条记录也会一并删除。` : ''}`, () => {
      state.events = state.events.filter(e => e.id !== id);
      state.records = state.records.filter(r => r.eventId !== id);
      save(); toast('已删除'); location.hash = '#/events';
    });
  }

  /* ========== 记录 表单 ========== */
  function recordForm(r = {}, presets = {}) {
    const c = contactById(r.contactId || presets.contactId);
    const ev = eventById(r.eventId || presets.eventId);
    const dir = r.direction || presets.direction || (ev?.isMine ? 'in' : 'out');
    const evOptions = state.events.slice().sort(byDateDesc).map(e => ({ value: e.id, label: `${e.date}  ${e.title}` }));
    const m = openModal(`
      <h2>${r.id ? '编辑记录' : '记一笔'}</h2>
      <form id="f" class="form-grid">
        <div class="field full"><label>方向</label>
          <div class="seg">
            <label class="${dir === 'in' ? 'in-sel' : ''}"><input type="radio" name="direction" value="in" ${dir === 'in' ? 'checked' : ''}>收：对方给我</label>
            <label class="${dir === 'out' ? 'out-sel' : ''}"><input type="radio" name="direction" value="out" ${dir === 'out' ? 'checked' : ''}>送：我给对方</label>
          </div></div>
        <div class="field autocomplete"><label>对方姓名 *</label><input name="contactName" required autocomplete="off" value="${esc(c?.name || presets.contactName || '')}" placeholder="输入姓名，自动联想；多人用逗号分开"><input type="hidden" name="contactId" value="${esc(c?.id || '')}"><div class="hint" id="cHint">${c ? esc([c.unit, c.dept, c.relation].filter(Boolean).join(' · ')) : '新姓名会自动创建联系人；多人用逗号分开，如：张三，李四，王五'}</div></div>
        <div class="field"><label>金额（元）*</label><input type="number" name="amount" required min="0" step="0.01" value="${esc(r.amount ?? presets.amount ?? '')}" placeholder="0"><div class="hint" id="refHint"></div></div>
        <div class="field"><label>单位</label><input name="unit" list="recUnitList" autocomplete="off" value="${esc(c ? (c.unit || '') : (presets.unit || ''))}" placeholder="可手输，点空白处或按 ↓ 选已有单位"><datalist id="recUnitList">${unitOptions()}</datalist></div>
        <div class="field"><label>科室 / 部门</label><input name="dept" list="recDeptList" autocomplete="off" value="${esc(c ? (c.dept || '') : (presets.dept || ''))}" placeholder="可手输，或选该单位已有科室"><datalist id="recDeptList">${deptOptions(c ? c.unit : presets.unit)}</datalist></div>
        <div class="field full"><label>事由 *</label>
          <div style="display:flex;gap:8px"><select name="eventId" required style="flex:1">${options(evOptions, ev?.id, '请选择事由…')}</select><button type="button" class="btn" id="newEv">＋新事由</button></div></div>
        <div class="field"><label>日期 *</label><input type="date" name="date" required value="${esc(r.date || presets.date || ev?.date || today())}"></div>
        <div class="field"><label>方式</label><select name="method">${options(state.settings.methods, r.method || presets.method || state.settings.methods[0])}</select></div>
        <div class="field full"><label>礼品说明 / 备注</label><input name="note" value="${esc(r.note || presets.note || '')}" placeholder="如：另送一箱牛奶；随礼名单第 3 位"></div>
      </form>
      <div class="actions">
        ${r.id ? '<button class="btn danger left" data-del>删除</button>' : ''}
        <button class="btn" data-cancel>取消</button>
        ${r.id ? '' : '<button class="btn" data-more title="保存后只清空姓名，其余内容沿用">保存并继续</button>'}
        <button class="btn primary" data-ok>保存</button>
      </div>`);
    const f = $('#f', m);
    setTimeout(() => $('[name=contactName]', m).focus(), 40);
    $('[name=unit]', m).addEventListener('input', () => { $('#recDeptList', m).innerHTML = deptOptions($('[name=unit]', m).value.trim()); });
    // 方向切换样式
    $$('.seg input', m).forEach(inp => inp.onchange = () => {
      $$('.seg label', m).forEach(l => l.className = '');
      inp.parentElement.className = inp.value === 'in' ? 'in-sel' : 'out-sel';
      updateRef();
    });
    // 事由改变时同步日期与方向
    $('[name=eventId]', m).onchange = e => {
      const evx = eventById(e.target.value);
      if (evx) {
        if (!r.id) $('[name=date]', m).value = evx.date;
        const d = evx.isMine ? 'in' : 'out';
        const radio = $(`.seg input[value=${d}]`, m); if (radio && !radio.checked) { radio.checked = true; radio.onchange(); }
      }
    };
    $('#newEv', m).onclick = () => {
      const snapshot = formData(f);
      eventForm({}, created => recordForm(r, { ...presets, ...snapshot, eventId: created.id }));
    };
    const updateRef = () => {
      const cid = $('[name=contactId]', m).value; const hint = $('#refHint', m);
      if (!cid) { hint.textContent = ''; return; }
      const recs = recordsOf({ contactId: cid }).sort(byDateDesc);
      const dirNow = $('.seg input:checked', m).value;
      const lastOpp = recs.find(x => x.direction !== dirNow);
      const bal = balanceOf(cid);
      let txt = '';
      if (lastOpp) txt += `上次${lastOpp.direction === 'in' ? '对方给我' : '我给对方'} ${money(lastOpp.amount)} 元（${lastOpp.date}）。`;
      if (bal > 0) txt += `目前我欠对方人情 ${money(bal)} 元。`; else if (bal < 0) txt += `目前对方欠我人情 ${money(-bal)} 元。`;
      if (dirNow === 'out' && lastOpp && state.settings.returnRatio) txt += ` 参考回礼：${money(Math.round(lastOpp.amount * state.settings.returnRatio))} 元。`;
      hint.textContent = txt;
    };
    bindContactAutocomplete($('[name=contactName]', m), $('[name=contactId]', m), cc => {
      const names = splitNames($('[name=contactName]', m).value);
      if (names.length > 1) {
        // 多人模式：单位科室对所有新人生效，提示将生成几条记录
        if (!r.id) { const newOnes = names.filter(n => !state.contacts.some(x => x.name === n)); $('#cHint', m).textContent = `将为 ${names.length} 人各记一笔${newOnes.length ? `，其中新建联系人：${newOnes.join('、')}` : ''}`; }
        else $('#cHint', m).textContent = '编辑记录时只能填一个人';
        $('#refHint', m).textContent = ''; return;
      }
      // 选中已有联系人时带出其单位科室；输入新姓名时回落到本次批量录入沿用的单位科室
      $('[name=unit]', m).value = cc ? (cc.unit || '') : (presets.unit || ''); $('[name=dept]', m).value = cc ? (cc.dept || '') : (presets.dept || '');
      $('#cHint', m).textContent = cc ? [cc.unit, cc.dept, cc.relation].filter(Boolean).join(' · ') || '已有联系人' : '新姓名会自动创建联系人；多人用逗号分开，如：张三，李四，王五';
      updateRef();
    });
    updateRef();
    $('[data-cancel]', m).onclick = closeModal;
    const submit = (cont) => {
      if (!f.reportValidity()) return;
      const d = formData(f);
      const names = splitNames(d.contactName);
      if (!names.length) return toast('请填写姓名', true);
      if (r.id && names.length > 1) return toast('编辑记录时只能填一个人', true);
      const base = { eventId: d.eventId, direction: d.direction, amount: Number(d.amount), date: d.date, method: d.method, note: d.note };
      if (r.id) Object.assign(state.records.find(x => x.id === r.id), { ...base, contactId: resolveContact(names[0], d.unit, d.dept, d.contactId) });
      else {
        const before = state.contacts.length;
        names.forEach(n => state.records.push({ id: uid(), createdAt: Date.now(), ...base, contactId: resolveContact(n, d.unit, d.dept, names.length === 1 ? d.contactId : '', { quiet: names.length > 1 }) }));
        const created = state.contacts.length - before;
        if (names.length > 1) toast(`已为 ${names.length} 人各记一笔${created ? `，新建 ${created} 位联系人` : ''}`);
      }
      save(); if (names.length === 1) toast('已保存'); render();
      if (cont) recordForm({}, { eventId: d.eventId, direction: d.direction, amount: d.amount, date: d.date, method: d.method, note: d.note, unit: d.unit, dept: d.dept }); else closeModal();
    };
    $('[data-ok]', m).onclick = () => submit(false);
    f.onsubmit = e => { e.preventDefault(); submit(false); };
    if (!r.id) $('[data-more]', m).onclick = () => submit(true);
    if (r.id) $('[data-del]', m).onclick = () => deleteRecord(r.id);
  }
  /* 已有单位 / 科室的下拉选项（datalist）；科室按所填单位过滤，单位为空或无匹配时列出全部 */
  const uniqSorted = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
  const unitOptions = () => uniqSorted(state.contacts.map(c => c.unit)).map(u => `<option value="${esc(u)}">`).join('');
  function deptOptions(unit) {
    const inUnit = unit ? uniqSorted(state.contacts.filter(c => c.unit === unit).map(c => c.dept)) : [];
    const list = inUnit.length ? inUnit : uniqSorted(state.contacts.map(c => c.dept));
    return list.map(d => `<option value="${esc(d)}">`).join('');
  }
  /* 按姓名 + 单位 + 科室找到已有联系人，找不到则新建；返回 contactId */
  function resolveContact(name, unit = '', dept = '', knownId = '', opts = {}) {
    let cid = knownId;
    if (cid && contactById(cid)?.name !== name) cid = '';
    if (!cid) {
      const exact = state.contacts.filter(x => x.name === name);
      const match = exact.find(x => (x.unit || '') === unit && (x.dept || '') === dept) || (exact.length === 1 ? exact[0] : null);
      if (match) cid = match.id;
      else { const nc = { id: uid(), name, unit, dept, createdAt: Date.now() }; state.contacts.push(nc); cid = nc.id; if (!opts.quiet) toast(`已新建联系人「${name}」`); }
    }
    const cc = contactById(cid);
    if (unit && !cc.unit) cc.unit = unit;
    if (dept && !cc.dept) cc.dept = dept;
    return cid;
  }
  function deleteRecord(id) {
    confirmDialog('删除这条记录？', () => { state.records = state.records.filter(x => x.id !== id); save(); closeModal(); toast('已删除'); render(); });
  }

  /* 多人姓名分隔：中英文逗号、顿号、分号、斜杠、空格 */
  const NAME_SEP_RE = /[，,、;；/／\s]+/;
  const splitNames = s => [...new Set(String(s || '').split(NAME_SEP_RE).map(x => x.trim()).filter(Boolean))];

  /* 姓名联想 */
  function bindContactAutocomplete(input, hidden, onPick) {
    let list = null, idx = -1, items = [];
    const close = () => { list && list.remove(); list = null; idx = -1; };
    // 多人模式（含逗号）时只对最后一段联想，选中后替换最后一段
    const lastSeg = () => { const parts = input.value.split(NAME_SEP_RE); return parts[parts.length - 1].trim(); };
    const pick = c => {
      const parts = input.value.split(NAME_SEP_RE);
      if (parts.length > 1) { parts[parts.length - 1] = c.name; input.value = parts.map(x => x.trim()).filter(Boolean).join('，'); hidden.value = ''; }
      else { input.value = c.name; hidden.value = c.id; }
      close(); onPick && onPick(parts.length > 1 ? null : c);
    };
    input.addEventListener('input', () => {
      hidden.value = ''; onPick && onPick(null);
      const q = lastSeg().toLowerCase();
      close();
      if (!q) return;
      items = state.contacts.filter(c => (c.name + (c.unit || '') + (c.dept || '')).toLowerCase().includes(q)).slice(0, 8);
      if (!items.length) return;
      list = document.createElement('div'); list.className = 'ac-list';
      list.innerHTML = items.map((c, i) => `<div data-i="${i}">${esc(c.name)}<small>${esc([c.unit, c.dept, c.relation].filter(Boolean).join(' · '))}</small></div>`).join('');
      list.onmousedown = e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); pick(items[d.dataset.i]); } };
      input.parentElement.appendChild(list);
    });
    input.addEventListener('keydown', e => {
      if (!list) return;
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, items.length - 1); }
      else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); }
      else if (e.key === 'Enter') { if (idx >= 0) { e.preventDefault(); pick(items[idx]); } return; }
      else return;
      e.preventDefault();
      $$('div', list).forEach((d, i) => d.classList.toggle('active', i === idx));
    });
    input.addEventListener('blur', () => setTimeout(() => {
      // 失焦时如果输入恰好等于唯一联系人姓名，自动匹配
      if (!hidden.value && !NAME_SEP_RE.test(input.value)) { const ex = state.contacts.filter(c => c.name === input.value.trim()); if (ex.length === 1) { hidden.value = ex[0].id; onPick && onPick(ex[0]); } }
      close();
    }, 150));
  }

  /* ========== 语音 / 文字批量录入 ========== */
  const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const CN_UNIT = { 十: 10, 百: 100, 千: 1000 };
  /* 中文数字 → 数值：支持 六百、一千二（=1200）、八百八（=880）、两千、一万二、1千2、六百六十六 */
  function cnToNumber(str) {
    const s = String(str).replace(/[0-9０-９]/g, ch => '零一二三四五六七八九'[ch.charCodeAt(0) & 15]);
    let total = 0, section = 0, cur = 0, lastUnit = 0;
    for (const ch of s) {
      if (ch in CN_DIGIT) cur = cur * 10 + CN_DIGIT[ch];
      else if (ch === '万') { section = (section + cur) * 10000; total += section; section = 0; cur = 0; lastUnit = 10000; }
      else if (ch in CN_UNIT) { const u = CN_UNIT[ch]; section += (cur || 1) * u; cur = 0; lastUnit = u; }
    }
    if (cur) {
      if (lastUnit === 10000 && cur < 10) section += cur * 1000;      // 一万二 → 12000
      else if (lastUnit > 10 && cur < 10) section += cur * (lastUnit / 10); // 一千二 → 1200，八百八 → 880
      else section += cur;
    }
    return total + section;
  }
  const AMOUNT_SUFFIX = '(?:元|块钱|块|钱)?';
  /* 从一句话里提取金额；返回 { amount, rest }（rest 为去掉金额后的文本） */
  function extractAmount(text) {
    // 1) 阿拉伯数字：600、600元、1200块、1千2、2千、1.5万
    let m = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)([千百万]\\d*)?\\s*${AMOUNT_SUFFIX}`));
    if (m) {
      let amount;
      if (m[2]) {
        const unitCh = m[2][0], tail = m[2].slice(1);
        amount = Number(m[1]) * ({ 百: 100, 千: 1000, 万: 10000 }[unitCh]);
        if (tail) amount += Number(tail) * ({ 百: 10, 千: 100, 万: 1000 }[unitCh]);
      } else amount = Number(m[1]);
      return { amount, rest: text.replace(m[0], ' ') };
    }
    // 2) 中文数字：必须带 百/千/万 或 元/块/钱 后缀，避免把「张三」「王五」里的数字当金额
    const re = new RegExp(`([零〇一二两三四五六七八九十百千万]+)\\s*${AMOUNT_SUFFIX}`, 'g');
    let best = null;
    while ((m = re.exec(text))) {
      let run = m[1];
      const hasUnit = /[百千万]/.test(run), hasSuffix = m[0].length > run.length;
      if (!hasUnit && !hasSuffix) continue;
      // 「王五五百」这类：单位前只允许一个数字，多出的前导数字视为姓名的一部分
      const ui = run.search(/[十百千万]/);
      let leading = '';
      if (ui > 1) { leading = run.slice(0, ui - 1); run = run.slice(ui - 1); }
      const amount = cnToNumber(run);
      if (amount > 0) { best = { amount, matched: m[0], leading, index: m.index }; break; }
    }
    if (best) return { amount: best.amount, rest: text.slice(0, best.index) + best.leading + ' ' + text.slice(best.index + best.matched.length) };
    return { amount: null, rest: text };
  }
  const METHOD_WORDS = [['微信', '微信'], ['支付宝', '支付宝'], ['现金', '现金'], ['转账', '银行转账'], ['银行', '银行转账'], ['刷卡', '银行转账'], ['礼品', '礼品'], ['实物', '礼品'], ['东西', '礼品']];
  const FILLER_RE = /给了我|送给我|送给了|送给|给我|送我|给了|送了|随了|随礼|收到了|收到|收了|礼金|份子钱|份子|人民币|一共|总共|的|了|是|他|她|我/g;
  const DEPT_SUFFIX = '(?:科室|科|室|部门|部|处|办公室|办|中心|车间|班组|组|队|院|局|所|站|公司|集团|学校|医院|银行|中学|小学|大学|厂)';
  const SPLIT_RE = /[，,。；;、\n]+|然后|接着|还有|另外|再来|以及/;
  /* 把一句话解析为一条记录草稿 */
  function parseClause(raw, defaults) {
    let text = raw.trim();
    if (!text) return null;
    const row = { raw, name: '', unit: defaults.unit || '', dept: defaults.dept || '', amount: null, method: defaults.method, direction: defaults.direction, note: '', contactId: '', hints: [] };
    // 方向关键词
    if (/给我|送我|收到|收了|我收/.test(text)) row.direction = 'in';
    else if (/我给|给他|给她|送他|送她|我送|随了/.test(text)) row.direction = 'out';
    // 支付方式
    for (const [w, mth] of METHOD_WORDS) { if (text.includes(w)) { row.method = state.settings.methods.includes(mth) ? mth : state.settings.methods[0]; text = text.replace(w, ' '); break; } }
    // 已有联系人（按名字长度倒序，先匹配长名字）
    const known = state.contacts.slice().sort((a, b) => b.name.length - a.name.length).find(c => c.name.length >= 2 && text.includes(c.name));
    if (known) { row.name = known.name; row.contactId = known.id; row.unit = known.unit || ''; row.dept = known.dept || ''; text = text.replace(known.name, ' '); }
    // 金额
    const a = extractAmount(text); row.amount = a.amount; text = a.rest;
    // 备注：括号内容
    const noteM = text.match(/[（(]([^（）()]+)[）)]/); if (noteM) { row.note = noteM[1].trim(); text = text.replace(noteM[0], ' '); }
    // 去掉口语填充词后按空格切词
    text = text.replace(FILLER_RE, ' ').replace(/[^一-龥A-Za-z0-9·\s]/g, ' ');
    let tokens = text.split(/\s+/).filter(Boolean);
    const knownUnits = [...new Set(state.contacts.map(c => c.unit).filter(Boolean))].sort((x, y) => y.length - x.length);
    const knownDepts = [...new Set(state.contacts.map(c => c.dept).filter(Boolean))].sort((x, y) => y.length - x.length);
    const rest = [];
    for (let t of tokens) {
      // 单位/科室与姓名连在一起：心内科张三 / 张三心内科
      if (!known && !row.name && t.length > 4) {
        let mm = t.match(new RegExp(`^(.+?${DEPT_SUFFIX})([\\u4e00-\\u9fa5]{2,4})$`));
        if (mm) { rest.push(mm[1]); t = mm[2]; }
        else if ((mm = t.match(new RegExp(`^([\\u4e00-\\u9fa5]{2,3})(.+${DEPT_SUFFIX})$`)))) { rest.push(mm[2]); t = mm[1]; }
      }
      const ku = knownUnits.find(u => t === u || t.includes(u)), kd = knownDepts.find(d => t === d || t.includes(d));
      if (ku && !kd) { row.unit = ku; continue; }
      if (kd && !ku) { row.dept = kd; continue; }
      if (ku && kd) { row.unit = ku; row.dept = kd; continue; }
      rest.push(t);
    }
    for (const t of rest) {
      if (!row.name && !known && /^[一-龥·]{2,4}$/.test(t) && !new RegExp(`${DEPT_SUFFIX}$`).test(t)) { row.name = t; continue; }
      if (new RegExp(`${DEPT_SUFFIX}$`).test(t) && !/(公司|集团|学校|医院|银行|中学|小学|大学|厂|局|院)$/.test(t)) { if (!row.dept || row.dept === defaults.dept) row.dept = t; else row.note = [row.note, t].filter(Boolean).join(' '); }
      else if (/(公司|集团|学校|医院|银行|中学|小学|大学|厂|局|院)$/.test(t)) { if (!row.unit || row.unit === defaults.unit) row.unit = t; else row.note = [row.note, t].filter(Boolean).join(' '); }
      else if (!row.name && !known) row.name = t;
      else if (t.length > 6) row.note = [row.note, t].filter(Boolean).join(' ');
      else if (!row.unit) row.unit = t;
      else if (!row.dept) row.dept = t;
      else row.note = [row.note, t].filter(Boolean).join(' ');
    }
    if (!row.contactId && row.name) {
      const exact = state.contacts.filter(c => c.name === row.name);
      const match = exact.find(c => (c.unit || '') === row.unit && (c.dept || '') === row.dept) || (exact.length === 1 ? exact[0] : null);
      if (match) { row.contactId = match.id; if (!row.unit) row.unit = match.unit || ''; if (!row.dept) row.dept = match.dept || ''; }
    }
    if (!row.name) row.hints.push('没听出姓名');
    if (row.amount == null) row.hints.push('没听出金额');
    return row;
  }
  function parseBatchText(text, defaults) {
    return text.split(SPLIT_RE).map(s => parseClause(s, defaults)).filter(Boolean);
  }

  function voiceBatchForm(presets = {}) {
    if (!state.events.length) { toast('请先新增一个事由'); return eventForm({}, created => voiceBatchForm({ ...presets, eventId: created.id })); }
    const evOptions = state.events.slice().sort(byDateDesc).map(e => ({ value: e.id, label: `${e.date}  ${e.title}` }));
    const ev0 = eventById(presets.eventId) || state.events.slice().sort(byDateDesc)[0];
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const m = openModal(`
      <h2>🎤 语音 / 文字批量录入</h2>
      <form id="vf" class="form-grid" onsubmit="return false">
        <div class="field full"><label>事由 *</label><select name="eventId">${options(evOptions, ev0.id)}</select></div>
        <div class="field"><label>方向</label><select name="direction"><option value="in" ${(presets.direction || (ev0.isMine ? 'in' : 'out')) === 'in' ? 'selected' : ''}>收：对方给我</option><option value="out" ${(presets.direction || (ev0.isMine ? 'in' : 'out')) === 'out' ? 'selected' : ''}>送：我给对方</option></select></div>
        <div class="field"><label>默认方式</label><select name="method">${options(state.settings.methods, presets.method || state.settings.methods[0])}</select></div>
        <div class="field"><label>默认单位（可空）</label><input name="unit" value="${esc(presets.unit || '')}" placeholder="这一批人多数来自的单位"></div>
        <div class="field"><label>默认科室（可空）</label><input name="dept" value="${esc(presets.dept || '')}"></div>
        <div class="field full"><label>一人一句，用逗号或换行分开。可以说：「张三 心内科 600 微信」「王五五百块现金」「赵六 一千二 转账（老同学）」</label>
          <textarea name="text" rows="5" placeholder="点击下方话筒开始说话，或直接在这里打字 / 用手机键盘的话筒听写…">${esc(presets.text || '')}</textarea>
          <div class="hint" id="interim"></div></div>
      </form>
      <div id="vstage1" class="actions" style="justify-content:space-between">
        <div class="btn-row">${SR ? '<button class="btn" id="micBtn">🎤 开始听写</button>' : '<span class="c-muted" style="font-size:13px">此浏览器不支持网页语音，请用 Edge / Chrome，或在手机上点输入框用键盘话筒</span>'}<span class="c-muted" id="micHint" style="font-size:12px"></span></div>
        <div class="btn-row"><button class="btn" data-cancel>取消</button><button class="btn primary" id="parseBtn">解析 →</button></div>
      </div>
      <div id="vstage2" style="display:none">
        <h3 style="margin-top:14px">请核对（可直接修改单元格，× 删除误识别）</h3>
        <div class="table-wrap"><table class="vtable"><thead><tr><th>姓名</th><th>单位</th><th>科室</th><th class="num">金额</th><th>方式</th><th>方向</th><th>备注</th><th>状态</th><th></th></tr></thead><tbody id="vrows"></tbody></table></div>
        <div class="actions" style="justify-content:space-between"><button class="btn" id="backBtn">← 返回修改</button><div class="btn-row"><span class="c-muted" id="vsum"></span><button class="btn primary" id="saveBtn">确认保存</button></div></div>
      </div>`);
    const f = $('#vf', m), ta = $('[name=text]', m), micBtn = $('#micBtn', m), micHint = $('#micHint', m);
    $('.modal', m).classList.add('wide');
    $('[data-cancel]', m).onclick = () => { stop(); closeModal(); };
    // 事由变化 → 方向跟随
    $('[name=eventId]', m).onchange = e => { const evx = eventById(e.target.value); if (evx) $('[name=direction]', m).value = evx.isMine ? 'in' : 'out'; };

    /* --- 听写 --- */
    let recog = null, listening = false;
    const setMic = () => { if (micBtn) { micBtn.textContent = listening ? '■ 停止听写' : '🎤 开始听写'; micBtn.classList.toggle('primary', listening); } };
    const stop = () => { if (recog) { try { recog.stop(); } catch (e) { } } listening = false; recog = null; setMic(); $('#interim', m).textContent = ''; };
    const start = () => {
      try {
        recog = new SR(); recog.lang = 'zh-CN'; recog.continuous = true; recog.interimResults = true;
        recog.onresult = e => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) { const t = r[0].transcript.trim(); if (t) ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n' : '') + t; ta.scrollTop = ta.scrollHeight; }
            else interim += r[0].transcript;
          }
          $('#interim', m).textContent = interim ? '正在识别：' + interim : '';
        };
        recog.onerror = e => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('麦克风被禁用了，请在浏览器地址栏左侧允许使用麦克风', true);
          else if (e.error === 'network') { toast('网页语音服务连不上（Chrome 在国内常见），请改用 Edge 浏览器打开，或直接打字', true); micHint.textContent = '建议用 Edge 浏览器，其语音服务在国内可用'; }
          else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('语音识别出错：' + e.error, true);
          stop();
        };
        recog.onend = () => { if (listening) { try { recog.start(); } catch (e) { stop(); } } }; // 长时间静音后自动续上
        recog.start(); listening = true; setMic(); micHint.textContent = '请说话，说完一个人停顿一下';
      } catch (err) { toast('无法启动语音识别：' + err.message, true); stop(); }
    };
    if (micBtn) micBtn.onclick = () => listening ? stop() : start();

    /* --- 解析 → 核对表 --- */
    const dirOpts = d => `<option value="in" ${d === 'in' ? 'selected' : ''}>收</option><option value="out" ${d === 'out' ? 'selected' : ''}>送</option>`;
    const renderRows = rows => {
      $('#vrows', m).innerHTML = rows.length ? rows.map((r, i) => {
        const cc = contactById(r.contactId);
        const dupInEvent = r.contactId && recordsOf({ eventId: f.eventId.value, contactId: r.contactId }).length;
        const status = r.hints.length ? `<span class="c-danger">${r.hints.join('，')}</span>` : cc ? `<span class="c-muted">已有联系人</span>${dupInEvent ? '<br><span class="c-warn">本事由已有其记录</span>' : ''}` : '<span class="tag">新建联系人</span>';
        return `<tr data-i="${i}" title="${esc(r.raw)}">
          <td><input name="name" value="${esc(r.name)}" style="width:80px"></td>
          <td><input name="unit" value="${esc(r.unit)}" style="width:110px"></td>
          <td><input name="dept" value="${esc(r.dept)}" style="width:90px"></td>
          <td><input name="amount" type="number" min="0" step="0.01" value="${r.amount ?? ''}" style="width:80px;text-align:right"></td>
          <td><select name="method">${options(state.settings.methods, r.method)}</select></td>
          <td><select name="direction">${dirOpts(r.direction)}</select></td>
          <td><input name="note" value="${esc(r.note)}" style="width:110px"></td>
          <td style="font-size:12px;white-space:normal;max-width:120px">${status}</td>
          <td><button class="btn link sm" data-rm="${i}">×</button></td></tr>`;
      }).join('') : '<tr><td colspan="9" class="empty">没有解析出内容，请返回换个说法或直接打字</td></tr>';
      $('#vsum', m).textContent = `${rows.length} 条`;
      $$('[data-rm]', m).forEach(b => b.onclick = () => { rows.splice(Number(b.dataset.rm), 1); renderRows(rows); });
    };
    let rows = [];
    $('#parseBtn', m).onclick = () => {
      stop();
      const text = ta.value.trim();
      if (!text) return toast('请先说话或输入内容', true);
      rows = parseBatchText(text, { unit: f.unit.value.trim(), dept: f.dept.value.trim(), method: f.method.value, direction: f.direction.value });
      renderRows(rows);
      $('#vstage1', m).style.display = 'none'; f.style.display = 'none'; $('#vstage2', m).style.display = '';
      $('h2', m).textContent = `核对 · ${eventById(f.eventId.value)?.title || ''}`;
    };
    $('#backBtn', m).onclick = () => { $('#vstage1', m).style.display = ''; f.style.display = ''; $('#vstage2', m).style.display = 'none'; $('h2', m).textContent = '🎤 语音 / 文字批量录入'; };
    $('#saveBtn', m).onclick = () => {
      const ev = eventById(f.eventId.value);
      const trs = $$('#vrows tr[data-i]', m);
      const items = trs.map(tr => ({ name: tr.querySelector('[name=name]').value.trim(), unit: tr.querySelector('[name=unit]').value.trim(), dept: tr.querySelector('[name=dept]').value.trim(), amount: Number(tr.querySelector('[name=amount]').value), method: tr.querySelector('[name=method]').value, direction: tr.querySelector('[name=direction]').value, note: tr.querySelector('[name=note]').value.trim(), contactId: rows[Number(tr.dataset.i)]?.contactId || '' }));
      const bad = items.filter(x => !x.name || !(x.amount > 0));
      if (!items.length) return toast('没有可保存的内容', true);
      if (bad.length) return toast(`有 ${bad.length} 条缺少姓名或金额，请补全或删除`, true);
      let created = 0;
      items.forEach(x => {
        const before = state.contacts.length;
        const cid = resolveContact(x.name, x.unit, x.dept, x.contactId, { quiet: true });
        if (state.contacts.length > before) created++;
        state.records.push({ id: uid(), createdAt: Date.now(), contactId: cid, eventId: ev.id, direction: x.direction, amount: x.amount, date: ev.date, method: x.method, note: x.note });
      });
      save(); closeModal(); render();
      toast(`已保存 ${items.length} 条记录${created ? `，新建 ${created} 位联系人` : ''}`);
    };
  }

  /* ========== 路由 ========== */
  function route() {
    const h = location.hash.replace(/^#\/?/, '') || 'home';
    const [page, id] = h.split('/');
    return { page, id };
  }
  function render() {
    const { page, id } = route();
    $$('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === page));
    const view = $('#view');
    const pages = { home: pageHome, records: pageRecords, events: id ? () => pageEventDetail(id) : pageEvents, contacts: id ? () => pageContactDetail(id) : pageContacts, stats: pageStats, settings: pageSettings };
    view.innerHTML = (pages[page] || pageHome)();
    window.scrollTo(0, 0);
  }

  /* 通用行内事件绑定：data-act（只绑定一次，事件委托） */
  function bindPage(view) {
    view.addEventListener('click', e => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      const { act, id } = el.dataset;
      if (act === 'edit-record') recordForm(state.records.find(r => r.id === id));
      else if (act === 'add-record') {
        const presets = { eventId: el.dataset.event, contactId: el.dataset.contact, direction: el.dataset.dir };
        if (!state.events.length) { toast('请先新增一个事由'); eventForm({}, created => recordForm({}, { ...presets, eventId: created.id })); }
        else recordForm({}, presets);
      }
      else if (act === 'voice-add') voiceBatchForm({ eventId: el.dataset.event, direction: el.dataset.dir });
      else if (act === 'edit-contact') contactForm(contactById(id));
      else if (act === 'add-contact') contactForm();
      else if (act === 'edit-event') eventForm(eventById(id));
      else if (act === 'add-event') eventForm();
      else if (act === 'del-record') deleteRecord(id);
      else if (act === 'toggle') { const t = $$('[data-group]', view).find(x => x.dataset.group === el.dataset.target); if (t) t.style.display = t.style.display === 'none' ? '' : 'none'; }
      else if (act === 'print') window.print();
      else if (act === 'export-event-csv') exportEventCsv(id);
    });
  }

  /* ========== 记录表格（复用） ========== */
  function recordsTable(recs, opts = {}) {
    if (!recs.length) return `<div class="empty">暂无记录</div>`;
    const cols = Object.assign({ date: 1, contact: 1, unit: 1, event: 1, dir: 1, amount: 1, method: 1, note: 1, ops: 1 }, opts.cols || {});
    const sortKey = opts.sortKey, sortDir = opts.sortDir;
    const th = (k, label, cls = '') => cols[k] ? `<th class="${cls} ${opts.sortable ? 'sortable' : ''}" data-sort="${k}">${label}${sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</th>` : '';
    return `<div class="table-wrap"><table>
      <thead><tr>${th('date', '日期')}${th('contact', '姓名')}${th('unit', '单位/科室')}${th('event', '事由')}${th('dir', '方向')}${th('amount', '金额', 'num')}${th('method', '方式')}${cols.note ? '<th>备注</th>' : ''}${cols.ops ? '<th class="no-print"></th>' : ''}</tr></thead>
      <tbody>${recs.map(r => {
        const c = contactById(r.contactId), ev = eventById(r.eventId);
        return `<tr>
          ${cols.date ? `<td>${esc(r.date)}</td>` : ''}
          ${cols.contact ? `<td><a href="#/contacts/${r.contactId}">${esc(displayName(c))}</a></td>` : ''}
          ${cols.unit ? `<td class="c-muted">${esc([c?.unit, c?.dept].filter(Boolean).join(' / ') || '—')}</td>` : ''}
          ${cols.event ? `<td><a href="#/events/${r.eventId}">${esc(eventLabel(ev))}</a></td>` : ''}
          ${cols.dir ? `<td><span class="tag ${r.direction}">${r.direction === 'in' ? '收' : '送'}</span></td>` : ''}
          ${cols.amount ? `<td class="num ${r.direction === 'in' ? 'c-in' : 'c-out'}"><b>${r.direction === 'in' ? '+' : '-'}${money(r.amount)}</b></td>` : ''}
          ${cols.method ? `<td class="c-muted">${esc(r.method || '')}</td>` : ''}
          ${cols.note ? `<td class="wrap c-muted">${esc(r.note || '')}</td>` : ''}
          ${cols.ops ? `<td class="no-print"><button class="btn link sm" data-act="edit-record" data-id="${r.id}">编辑</button></td>` : ''}
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }
  function statCards(t, labels = {}) {
    const net = t.inAmt - t.outAmt;
    return `<div class="grid grid-4">
      <div class="stat"><div class="label">${labels.inn || '收到（对方给我）'}</div><div class="value c-in">${money(t.inAmt)}</div><div class="sub">${t.inCnt} 笔</div></div>
      <div class="stat"><div class="label">${labels.out || '送出（我给对方）'}</div><div class="value c-out">${money(t.outAmt)}</div><div class="sub">${t.outCnt} 笔</div></div>
      <div class="stat"><div class="label">${labels.net || '净额（收 − 送）'}</div><div class="value ${net >= 0 ? 'c-in' : 'c-out'}">${net >= 0 ? '+' : '-'}${money(Math.abs(net))}</div><div class="sub">${labels.netSub || ''}</div></div>
      <div class="stat"><div class="label">${labels.cnt || '总笔数'}</div><div class="value">${t.count}</div><div class="sub">${labels.cntSub || ''}</div></div>
    </div>`;
  }

  /* ========== 页面：总览 ========== */
  function pageHome() {
    const year = new Date().getFullYear();
    const yearRecs = state.records.filter(r => (r.date || '').startsWith(year));
    const ty = totals(yearRecs), ta = totals(state.records);
    const recent = state.records.slice().sort(byDateDesc).slice(0, 10);
    // 待回礼：对方给我多于我给对方的人
    const owe = state.contacts.map(c => ({ c, bal: balanceOf(c.id), last: recordsOf({ contactId: c.id }).sort(byDateDesc)[0] })).filter(x => x.bal > 0).sort((a, b) => b.bal - a.bal);
    // 即将到来的事由（未来 30 天）
    const t = today();
    const upcoming = state.events.filter(e => e.date >= t && daysBetween(t, e.date) <= 30).sort(byDateAsc);
    // 备份提醒
    const lastBackup = state.meta.lastBackupAt;
    const needBackup = state.records.length > 0 && (!lastBackup || (Date.now() - lastBackup) / 86400000 > state.settings.backupRemindDays);

    if (!state.records.length && !state.contacts.length) {
      return `<div class="card" style="text-align:center;padding:50px 20px">
        <h2 style="font-size:22px">欢迎使用份子钱记账本</h2>
        <p class="c-muted">记录每一笔人情往来，按事、按人统计，再也不怕忘了回礼。<br>数据只保存在本机浏览器中，请定期在「设置」中导出备份。</p>
        <div class="btn-row" style="justify-content:center;margin-top:20px">
          <button class="btn primary" data-act="add-record">＋ 记第一笔</button>
          <button class="btn" id="loadDemo">载入示例数据体验</button>
        </div></div>`;
    }
    return `
      ${needBackup ? `<div class="notice">⚠️ ${lastBackup ? `已有 ${Math.floor((Date.now() - lastBackup) / 86400000)} 天未备份` : '尚未备份过数据'}，浏览器清理缓存会导致数据丢失。<a href="#/settings">去备份 →</a></div>` : ''}
      <h3 class="c-muted" style="margin:0 0 8px">${year} 年</h3>
      ${statCards(ty, { netSub: '本年', cntSub: '本年' })}
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><h2>累计往来</h2>
          <dl class="kv">
            <dt>累计收到</dt><dd class="c-in"><b>${money(ta.inAmt)}</b> 元 / ${ta.inCnt} 笔</dd>
            <dt>累计送出</dt><dd class="c-out"><b>${money(ta.outAmt)}</b> 元 / ${ta.outCnt} 笔</dd>
            <dt>往来人数</dt><dd>${state.contacts.length} 人</dd>
            <dt>事由数量</dt><dd>${state.events.length} 件</dd>
          </dl></div>
        <div class="card"><h2>近期事由（30 天内）</h2>
          ${upcoming.length ? upcoming.map(e => `<div class="list-item"><div><a class="title" href="#/events/${e.id}">${esc(e.title)}</a><div class="meta">${e.date} · ${esc(e.type)} ${e.isMine ? '<span class="tag mine">我家</span>' : ''}</div></div><div class="meta">${daysBetween(t, e.date) === 0 ? '今天' : daysBetween(t, e.date) + ' 天后'}</div></div>`).join('') : '<div class="empty">近期没有事由</div>'}
        </div>
      </div>
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><h2>待回礼（我欠人情）</h2><span class="c-muted">${owe.length} 人</span></div>
          ${owe.length ? owe.slice(0, 8).map(x => `<div class="list-item"><div><a class="title" href="#/contacts/${x.c.id}">${esc(displayName(x.c))}</a><div class="meta">${esc([x.c.unit, x.c.dept].filter(Boolean).join(' / '))} · 最近 ${x.last?.date || ''}</div></div><div class="c-in"><b>${money(x.bal)}</b> 元</div></div>`).join('') : '<div class="empty">没有欠着的人情 👍</div>'}
        </div>
        <div class="card"><div class="card-head"><h2>最近记录</h2><a href="#/records">查看全部 →</a></div>
          ${recent.length ? recent.map(r => { const c = contactById(r.contactId); return `<div class="list-item"><div><span class="title">${esc(displayName(c))}</span> <span class="meta">${esc(eventLabel(eventById(r.eventId)))}</span><div class="meta">${r.date}</div></div><div class="${r.direction === 'in' ? 'c-in' : 'c-out'}"><b>${r.direction === 'in' ? '+' : '-'}${money(r.amount)}</b></div></div>`; }).join('') : '<div class="empty">暂无记录</div>'}
        </div>
      </div>`;
  }

  /* ========== 页面：记录 ========== */
  const recFilter = { q: '', dir: '', eventId: '', unit: '', from: '', to: '', min: '', max: '', sortKey: 'date', sortDir: 'desc' };
  function filteredRecords() {
    const q = recFilter.q.toLowerCase();
    let recs = state.records.filter(r => {
      const c = contactById(r.contactId), ev = eventById(r.eventId);
      if (recFilter.dir && r.direction !== recFilter.dir) return false;
      if (recFilter.eventId && r.eventId !== recFilter.eventId) return false;
      if (recFilter.unit && (c?.unit || '') !== recFilter.unit) return false;
      if (recFilter.from && r.date < recFilter.from) return false;
      if (recFilter.to && r.date > recFilter.to) return false;
      if (recFilter.min !== '' && r.amount < Number(recFilter.min)) return false;
      if (recFilter.max !== '' && r.amount > Number(recFilter.max)) return false;
      if (q && !`${c?.name || ''} ${c?.unit || ''} ${c?.dept || ''} ${ev?.title || ''} ${r.note || ''} ${r.method || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const k = recFilter.sortKey, dirMul = recFilter.sortDir === 'asc' ? 1 : -1;
    const keyOf = r => k === 'amount' ? r.amount : k === 'contact' ? (contactById(r.contactId)?.name || '') : k === 'event' ? (eventById(r.eventId)?.title || '') : k === 'unit' ? (contactById(r.contactId)?.unit || '') : k === 'dir' ? r.direction : k === 'method' ? (r.method || '') : r.date;
    recs.sort((a, b) => { const x = keyOf(a), y = keyOf(b); const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'zh'); return c ? c * dirMul : byDateDesc(a, b); });
    return recs;
  }
  function pageRecords() {
    const recs = filteredRecords();
    const t = totals(recs);
    const units = [...new Set(state.contacts.map(c => c.unit).filter(Boolean))].sort();
    return `
      <div class="card">
        <div class="card-head"><h2>全部记录 <span class="c-muted" style="font-size:13px;font-weight:400">共 ${recs.length} 条 · 收 <span class="c-in">${money(t.inAmt)}</span> · 送 <span class="c-out">${money(t.outAmt)}</span></span></h2>
          <div class="btn-row"><button class="btn sm" id="exportFiltered">导出当前结果 CSV</button><button class="btn sm" data-act="voice-add">🎤 语音批量</button><button class="btn primary sm" data-act="add-record">＋ 记一笔</button></div></div>
        <div class="filters no-print" id="filters">
          <div class="field" style="flex:1;min-width:160px"><label>搜索</label><input name="q" value="${esc(recFilter.q)}" placeholder="姓名 / 单位 / 事由 / 备注"></div>
          <div class="field"><label>方向</label><select name="dir">${options([{ value: '', label: '全部' }, { value: 'in', label: '收' }, { value: 'out', label: '送' }], recFilter.dir)}</select></div>
          <div class="field" style="min-width:180px"><label>事由</label><select name="eventId">${options(state.events.slice().sort(byDateDesc).map(e => ({ value: e.id, label: e.title })), recFilter.eventId, '全部')}</select></div>
          <div class="field"><label>单位</label><select name="unit">${options(units, recFilter.unit, '全部')}</select></div>
          <div class="field"><label>从</label><input type="date" name="from" value="${recFilter.from}"></div>
          <div class="field"><label>到</label><input type="date" name="to" value="${recFilter.to}"></div>
          <div class="field" style="min-width:90px"><label>金额≥</label><input type="number" name="min" value="${recFilter.min}"></div>
          <div class="field" style="min-width:90px"><label>金额≤</label><input type="number" name="max" value="${recFilter.max}"></div>
          <button class="btn" id="resetFilter">重置</button>
        </div>
        ${recordsTable(recs, { sortable: true, sortKey: recFilter.sortKey, sortDir: recFilter.sortDir })}
      </div>`;
  }

  /* ========== 页面：事由 ========== */
  function pageEvents() {
    const evs = state.events.slice().sort(byDateDesc);
    const groups = groupBy(evs, e => (e.date || '').slice(0, 4) || '未知');
    return `<div class="card">
      <div class="card-head"><h2>事由列表 <span class="c-muted" style="font-size:13px;font-weight:400">${evs.length} 件</span></h2><button class="btn primary sm" data-act="add-event">＋ 新增事由</button></div>
      ${evs.length ? [...groups.entries()].map(([y, list]) => {
        const t = totals(state.records.filter(r => list.some(e => e.id === r.eventId)));
        return `<div class="group-head" data-act="toggle" data-target="y${y}"><span>${y} 年 <span class="meta">${list.length} 件</span></span><span class="meta">收 <span class="c-in">${money(t.inAmt)}</span> · 送 <span class="c-out">${money(t.outAmt)}</span></span></div>
        <div data-group="y${y}"><div class="table-wrap"><table><thead><tr><th>日期</th><th>事由</th><th>类型</th><th>主办</th><th class="num">笔数</th><th class="num">收到</th><th class="num">送出</th><th></th></tr></thead><tbody>
        ${list.map(e => { const tt = totals(recordsOf({ eventId: e.id })); const h = contactById(e.host); return `<tr><td>${e.date}</td><td><a href="#/events/${e.id}"><b>${esc(e.title)}</b></a> ${e.isMine ? '<span class="tag mine">我家</span>' : ''}</td><td>${esc(e.type)}</td><td>${h ? `<a href="#/contacts/${h.id}">${esc(displayName(h))}</a>` : '—'}</td><td class="num">${tt.count}</td><td class="num c-in">${tt.inAmt ? money(tt.inAmt) : '—'}</td><td class="num c-out">${tt.outAmt ? money(tt.outAmt) : '—'}</td><td><button class="btn link sm" data-act="edit-event" data-id="${e.id}">编辑</button></td></tr>`; }).join('')}
        </tbody></table></div></div>`;
      }).join('') : '<div class="empty">还没有事由，点击右上角新增。<br>事由是一次具体的事情，例如「张三儿子婚礼」「我家乔迁」，每笔记录都挂在某个事由下。</div>'}
    </div>`;
  }
  function pageEventDetail(id) {
    const e = eventById(id);
    if (!e) return '<div class="card"><div class="empty">事由不存在</div></div>';
    const recs = recordsOf({ eventId: id }).sort((a, b) => b.amount - a.amount || byDateDesc(a, b));
    const t = totals(recs);
    const host = contactById(e.host);
    const main = e.isMine ? recs.filter(r => r.direction === 'in') : recs.filter(r => r.direction === 'out');
    const avg = main.length ? sum(main.map(r => r.amount)) / main.length : 0;
    const byUnit = [...groupBy(recs, r => contactById(r.contactId)?.unit || '（未填单位）').entries()].map(([u, rs]) => ({ u, t: totals(rs), depts: [...groupBy(rs, r => contactById(r.contactId)?.dept || '（未填科室）').entries()].map(([d, drs]) => ({ d, t: totals(drs) })) })).sort((a, b) => (b.t.inAmt + b.t.outAmt) - (a.t.inAmt + a.t.outAmt));
    const byMethod = [...groupBy(recs, r => r.method || '未填').entries()].map(([m, rs]) => `${m} ${rs.length} 笔 ${money(sum(rs.map(r => r.amount)))} 元`).join('；');
    // 回礼对照：这次收到礼的人，之前我给过他多少
    const compare = e.isMine ? main.map(r => { const c = contactById(r.contactId); const prev = state.records.filter(x => x.contactId === r.contactId && x.direction === 'out' && x.date <= r.date).sort(byDateDesc)[0]; return { c, r, prev }; }) : main.map(r => { const c = contactById(r.contactId); const prev = state.records.filter(x => x.contactId === r.contactId && x.direction === 'in' && x.date <= r.date).sort(byDateDesc)[0]; return { c, r, prev }; });
    return `
      <a class="back no-print" href="#/events">← 返回事由列表</a>
      <div class="page-title"><h1>${esc(e.title)}</h1>${e.isMine ? '<span class="tag mine">我家办事</span>' : ''}<span class="tag">${esc(e.type)}</span><span class="meta">${e.date}${e.place ? ' · ' + esc(e.place) : ''}${host ? ` · 主办：<a href="#/contacts/${host.id}">${esc(displayName(host))}</a>` : ''}</span>
        <div class="btn-row no-print" style="margin-left:auto"><button class="btn sm" data-act="edit-event" data-id="${e.id}">编辑</button><button class="btn sm" data-act="export-event-csv" data-id="${e.id}">导出名单 CSV</button><button class="btn sm" data-act="print">打印</button><button class="btn sm" data-act="voice-add" data-event="${e.id}">🎤 语音批量</button><button class="btn primary sm" data-act="add-record" data-event="${e.id}">＋ 添加记录</button></div></div>
      ${e.note ? `<p class="c-muted">${esc(e.note)}</p>` : ''}
      ${statCards(t, { netSub: '本事由', cnt: '人均', cntSub: `${e.isMine ? '收礼' : '送礼'} ${main.length} 笔` }).replace(`<div class="value">${t.count}</div>`, `<div class="value">${money(Math.round(avg))}</div>`)}
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><h2>按单位 / 科室</h2>
          ${byUnit.length ? byUnit.map(g => `<div class="list-item" style="flex-wrap:wrap"><div><b>${esc(g.u)}</b> <span class="meta">${g.t.count} 笔</span>
              <div class="meta">${g.depts.map(d => `${esc(d.d)}：${money(d.t.inAmt + d.t.outAmt)}（${d.t.count}）`).join('　')}</div></div>
            <div>${g.t.inAmt ? `<span class="c-in">+${money(g.t.inAmt)}</span> ` : ''}${g.t.outAmt ? `<span class="c-out">-${money(g.t.outAmt)}</span>` : ''}</div></div>`).join('') : '<div class="empty">暂无</div>'}
        </div>
        <div class="card"><h2>其他信息</h2>
          <dl class="kv"><dt>支付方式</dt><dd>${byMethod || '—'}</dd>
          <dt>最高</dt><dd>${main.length ? `${money(Math.max(...main.map(r => r.amount)))} 元` : '—'}</dd>
          <dt>最低</dt><dd>${main.length ? `${money(Math.min(...main.map(r => r.amount)))} 元` : '—'}</dd>
          <dt>参与人数</dt><dd>${new Set(recs.map(r => r.contactId)).size} 人</dd></dl>
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>明细（按金额排序）</h2></div>
        ${recordsTable(recs, { cols: { event: 0 } })}</div>
      ${compare.length ? `<div class="card"><h2>往来对照</h2><p class="c-muted" style="margin-top:0;font-size:13px">${e.isMine ? '这次谁给了我多少，以及此前我最近一次给他多少' : '这次我给了谁多少，以及此前他最近一次给我多少'}</p>
        <div class="table-wrap"><table><thead><tr><th>姓名</th><th>单位/科室</th><th class="num">本次</th><th class="num">此前对方${e.isMine ? '收到我' : '给我'}</th><th>日期</th><th class="num">差额</th></tr></thead><tbody>
        ${compare.map(x => { const diff = x.r.amount - (x.prev?.amount || 0); return `<tr><td><a href="#/contacts/${x.c?.id}">${esc(displayName(x.c))}</a></td><td class="c-muted">${esc([x.c?.unit, x.c?.dept].filter(Boolean).join(' / ') || '—')}</td><td class="num"><b>${money(x.r.amount)}</b></td><td class="num">${x.prev ? money(x.prev.amount) : '<span class="c-muted">无</span>'}</td><td class="c-muted">${x.prev?.date || '—'}</td><td class="num ${diff > 0 ? 'c-in' : diff < 0 ? 'c-out' : 'c-muted'}">${x.prev ? (diff > 0 ? '+' : '') + money(diff) : '—'}</td></tr>`; }).join('')}
        </tbody></table></div></div>` : ''}`;
  }

  /* ========== 页面：人员 ========== */
  let contactView = { q: '', mode: 'group' };
  function pageContacts() {
    const q = contactView.q.toLowerCase();
    const list = state.contacts.filter(c => !q || `${c.name} ${c.unit || ''} ${c.dept || ''} ${c.relation || ''}`.toLowerCase().includes(q)).map(c => ({ c, t: totals(recordsOf({ contactId: c.id })), bal: balanceOf(c.id) }));
    const row = x => `<tr><td><a href="#/contacts/${x.c.id}"><b>${esc(x.c.name)}</b></a></td><td class="c-muted">${esc(x.c.relation || '')}</td>${contactView.mode === 'group' ? '' : `<td class="c-muted">${esc([x.c.unit, x.c.dept].filter(Boolean).join(' / ') || '—')}</td>`}<td class="num">${x.t.count}</td><td class="num c-in">${x.t.inAmt ? money(x.t.inAmt) : '—'}</td><td class="num c-out">${x.t.outAmt ? money(x.t.outAmt) : '—'}</td><td class="num ${x.bal > 0 ? 'c-in' : x.bal < 0 ? 'c-out' : 'c-muted'}">${x.bal > 0 ? '欠他 ' + money(x.bal) : x.bal < 0 ? '他欠 ' + money(-x.bal) : '平'}</td><td><button class="btn link sm" data-act="edit-contact" data-id="${x.c.id}">编辑</button></td></tr>`;
    const head = `<thead><tr><th>姓名</th><th>关系</th>${contactView.mode === 'group' ? '' : '<th>单位 / 科室</th>'}<th class="num">笔数</th><th class="num">他给我</th><th class="num">我给他</th><th class="num">人情差额</th><th></th></tr></thead>`;
    let body;
    if (contactView.mode === 'group') {
      const units = [...groupBy(list, x => x.c.unit || '（未填单位）').entries()].sort((a, b) => b[1].length - a[1].length);
      body = units.map(([u, xs]) => {
        const depts = [...groupBy(xs, x => x.c.dept || '（未填科室）').entries()].sort((a, b) => b[1].length - a[1].length);
        const tt = { inAmt: sum(xs.map(x => x.t.inAmt)), outAmt: sum(xs.map(x => x.t.outAmt)) };
        return `<div class="group-head" data-act="toggle" data-target="u${esc(u)}"><span>${esc(u)} <span class="meta">${xs.length} 人</span></span><span class="meta">收 <span class="c-in">${money(tt.inAmt)}</span> · 送 <span class="c-out">${money(tt.outAmt)}</span></span></div>
          <div data-group="u${esc(u)}">${depts.map(([d, ds]) => `<div style="padding:6px 10px 0" class="c-muted"><b>${esc(d)}</b> · ${ds.length} 人</div><div class="table-wrap"><table>${head}<tbody>${ds.sort((a, b) => a.c.name.localeCompare(b.c.name, 'zh')).map(row).join('')}</tbody></table></div>`).join('')}</div>`;
      }).join('');
    } else {
      list.sort((a, b) => (b.t.inAmt + b.t.outAmt) - (a.t.inAmt + a.t.outAmt));
      body = `<div class="table-wrap"><table>${head}<tbody>${list.map(row).join('')}</tbody></table></div>`;
    }
    return `<div class="card">
      <div class="card-head"><h2>人员 <span class="c-muted" style="font-size:13px;font-weight:400">${state.contacts.length} 人</span></h2>
        <div class="btn-row"><input id="cq" placeholder="搜索姓名 / 单位 / 科室" value="${esc(contactView.q)}" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px">
          <select id="cmode" style="padding:6px;border:1px solid var(--border);border-radius:8px">${options([{ value: 'group', label: '按单位/科室分组' }, { value: 'list', label: '按往来金额列表' }], contactView.mode)}</select>
          <button class="btn primary sm" data-act="add-contact">＋ 新增联系人</button></div></div>
      ${list.length ? body : '<div class="empty">暂无联系人</div>'}
    </div>`;
  }
  function pageContactDetail(id) {
    const c = contactById(id);
    if (!c) return '<div class="card"><div class="empty">联系人不存在</div></div>';
    const recs = recordsOf({ contactId: id }).sort(byDateDesc);
    const t = totals(recs);
    const bal = t.inAmt - t.outAmt;
    const first = recs[recs.length - 1], last = recs[0];
    const hosted = state.events.filter(e => e.host === id).sort(byDateDesc);
    const years = groupBy(recs, r => (r.date || '').slice(0, 4));
    return `
      <a class="back no-print" href="#/contacts">← 返回人员列表</a>
      <div class="page-title"><h1>${esc(c.name)}</h1>${c.relation ? `<span class="tag">${esc(c.relation)}</span>` : ''}<span class="meta">${esc([c.unit, c.dept].filter(Boolean).join(' / ') || '未填单位')}${c.phone ? ' · ' + esc(c.phone) : ''}</span>
        <div class="btn-row no-print" style="margin-left:auto"><button class="btn sm" data-act="edit-contact" data-id="${c.id}">编辑</button><button class="btn sm" data-act="add-record" data-contact="${c.id}" data-dir="in">＋ 他给我</button><button class="btn primary sm" data-act="add-record" data-contact="${c.id}" data-dir="out">＋ 我给他</button></div></div>
      ${c.note ? `<p class="c-muted">${esc(c.note)}</p>` : ''}
      <div class="grid grid-4">
        <div class="stat"><div class="label">他给我</div><div class="value c-in">${money(t.inAmt)}</div><div class="sub">${t.inCnt} 笔</div></div>
        <div class="stat"><div class="label">我给他</div><div class="value c-out">${money(t.outAmt)}</div><div class="sub">${t.outCnt} 笔</div></div>
        <div class="stat"><div class="label">人情差额</div><div class="value ${bal > 0 ? 'c-in' : bal < 0 ? 'c-out' : ''}">${bal > 0 ? '我欠 ' : bal < 0 ? '他欠 ' : ''}${money(Math.abs(bal))}</div><div class="sub">${bal > 0 ? '应回礼' : bal < 0 ? '对方尚未回礼' : '两清'}</div></div>
        <div class="stat"><div class="label">往来时间</div><div class="value" style="font-size:16px">${first ? `${first.date}<br>至 ${last.date}` : '—'}</div><div class="sub">${recs.length} 笔往来${first && last ? `，${Math.floor(daysBetween(first.date, today()) / 365)} 年` : ''}</div></div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card" style="grid-column:1/-1"><h2>完整时间线</h2>
          ${recs.length ? [...years.entries()].map(([y, rs]) => { const yt = totals(rs); return `<div class="tl-year">${y} 年 <span style="font-weight:400;font-size:13px">收 <span class="c-in">${money(yt.inAmt)}</span> · 送 <span class="c-out">${money(yt.outAmt)}</span></span></div><div class="timeline">${rs.map(r => { const ev = eventById(r.eventId); return `<div class="tl-item ${r.direction}"><div class="tl-date">${r.date}</div><div class="tl-body"><div><span class="tag ${r.direction}">${r.direction === 'in' ? '他给我' : '我给他'}</span> <a href="#/events/${r.eventId}"><b>${esc(eventLabel(ev))}</b></a> <span class="c-muted">${esc(ev?.type || '')}${r.method ? ' · ' + esc(r.method) : ''}${r.note ? ' · ' + esc(r.note) : ''}</span></div><div class="btn-row"><span class="amt ${r.direction === 'in' ? 'c-in' : 'c-out'}">${r.direction === 'in' ? '+' : '-'}${money(r.amount)}</span><button class="btn link sm no-print" data-act="edit-record" data-id="${r.id}">编辑</button></div></div></div>`; }).join('')}</div>`; }).join('') : '<div class="empty">还没有往来记录</div>'}
        </div>
        ${hosted.length ? `<div class="card" style="grid-column:1/-1"><h2>作为主办人的事由</h2>${hosted.map(e => `<div class="list-item"><a href="#/events/${e.id}">${esc(e.title)}</a><span class="meta">${e.date} · ${esc(e.type)}</span></div>`).join('')}</div>` : ''}
      </div>`;
  }

  /* ========== 页面：统计 ========== */
  function bars(rows, opts = {}) {
    // rows: [{label, inAmt, outAmt, link?}]
    const max = Math.max(1, ...rows.map(r => opts.stacked ? r.inAmt + r.outAmt : Math.max(r.inAmt, r.outAmt)));
    return `<div class="legend"><span><i style="background:var(--in)"></i>收</span><span><i style="background:var(--out)"></i>送</span></div><div class="bars">${rows.map(r => `<div class="bar-row"><div title="${esc(r.label)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.link ? `<a href="${r.link}">${esc(r.label)}</a>` : esc(r.label)}</div>
      <div>${opts.stacked ? `<div class="bar-track"><div class="bar-fill in" style="width:${r.inAmt / max * 100}%"></div><div class="bar-fill out" style="width:${r.outAmt / max * 100}%"></div></div>` : `<div class="bar-track" style="height:8px;margin-bottom:2px"><div class="bar-fill in" style="width:${r.inAmt / max * 100}%"></div></div><div class="bar-track" style="height:8px"><div class="bar-fill out" style="width:${r.outAmt / max * 100}%"></div></div>`}</div>
      <div class="bar-val"><span class="c-in">${money(r.inAmt)}</span> / <span class="c-out">${money(r.outAmt)}</span></div></div>`).join('')}</div>`;
  }
  let statsYear = '';
  function pageStats() {
    if (!state.records.length) return '<div class="card"><div class="empty">暂无数据</div></div>';
    const yearsAll = [...new Set(state.records.map(r => (r.date || '').slice(0, 4)))].sort().reverse();
    const recs = statsYear ? state.records.filter(r => r.date.startsWith(statsYear)) : state.records;
    const agg = (m) => [...m.entries()].map(([k, rs]) => ({ key: k, ...totals(rs) }));
    const byYear = agg(groupBy(state.records, r => (r.date || '').slice(0, 4))).sort((a, b) => a.key.localeCompare(b.key));
    const byType = agg(groupBy(recs, r => eventById(r.eventId)?.type || '其他')).sort((a, b) => (b.inAmt + b.outAmt) - (a.inAmt + a.outAmt));
    const byUnit = agg(groupBy(recs, r => contactById(r.contactId)?.unit || '（未填单位）')).sort((a, b) => (b.inAmt + b.outAmt) - (a.inAmt + a.outAmt)).slice(0, 15);
    const byDept = agg(groupBy(recs.filter(r => contactById(r.contactId)?.dept), r => { const c = contactById(r.contactId); return `${c.unit ? c.unit + ' / ' : ''}${c.dept}`; })).sort((a, b) => (b.inAmt + b.outAmt) - (a.inAmt + a.outAmt)).slice(0, 15);
    const byMonth = Array.from({ length: 12 }, (_, i) => { const mm = String(i + 1).padStart(2, '0'); return { key: `${i + 1} 月`, ...totals(recs.filter(r => r.date.slice(5, 7) === mm)) }; });
    const byPerson = agg(groupBy(recs, r => r.contactId)).sort((a, b) => (b.inAmt + b.outAmt) - (a.inAmt + a.outAmt)).slice(0, 15);
    const byMethod = agg(groupBy(recs, r => r.method || '未填'));
    const byRelation = agg(groupBy(recs, r => contactById(r.contactId)?.relation || '未填'));
    const toRows = (arr, linkFn) => arr.map(a => ({ label: linkFn ? (contactById(a.key) ? displayName(contactById(a.key)) : a.key) : a.key, inAmt: a.inAmt, outAmt: a.outAmt, link: linkFn ? linkFn(a.key) : null }));
    const t = totals(recs);
    return `
      <div class="card-head"><h2 style="margin:0">统计${statsYear ? ` · ${statsYear} 年` : ' · 全部年份'}</h2>
        <select id="statsYear" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px">${options([{ value: '', label: '全部年份' }, ...yearsAll.map(y => ({ value: y, label: y + ' 年' }))], statsYear)}</select></div>
      ${statCards(t)}
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><h2>按年份</h2>${bars(toRows(byYear))}</div>
        <div class="card"><h2>按月份${statsYear ? '' : '（所有年份合计）'}</h2>${bars(toRows(byMonth))}</div>
        <div class="card"><h2>按事由类型</h2>${bars(toRows(byType))}</div>
        <div class="card"><h2>往来最多的人（前 15）</h2>${bars(toRows(byPerson, k => '#/contacts/' + k))}</div>
        <div class="card"><h2>按单位（前 15）</h2>${bars(toRows(byUnit))}</div>
        <div class="card"><h2>按科室（前 15）</h2>${byDept.length ? bars(toRows(byDept)) : '<div class="empty">未填写科室</div>'}</div>
        <div class="card"><h2>按关系</h2>${bars(toRows(byRelation))}</div>
        <div class="card"><h2>按支付方式</h2>${bars(toRows(byMethod))}</div>
      </div>`;
  }

  /* ========== 页面：设置 ========== */
  function pageSettings() {
    const s = state.settings;
    return `
      ${installCard()}
      <div class="grid grid-2">
        <div class="card"><h2>数据备份</h2>
          <p class="c-muted" style="font-size:13px">数据仅保存在本浏览器中（localStorage）。清理浏览器数据、换电脑、换浏览器都会看不到数据，请定期导出 JSON 备份文件。${state.meta.lastBackupAt ? `<br>上次备份：${new Date(state.meta.lastBackupAt).toLocaleString('zh-CN')}` : '<br><b class="c-warn">尚未备份</b>'}</p>
          <div class="btn-row"><button class="btn primary" id="exportJson">导出完整备份 (JSON)</button>
            <label class="btn">导入备份 (JSON)<input type="file" id="importJson" accept=".json,application/json" hidden></label></div>
          <p class="c-muted" style="font-size:13px;margin:12px 0 4px">当前：${state.contacts.length} 位联系人，${state.events.length} 个事由，${state.records.length} 条记录。</p>
        </div>
        <div class="card"><h2>导出 Excel（CSV）</h2>
          <p class="c-muted" style="font-size:13px">CSV 文件可直接用 Excel / WPS 打开，含 BOM 不会乱码。仅用于查看打印，恢复数据请用 JSON 备份。</p>
          <div class="btn-row"><button class="btn" id="exportRecordsCsv">导出全部流水</button><button class="btn" id="exportContactsCsv">导出联系人（含往来汇总）</button></div>
        </div>
        <div class="card"><h2>自定义选项</h2>
          <div class="field"><label>事由类型（逗号分隔）</label><input id="setTypes" value="${esc(s.eventTypes.join('，'))}"></div>
          <div class="field" style="margin-top:10px"><label>支付方式（逗号分隔）</label><input id="setMethods" value="${esc(s.methods.join('，'))}"></div>
          <div class="grid grid-2" style="margin-top:10px">
            <div class="field"><label>回礼参考系数</label><input id="setRatio" type="number" step="0.1" min="0" value="${s.returnRatio}"><div class="hint">记一笔时提示：上次对方给的金额 × 系数</div></div>
            <div class="field"><label>备份提醒天数</label><input id="setBackup" type="number" min="0" value="${s.backupRemindDays}"><div class="hint">超过天数未备份，首页提示；0 不提醒</div></div>
          </div>
          <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="saveSettings">保存设置</button></div>
        </div>
        <div class="card"><h2>其他</h2>
          <div class="btn-row"><button class="btn" id="loadDemo">载入示例数据</button><button class="btn danger" id="clearAll">清空全部数据</button></div>
          <p class="c-muted" style="font-size:13px;margin-top:12px">示例数据用于体验，会与现有数据合并，可随时清空。<br>版本 1.0 · 纯本地运行，无网络请求。</p>
        </div>
      </div>`;
  }

  /* ========== 导入导出 ========== */
  function download(filename, content, type = 'text/plain') {
    const blob = new Blob([content], { type: type + ';charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  function recordRows(recs) {
    return [['日期', '姓名', '单位', '科室', '关系', '事由', '事由类型', '方向', '金额', '方式', '备注'], ...recs.map(r => { const c = contactById(r.contactId), e = eventById(r.eventId); return [r.date, c?.name, c?.unit, c?.dept, c?.relation, e?.title, e?.type, r.direction === 'in' ? '收' : '送', r.amount, r.method, r.note]; })];
  }
  function exportRecordsCsv(recs, name) { download(`${name}_${today()}.csv`, csv(recordRows(recs)), 'text/csv'); toast('已导出'); }
  function exportEventCsv(id) { const e = eventById(id); exportRecordsCsv(recordsOf({ eventId: id }).sort((a, b) => b.amount - a.amount), `${e.title}_名单`); }
  function exportContactsCsv() {
    const rows = [['姓名', '单位', '科室', '关系', '电话', '笔数', '他给我合计', '我给他合计', '差额(正=我欠)', '首次往来', '最近往来', '备注'], ...state.contacts.map(c => { const rs = recordsOf({ contactId: c.id }).sort(byDateAsc); const t = totals(rs); return [c.name, c.unit, c.dept, c.relation, c.phone, t.count, t.inAmt, t.outAmt, t.inAmt - t.outAmt, rs[0]?.date, rs[rs.length - 1]?.date, c.note]; })];
    download(`联系人_${today()}.csv`, csv(rows), 'text/csv'); toast('已导出');
  }
  function exportJson() {
    state.meta.lastBackupAt = Date.now(); save();
    download(`份子钱备份_${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
    toast('备份已导出'); render();
  }
  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let d;
      try { d = JSON.parse(reader.result); if (!Array.isArray(d.records) || !Array.isArray(d.contacts)) throw 0; } catch { return toast('文件格式不正确', true); }
      const m = openModal(`<h2>导入备份</h2>
        <p>文件包含：<b>${d.contacts.length}</b> 位联系人，<b>${(d.events || []).length}</b> 个事由，<b>${d.records.length}</b> 条记录。</p>
        <p>当前已有：${state.contacts.length} 位联系人，${state.events.length} 个事由，${state.records.length} 条记录。</p>
        <div class="actions"><button class="btn" data-cancel>取消</button><button class="btn" data-merge>合并（按 ID 去重）</button><button class="btn danger" data-replace>覆盖现有数据</button></div>`);
      $('[data-cancel]', m).onclick = closeModal;
      $('[data-replace]', m).onclick = () => { state = { ...d, settings: Object.assign({}, DEFAULT_SETTINGS, d.settings || {}), meta: d.meta || {} }; save(); closeModal(); toast('已覆盖导入'); render(); };
      $('[data-merge]', m).onclick = () => {
        const merge = (a, b) => { const ids = new Set(a.map(x => x.id)); return a.concat(b.filter(x => !ids.has(x.id))); };
        state.contacts = merge(state.contacts, d.contacts); state.events = merge(state.events, d.events || []); state.records = merge(state.records, d.records);
        save(); closeModal(); toast('已合并导入'); render();
      };
    };
    reader.readAsText(file);
  }

  /* ========== 示例数据 ========== */
  function loadDemo() {
    const mk = (name, unit, dept, relation) => ({ id: uid(), name, unit, dept, relation, createdAt: Date.now() });
    const C = {
      zs: mk('张三', '市人民医院', '心内科', '同事'), ls: mk('李四', '市人民医院', '心内科', '同事'), ww: mk('王五', '市人民医院', '骨科', '同事'),
      zl: mk('赵六', '市第二中学', '教务处', '同学'), sq: mk('孙七', '', '', '亲戚'), zb: mk('周八', '市人民医院', '护理部', '同事'), wj: mk('吴九', '县城建局', '规划科', '朋友')
    };
    const y = new Date().getFullYear();
    const E = [
      { id: uid(), title: '我的婚礼', type: '婚礼', date: `${y - 3}-10-01`, isMine: true, place: '幸福大酒店' },
      { id: uid(), title: '张三儿子满月', type: '满月', date: `${y - 2}-03-15`, isMine: false, host: C.zs.id },
      { id: uid(), title: '李四乔迁', type: '乔迁', date: `${y - 2}-08-20`, isMine: false, host: C.ls.id },
      { id: uid(), title: '我家宝宝满月', type: '满月', date: `${y - 1}-05-06`, isMine: true },
      { id: uid(), title: '赵六女儿升学', type: '升学', date: `${y - 1}-08-28`, isMine: false, host: C.zl.id },
      { id: uid(), title: '王五父亲丧事', type: '丧事', date: `${y}-01-12`, isMine: false, host: C.ww.id },
      { id: uid(), title: '孙七结婚', type: '婚礼', date: `${y}-05-01`, isMine: false, host: C.sq.id },
    ];
    const R = [];
    const add = (e, c, dir, amount, method = '微信', note = '') => R.push({ id: uid(), eventId: e.id, contactId: c.id, direction: dir, amount, date: e.date, method, note, createdAt: Date.now() });
    add(E[0], C.zs, 'in', 600, '现金'); add(E[0], C.ls, 'in', 500, '现金'); add(E[0], C.ww, 'in', 300, '现金'); add(E[0], C.zl, 'in', 800, '现金'); add(E[0], C.sq, 'in', 1000, '现金', '亲戚'); add(E[0], C.zb, 'in', 200, '现金'); add(E[0], C.wj, 'in', 500, '现金');
    add(E[1], C.zs, 'out', 600); add(E[2], C.ls, 'out', 600, '支付宝'); add(E[3], C.zs, 'in', 800); add(E[3], C.ls, 'in', 600); add(E[3], C.zb, 'in', 300); add(E[3], C.wj, 'in', 600, '礼品', '一箱奶粉，估值');
    add(E[4], C.zl, 'out', 1000, '银行转账'); add(E[5], C.ww, 'out', 500, '现金'); add(E[6], C.sq, 'out', 1200, '现金');
    state.contacts.push(...Object.values(C)); state.events.push(...E); state.records.push(...R);
    save(); toast('示例数据已载入'); location.hash = '#/home'; render();
  }

  /* ========== 页面级事件绑定（在 render 后） ========== */
  const origRender = render;
  render = function () {
    origRender();
    const view = $('#view');
    const { page } = route();
    const demoBtn = $('#loadDemo', view); if (demoBtn) demoBtn.onclick = loadDemo;
    if (page === 'records') {
      const filt = $('#filters', view);
      let timer;
      filt.addEventListener('input', e => { const { name, value } = e.target; if (!name) return; recFilter[name] = value; clearTimeout(timer); timer = setTimeout(() => { const active = e.target.name; render(); const el = $(`#filters [name=${active}]`); if (el && el.tagName === 'INPUT') { el.focus(); el.setSelectionRange && el.type === 'text' && el.setSelectionRange(el.value.length, el.value.length); } }, e.target.tagName === 'SELECT' ? 0 : 300); });
      $('#resetFilter', view).onclick = () => { Object.assign(recFilter, { q: '', dir: '', eventId: '', unit: '', from: '', to: '', min: '', max: '' }); render(); };
      $('#exportFiltered', view).onclick = () => exportRecordsCsv(filteredRecords(), '份子钱流水');
      $$('th.sortable', view).forEach(th => th.onclick = () => { const k = th.dataset.sort; if (recFilter.sortKey === k) recFilter.sortDir = recFilter.sortDir === 'asc' ? 'desc' : 'asc'; else { recFilter.sortKey = k; recFilter.sortDir = k === 'amount' || k === 'date' ? 'desc' : 'asc'; } render(); });
    }
    if (page === 'contacts') {
      const cq = $('#cq', view); if (cq) { let t; cq.oninput = () => { contactView.q = cq.value; clearTimeout(t); t = setTimeout(() => { render(); const el = $('#cq'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); }; }
      const cm = $('#cmode', view); if (cm) cm.onchange = () => { contactView.mode = cm.value; render(); };
    }
    if (page === 'stats') { const sy = $('#statsYear', view); if (sy) sy.onchange = () => { statsYear = sy.value; render(); }; }
    if (page === 'settings') {
      const ib = $('#installBtn', view); if (ib) ib.onclick = async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); };
      $('#exportJson', view).onclick = exportJson;
      $('#importJson', view).onchange = e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; };
      $('#exportRecordsCsv', view).onclick = () => exportRecordsCsv(state.records.slice().sort(byDateDesc), '份子钱流水');
      $('#exportContactsCsv', view).onclick = exportContactsCsv;
      $('#saveSettings', view).onclick = () => {
        const split = s => s.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean);
        const types = split($('#setTypes').value), methods = split($('#setMethods').value);
        if (!types.length || !methods.length) return toast('类型和方式不能为空', true);
        state.settings.eventTypes = types; state.settings.methods = methods;
        state.settings.returnRatio = Number($('#setRatio').value) || 0; state.settings.backupRemindDays = Number($('#setBackup').value) || 0;
        save(); toast('设置已保存'); render();
      };
      $('#clearAll', view).onclick = () => confirmDialog('确定要<b>清空全部数据</b>吗？此操作不可恢复，建议先导出备份。', () => {
        confirmDialog('再次确认：真的要删除所有联系人、事由和记录？', () => { state = { contacts: [], events: [], records: [], settings: { ...DEFAULT_SETTINGS }, meta: { createdAt: Date.now() } }; save(); toast('已清空'); location.hash = '#/home'; render(); }, '彻底清空');
      }, '继续');
    }
  };
  window.removeEventListener('hashchange', origRender);
  window.addEventListener('hashchange', render);

  $('#quickAdd').onclick = () => {
    if (!state.events.length) { toast('请先新增一个事由'); eventForm({}, created => recordForm({}, { eventId: created.id })); }
    else recordForm();
  };
  $('#voiceAdd').onclick = () => voiceBatchForm();

  /* ========== 安装为应用（PWA）/ 独立窗口 ========== */
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; render(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; toast('已安装到桌面，以后从桌面图标打开即可'); render(); });
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || new URLSearchParams(location.search).has('app');
  function installCard() {
    if (isStandalone()) return '';
    if (installPrompt) return `<div class="card"><h2>安装为桌面应用</h2><p class="c-muted" style="font-size:13px">安装后从桌面图标打开，独立窗口、没有地址栏和浏览器按钮，数据与现在这个网址共用。</p><button class="btn primary" id="installBtn">安装到桌面</button></div>`;
    if (location.protocol === 'file:') return `<div class="card"><h2>独立窗口打开（无地址栏）</h2><p class="c-muted" style="font-size:13px">双击本文件夹里的 <b>启动记账本.vbs</b>，会用浏览器的"应用模式"打开，没有地址栏和浏览器按钮。可右键该文件 → 发送到 → 桌面快捷方式。<br>若发布到了网站（如 GitHub Pages），用 Edge/Chrome 打开网址后，地址栏右侧会出现"安装"按钮，安装后即为独立应用。</p></div>`;
    return `<div class="card"><h2>安装为桌面应用</h2><p class="c-muted" style="font-size:13px">在 Edge / Chrome 中点地址栏右侧的"安装应用"图标（或菜单 → 应用 → 安装此站点为应用），安装后独立窗口打开、无地址栏。手机上用"添加到主屏幕"。</p></div>`;
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
  }

  bindPage($('#view'));
  render();
})();
