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
  let loadError = '';
  let state = load();

  /* 只补齐旧版本可缺省的容器，ID、金额、扩展字段均原样保留。 */
  function normalizeData(input) { return FZAnalytics.normalize(input, DEFAULT_SETTINGS); }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        return normalizeData(JSON.parse(raw));
      }
    } catch (e) { loadError = e.message; console.error('读取数据失败', e); }
    return { contacts: [], events: [], records: [], settings: { ...DEFAULT_SETTINGS }, meta: { createdAt: Date.now() } };
  }
  function save() {
    if (loadError) throw new Error('原始账本读取失败，已阻止覆盖，请先导出原始数据');
    state.meta.updatedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  const contactById = id => state.contacts.find(c => String(c.id) === String(id));
  const eventById = id => state.events.find(e => String(e.id) === String(id));
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
      (!filter.contactId || String(r.contactId) === String(filter.contactId)) &&
      (!filter.eventId || String(r.eventId) === String(filter.eventId))
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
      const recs = recordsOf({ contactId: cid }).filter(x => x.id !== r.id && FZAnalytics.validRecord(x) && x.date <= today()).sort(byDateDesc);
      const dirNow = $('.seg input:checked', m).value;
      const lastOpp = recs.find(x => x.direction !== dirNow);
      const bal = FZAnalytics.summarize(recs).net;
      let txt = '';
      if (lastOpp) txt += `上次${lastOpp.direction === 'in' ? '对方给我' : '我给对方'} ${money(lastOpp.amount)} 元（${lastOpp.date}）。`;
      if (bal > 0) txt += `累计收多于送 ${money(bal)} 元，仅供参考。`; else if (bal < 0) txt += `累计送多于收 ${money(-bal)} 元，仅供参考。`;
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
      if (!FZAnalytics.validRecord(base)) return toast('请填写有效日期、方向和金额', true);
      const similar = state.records.filter(x => x.id !== r.id && names.includes(contactById(x.contactId)?.name) && String(x.eventId) === String(d.eventId) && x.direction === d.direction && x.date === d.date && Number(x.amount) === base.amount);
      if (similar.length && !confirm(`找到 ${similar.length} 笔同名、同事由、同日、同方向且同金额的记录。请核对是否重复，仍要保存吗？`)) return;
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
    let decoded = id; try { if (id) decoded = decodeURIComponent(id); } catch {}
    return { page, id: decoded };
  }
  function render() {
    const { page, id } = route();
    $$('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === page));
    const view = $('#view');
    if (loadError) {
      view.innerHTML = `<section class="card"><h1>原始账本暂时无法读取</h1><p>${esc(loadError)}</p><p>原始数据仍保留在本机。请先下载原始文件，再核对修复；本次已暂停写入。</p><button class="btn primary" id="downloadOriginal">下载原始数据</button></section>`;
      $('#downloadOriginal').onclick = () => download('账本原始数据.json', localStorage.getItem(KEY) || '', 'application/json');
      return;
    }
    const pages = { home: pageHome, records: pageRecords, events: id ? () => pageEventDetail(id) : pageEvents, contacts: id ? () => pageContactDetail(id) : pageContacts, stats: pageStats, settings: pageSettings };
    view.innerHTML = (pages[page] || pageHome)();
    window.scrollTo(0, 0);
  }

  /* 通用行内事件绑定：data-act（只绑定一次，事件委托） */
  function bindPage(view) {
    view.addEventListener('click', e => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      const { act, id } = el.dataset;
      if (act === 'backup') return exportJson();
      if (act === 'record-preset' || act === 'home-records') { setRecordPreset(el.dataset.preset); if (el.dataset.dir) recFilter.dir = el.dataset.dir; if (route().page === 'records') render(); else location.hash = '#/records'; return; }
      if (act === 'record-page') { recordPage = Math.max(1, Number(el.dataset.page)); render(); return; }
      if (act === 'confirm-record-issue') { confirmAuditRecords(state.records.filter(r => String(r.id) === String(id))); return; }
      if (act === 'confirm-filtered-issues') { confirmAuditRecords(filteredRecords()); return; }
      if (act === 'reopen-record-issue') {
        const record = state.records.find(r => String(r.id) === String(id));
        if (!record?.auditReview) return;
        delete record.auditReview; save(); render(); toast('已撤销确认，这条记录会重新提示核对'); return;
      }
      if (act === 'person-records') return goRecords({ contactId: id });
      if (act === 'contact-scope') { contactView.balance = el.dataset.scope; contactView.q = ''; if (route().page === 'contacts') render(); else location.hash = '#/contacts'; return; }
      if (act === 'event-scope') { eventView.scope = el.dataset.scope; eventView.q = ''; eventView.mine = ''; if (route().page === 'events') render(); else location.hash = '#/events'; return; }
      if (act === 'review-event') {
        const ev = eventById(id), rs = recordsOf({eventId:id});
        if (!ev || !rs.length) return;
        confirmDialog(`已对照礼簿或转账记录核对「${esc(ev.title)}」的 ${rs.length} 笔名单？修改明细后会重新提示核对。`, () => { ev.reviewSignature = eventSignature(id); ev.reviewedAt = Date.now(); save(); render(); toast('名单已标记为核对完成'); }, '确认已核对', false); return;
      }
      if (act === 'edit-record') recordForm(state.records.find(r => String(r.id) === id));
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

  function confirmAuditRecords(records) {
    const all = new Map(FZAnalytics.audit(state, today(), { includeConfirmed: true }).map(x => [String(x.record.id), x]));
    const pending = records.map(r => all.get(String(r.id))).filter(x => x && !x.confirmed);
    if (!pending.length) return toast('当前范围没有待确认提示');
    const one = pending.length === 1 ? pending[0] : null;
    const subject = one ? `${displayName(contactById(one.record.contactId))} · ${eventLabel(eventById(one.record.eventId))} · ${one.reasons.join('、')}` : `当前筛选结果中的 ${pending.length} 条提示`;
    confirmDialog(`确认「${esc(subject)}」已核实，记录内容无需修改？<br><span class="c-muted">确认后不再计入待确认；记录内容或关联关系变化时会自动重新提示。</span>`, () => {
      const confirmedAt = Date.now();
      pending.forEach(x => { x.record.auditReview = { signature: x.signature, reasons: [...x.reasons], confirmedAt }; });
      save(); render(); toast(`已确认 ${pending.length} 条核对提示`);
    }, pending.length === 1 ? '确认无误' : `确认 ${pending.length} 条`, false);
  }

  /* ========== 记录表格（复用） ========== */
  function recordsTable(recs, opts = {}) {
    if (!recs.length) return `<div class="empty">暂无记录</div>`;
    const cols = Object.assign({ date: 1, contact: 1, unit: 1, event: 1, dir: 1, amount: 1, method: 1, note: 1, ops: 1 }, opts.cols || {});
    const sortKey = opts.sortKey, sortDir = opts.sortDir;
    const th = (k, label, cls = '') => cols[k] ? `<th class="${cls} ${opts.sortable ? 'sortable' : ''}" data-sort="${k}">${label}${sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</th>` : '';
    return `<div class="table-wrap"><table>
      <thead><tr>${th('date', '日期')}${th('contact', '姓名')}${th('unit', '单位/科室')}${th('event', '事由')}${th('dir', '方向')}${th('amount', '金额', 'num')}${th('method', '方式')}${cols.note ? '<th>备注</th>' : ''}${opts.issues ? '<th>核对提示</th>' : ''}${cols.ops ? '<th class="no-print"></th>' : ''}</tr></thead>
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
          ${opts.issues ? (() => { const issue = opts.issues.get(String(r.id)); return `<td class="wrap audit-reason">${issue ? `<div>${esc(issue.reasons.join(' / '))}</div><div class="audit-actions">${issue.confirmed ? `<span class="status-tag green">已确认</span><button class="btn link sm" data-act="reopen-record-issue" data-id="${esc(r.id)}">重新核对</button>` : `<span class="status-tag amber">待确认</span><button class="btn link sm" data-act="confirm-record-issue" data-id="${esc(r.id)}">确认无误</button>`}</div>` : '—'}</td>`; })() : ''}
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
      <div class="stat"><div class="label">${labels.cnt || '总笔数'}</div><div class="value">${labels.countValue ?? t.count}</div><div class="sub">${labels.cntSub || ''}</div></div>
    </div>`;
  }

  /* ========== 页面：总览 ========== */
  const occurred = () => state.records.filter(r => FZAnalytics.validRecord(r) && r.date <= today());
  const linkTo = (page, id) => '#/' + page + '/' + encodeURIComponent(id);
  function moduleHead(title, note, actions = '') {
    return `<div class="module-head"><div><h1>${title}</h1><p>${note}</p></div><div class="btn-row no-print">${actions}</div></div>`;
  }
  function contactSummaries() {
    const groups = groupBy(occurred(), r => String(r.contactId));
    return state.contacts.map(c => {
      const rs = (groups.get(String(c.id)) || []).slice().sort(byDateDesc), t = FZAnalytics.summarize(rs);
      return { c, t, bal: t.net, last: rs[0], lastIn: rs.find(r => r.direction === 'in'), lastOut: rs.find(r => r.direction === 'out') };
    });
  }
  function eventSignature(id) {
    return JSON.stringify(recordsOf({ eventId: id }).map(r => [r.id, r.contactId, r.direction, r.amount, r.date, r.method, r.note]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  }
  function eventStatus(e) {
    const rs = recordsOf({ eventId: e.id });
    if (!FZAnalytics.validDate(e.date)) return { key: 'undated', text: '日期待核对', cls: 'amber' };
    if (e.date > today()) return { key: 'upcoming', text: daysBetween(today(), e.date) + ' 天后', cls: 'blue' };
    if (!rs.length) return { key: 'unrecorded', text: '尚未记账', cls: 'amber' };
    if (e.reviewSignature === eventSignature(e.id)) return { key: 'reviewed', text: '名单已核对', cls: 'green' };
    return { key: 'recorded', text: '已记 ' + rs.length + ' 笔 · 待核对', cls: '' };
  }
  function statusTag(s) { return `<span class="status-tag ${s.cls}">${esc(s.text)}</span>`; }
  function setRecordPreset(preset) {
    Object.assign(recFilter, { q: '', dir: '', contactId: '', eventId: '', unit: '', from: '', to: '', min: '', max: '', issue: '' });
    if (preset === 'month') { recFilter.from = today().slice(0, 7) + '-01'; recFilter.to = today(); }
    if (preset === 'year') { recFilter.from = today().slice(0, 4) + '-01-01'; recFilter.to = today(); }
    if (preset === 'issues') recFilter.issue = 'all';
    if (preset === 'confirmed') recFilter.issue = 'confirmed';
    recordPage = 1;
  }
  function goRecords(values = {}) {
    setRecordPreset('all'); Object.assign(recFilter, values);
    if (route().page === 'records') render(); else location.hash = '#/records';
  }
  function pageHome() {
    const date = today(), month = FZAnalytics.summarize(occurred().filter(r => r.date.startsWith(date.slice(0, 7))));
    const people = contactSummaries(), moreIn = people.filter(x => x.bal > 0).sort((a, b) => b.bal - a.bal);
    const upcoming = state.events.filter(e => e.date >= date && daysBetween(date, e.date) <= 60).sort(byDateAsc);
    const unrecorded = state.events.filter(e => eventStatus(e).key === 'unrecorded');
    const issues = FZAnalytics.audit(state, date);
    const backup = state.meta.lastBackupAt, days = Number(state.settings.backupRemindDays);
    const needBackup = (state.records.length || state.contacts.length || state.events.length) && days > 0 && (!backup || (Date.now() - backup) / 86400000 > days);
    const recent = state.records.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || byDateDesc(a, b)).slice(0, 6);
    return '<section class="home-hero"><div><div class="eyebrow">' + date.replace(/-/g, ' / ') + ' · 我的往来账本</div><h1>记下每一份心意。</h1><p>谁来过、送了多少、下次怎么回礼，都有据可查。</p><div class="btn-row"><button class="btn primary" data-act="add-record">＋ 记一笔</button><button class="btn" data-act="add-event">新建事由</button><a class="btn" href="#/contacts">查一个人</a></div></div><div class="hero-note"><span>这本账里</span><strong>' + state.contacts.length + '<small> 位亲友</small></strong><span>' + state.events.length + ' 件事由 · ' + state.records.length + ' 笔记录</span><span>本机保存 · 可导出备份</span></div></section>' +
      (!state.records.length ? '<div class="card welcome-strip"><div><h2>从一笔往来开始</h2><p>已有账本可直接导入旧 JSON；办一场事，可在事由中连续记账。</p></div><div class="btn-row"><a class="btn" href="#/settings">导入旧账本</a>' + (!state.contacts.length && !state.events.length ? '<button class="btn" id="loadDemo">体验示例账本</button>' : '') + '</div></div>' : '') +
      '<div class="metric-strip"><button data-act="home-records" data-preset="month" data-dir="in"><span>本月收到</span><strong class="c-in">¥ ' + money(month.inAmt) + '</strong><small>' + month.inCnt + ' 笔 · 查看明细</small></button><button data-act="home-records" data-preset="month" data-dir="out"><span>本月送出</span><strong class="c-out">¥ ' + money(month.outAmt) + '</strong><small>' + month.outCnt + ' 笔 · 查看明细</small></button><button data-act="contact-scope" data-scope="positive"><span>累计收多于送</span><strong>' + moreIn.length + '<small> 人</small></strong><small>往来差额供回礼参考</small></button><button data-act="event-scope" data-scope="upcoming"><span>近 60 天事由</span><strong>' + upcoming.length + '<small> 件</small></strong><small>提前安排，记住日子</small></button></div>' +
      '<div class="workspace-grid"><section class="card"><div class="card-head"><h2>接下来要留意</h2><span class="section-kicker">行动清单</span></div>' +
      (needBackup ? '<div class="task-row"><span class="task-dot amber"></span><div><b>给账本留一份备份</b><p>' + (backup ? '距离上次导出已超过 ' + days + ' 天' : '还没有导出过备份') + '，下载后请妥善保存。</p></div><button class="btn sm" data-act="backup">立即备份</button></div>' : '') +
      (issues.length ? '<div class="task-row"><span class="task-dot amber"></span><div><b>' + issues.length + ' 笔记录需要核对</b><p>逐笔查看原因，修改后自动更新。</p></div><button class="btn sm" data-act="home-records" data-preset="issues">去核对</button></div>' : '') +
      (unrecorded.length ? '<div class="task-row"><span class="task-dot"></span><div><b>' + unrecorded.length + ' 件已到日期的事由尚无记录</b><p>可以补记，也可以保留为空事由。</p></div><button class="btn sm" data-act="event-scope" data-scope="unrecorded">查看</button></div>' : '') +
      (!needBackup && !issues.length && !unrecorded.length ? '<div class="empty"><b>当前没有待处理事项</b><p>新往来及时记，重要日子提前安排。</p></div>' : '') +
      '<div class="panel-footer"><a href="#/stats">完整统计 →</a><a href="#/settings">备份与设置 →</a></div></section><section class="card"><div class="card-head"><h2>近期事由</h2><a href="#/events">全部事由 →</a></div>' +
      (upcoming.length ? upcoming.slice(0, 5).map(e => '<div class="agenda-row"><div class="date-tile"><b>' + e.date.slice(8) + '</b><small>' + e.date.slice(5, 7) + ' 月</small></div><div><a class="title" href="' + linkTo('events', e.id) + '">' + esc(e.title) + '</a><p>' + esc(e.type || '未分类') + ' · ' + (e.isMine ? '我家办事' : '亲友办事') + '</p></div>' + statusTag(eventStatus(e)) + '</div>').join('') : '<div class="empty">未来 60 天没有安排。<p>新建事由后，日期会出现在这里。</p></div>') +
      '</section></div><div class="workspace-grid"><section class="card"><div class="card-head"><h2>回礼参考</h2><a href="#/contacts">亲友往来 →</a></div><p class="section-note">截至今天，收多于送的亲友。差额不是债务，也不等于本次应送金额。</p>' +
      (moreIn.slice(0, 5).map(x => '<div class="person-row"><span class="avatar">' + esc(String(x.c.name || '人').slice(0, 1)) + '</span><div><a class="title" href="' + linkTo('contacts', x.c.id) + '">' + esc(displayName(x.c)) + '</a><p>' + esc([x.c.unit, x.c.relation].filter(Boolean).join(' · ') || '亲友') + ' · 最近 ' + esc(x.last?.date || '—') + '</p></div><b class="c-in">收多 ' + money(x.bal) + '</b></div>').join('') || '<div class="empty">暂无收多于送的亲友</div>') +
      '</section><section class="card"><div class="card-head"><h2>最近记下的往来</h2><a href="#/records">全部流水 →</a></div>' +
      (recent.map(r => '<div class="person-row"><span class="direction-dot ' + (r.direction === 'in' ? 'in' : 'out') + '">' + (r.direction === 'in' ? '收' : r.direction === 'out' ? '送' : '?') + '</span><div><b>' + esc(displayName(contactById(r.contactId))) + '</b><p>' + esc(eventLabel(eventById(r.eventId))) + ' · ' + esc(r.date) + '</p></div><button class="amount-link ' + (r.direction === 'in' ? 'c-in' : 'c-out') + '" data-act="edit-record" data-id="' + esc(r.id) + '" aria-label="编辑记录">' + (r.direction === 'in' ? '+' : '−') + money(r.amount) + '</button></div>').join('') || '<div class="empty">保存第一笔后，会在这里看到它。</div>') + '</section></div>';
  }

  /* ========== 页面：记录 ========== */
  const recFilter = { q: '', dir: '', contactId: '', eventId: '', unit: '', from: '', to: '', min: '', max: '', issue: '', sortKey: 'date', sortDir: 'desc' };
  let recordPage = 1;
  function filteredRecords() {
    const q = recFilter.q.toLowerCase();
    const issueMap = new Map(FZAnalytics.audit(state, today(), { includeConfirmed: true }).map(x => [String(x.record.id), x]));
    let recs = state.records.filter(r => {
      const c = contactById(r.contactId), ev = eventById(r.eventId);
      const issue = issueMap.get(String(r.id));
      if (recFilter.issue === 'confirmed' && !issue?.confirmed) return false;
      if (recFilter.issue && recFilter.issue !== 'confirmed' && (!issue || issue.confirmed || (recFilter.issue !== 'all' && !issue.reasons.includes(recFilter.issue)))) return false;
      if (recFilter.contactId && String(r.contactId) !== String(recFilter.contactId)) return false;
      if (recFilter.dir && r.direction !== recFilter.dir) return false;
      if (recFilter.eventId && String(r.eventId) !== String(recFilter.eventId)) return false;
      if (recFilter.unit && (c?.unit || '') !== recFilter.unit) return false;
      if (recFilter.from && r.date < recFilter.from) return false;
      if (recFilter.to && r.date > recFilter.to) return false;
      if (recFilter.min !== '' && r.amount < Number(recFilter.min)) return false;
      if (recFilter.max !== '' && r.amount > Number(recFilter.max)) return false;
      if (q && !`${c?.name || ''} ${c?.unit || ''} ${c?.dept || ''} ${ev?.title || ''} ${r.note || ''} ${r.method || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const k = recFilter.sortKey, dirMul = recFilter.sortDir === 'asc' ? 1 : -1;
    const keyOf = r => k === 'amount' ? Number(r.amount) || 0 : k === 'contact' ? (contactById(r.contactId)?.name || '') : k === 'event' ? (eventById(r.eventId)?.title || '') : k === 'unit' ? (contactById(r.contactId)?.unit || '') : k === 'dir' ? r.direction : k === 'method' ? (r.method || '') : r.date;
    recs.sort((a, b) => { const x = keyOf(a), y = keyOf(b); const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'zh'); return c ? c * dirMul : byDateDesc(a, b); });
    return recs;
  }
  function pageRecords() {
    const recs = filteredRecords();
    const t = FZAnalytics.summarize(recs);
    const pages = Math.max(1, Math.ceil(recs.length / 50)); recordPage = Math.min(recordPage, pages);
    const auditItems = FZAnalytics.audit(state, today(), { includeConfirmed: true });
    const issues = new Map(auditItems.map(x => [String(x.record.id), x]));
    const units = [...new Set(state.contacts.map(c => c.unit).filter(Boolean))].sort();
    const issueCount = auditItems.filter(x => !x.confirmed).length;
    const confirmedCount = auditItems.filter(x => x.confirmed).length;
    const pendingInResult = recs.filter(r => { const issue = issues.get(String(r.id)); return issue && !issue.confirmed; }).length;
    return `
      ${moduleHead('每一笔，都找得到', '按人、按事、按日期查账；筛选结果可完整导出。', '<button class="btn" data-act="voice-add">批量录入</button><button class="btn primary" data-act="add-record">＋ 记一笔</button>')}
      <div class="filter-shortcuts no-print">${[['all','全部流水'],['month','本月'],['year','本年'],['issues','待核对 ' + issueCount],...(confirmedCount ? [['confirmed','已确认 ' + confirmedCount]] : [])].map(([key,label]) => `<button class="btn sm" data-act="record-preset" data-preset="${key}">${label}</button>`).join('')}</div>
      <div class="card">
        <div class="card-head"><h2>全部记录 <span class="c-muted" style="font-size:13px;font-weight:400">共 ${recs.length} 条 · 收 <span class="c-in">${money(t.inAmt)}</span> · 送 <span class="c-out">${money(t.outAmt)}</span></span></h2>
          <div class="btn-row"><button class="btn sm" id="exportFiltered">导出当前结果 CSV</button>${pendingInResult ? `<button class="btn sm" data-act="confirm-filtered-issues">批量确认 ${pendingInResult} 条</button>` : ''}<button class="btn sm" data-act="voice-add">🎤 语音批量</button><button class="btn primary sm" data-act="add-record">＋ 记一笔</button></div></div>
        <div class="filters no-print" id="filters">
          <div class="field" style="flex:1;min-width:160px"><label>搜索</label><input name="q" value="${esc(recFilter.q)}" placeholder="姓名 / 单位 / 事由 / 备注"></div>
          <div class="field"><label>方向</label><select name="dir">${options([{ value: '', label: '全部' }, { value: 'in', label: '收' }, { value: 'out', label: '送' }], recFilter.dir)}</select></div>
          <div class="field" style="min-width:180px"><label>事由</label><select name="eventId">${options(state.events.slice().sort(byDateDesc).map(e => ({ value: e.id, label: e.title })), recFilter.eventId, '全部')}</select></div>
          <div class="field"><label>单位</label><select name="unit">${options(units, recFilter.unit, '全部')}</select></div>
          <div class="field"><label>联系人</label><select name="contactId">${options(state.contacts.map(c => ({value:c.id,label:displayName(c)})), recFilter.contactId, '全部')}</select></div>
          <div class="field"><label>核对范围</label><select name="issue">${options([{value:'',label:'全部记录'},{value:'all',label:'待确认提示 ' + issueCount},{value:'confirmed',label:'已确认提示 ' + confirmedCount},...['日期无效','金额无效','方向无效','联系人未关联','事由未关联','未来日期','疑似重复'].map(x => ({value:x,label:'待确认 · ' + x}))], recFilter.issue)}</select></div>
          <div class="field"><label>从</label><input type="date" name="from" value="${recFilter.from}"></div>
          <div class="field"><label>到</label><input type="date" name="to" value="${recFilter.to}"></div>
          <div class="field" style="min-width:90px"><label>金额≥</label><input type="number" name="min" value="${recFilter.min}"></div>
          <div class="field" style="min-width:90px"><label>金额≤</label><input type="number" name="max" value="${recFilter.max}"></div>
          <button class="btn" id="resetFilter">重置</button>
        </div>
        ${(recFilter.from && recFilter.to && recFilter.from > recFilter.to) || (recFilter.min !== '' && recFilter.max !== '' && Number(recFilter.min) > Number(recFilter.max)) ? '<p role="alert" class="c-danger">起始值不能大于结束值，请调整筛选范围。</p>' : ''}
        <div class="result-summary" aria-live="polite">匹配 ${recs.length} 笔 · 收 ¥${money(t.inAmt)} · 送 ¥${money(t.outAmt)} · 差额 ¥${money(t.net)}<span>汇总与导出包含全部匹配记录</span></div>
        ${recs.length ? recordsTable(recs.slice((recordPage-1)*50, recordPage*50), { sortable: true, sortKey: recFilter.sortKey, sortDir: recFilter.sortDir, issues }) : '<div class="empty">没有符合当前条件的记录。<p>试试重置筛选，或记下第一笔往来。</p></div>'}
        <div class="pager no-print"><span>第 ${recordPage} / ${pages} 页 · 每页 50 笔</span><button class="btn sm" data-act="record-page" data-page="${recordPage-1}" ${recordPage<=1?'disabled':''}>上一页</button><button class="btn sm" data-act="record-page" data-page="${recordPage+1}" ${recordPage>=pages?'disabled':''}>下一页</button></div>
      </div>`;
  }

  /* ========== 页面：事由 ========== */
  const eventView = { q: '', scope: 'all', mine: '' };
  function pageEvents() {
    const q = eventView.q.trim().toLowerCase();
    const evs = state.events.filter(e => {
      if (q && ![e.title,e.place,e.type,contactById(e.host)?.name,e.note].join(' ').toLowerCase().includes(q)) return false;
      if (eventView.mine && Boolean(e.isMine) !== (eventView.mine === 'mine')) return false;
      const status = eventStatus(e);
      return eventView.scope === 'all' || (eventView.scope === 'upcoming' ? e.date >= today() && daysBetween(today(), e.date) <= 60 : status.key === eventView.scope);
    }).sort(eventView.scope === 'upcoming' ? byDateAsc : byDateDesc);
    return moduleHead('把一场事，记成一本礼簿', '提前安排日子，现场连续录入，事后核对名单。', '<button class="btn primary" data-act="add-event">＋ 新建事由</button>') +
      '<section class="card"><div class="module-controls"><label>搜索<input id="eq" value="' + esc(eventView.q) + '" placeholder="事由 / 主办人 / 地点"></label><label>状态<select id="eventScope">' +
      options([{value:'all',label:'全部事由'},{value:'upcoming',label:'近 60 天'},{value:'unrecorded',label:'到期未记账'},{value:'recorded',label:'名单待核对'},{value:'reviewed',label:'名单已核对'},{value:'undated',label:'日期待核对'}],eventView.scope) +
      '</select></label><label>谁的事<select id="eventMine">' + options([{value:'',label:'全部'},{value:'mine',label:'我家办事'},{value:'other',label:'亲友办事'}],eventView.mine) +
      '</select></label></div><div class="result-summary" aria-live="polite">找到 ' + evs.length + ' 件 / 共 ' + state.events.length + ' 件事由</div></section>' +
      (evs.length ? '<div class="event-grid">' + evs.map(e => {
        const rs = recordsOf({eventId:e.id}), t = FZAnalytics.summarize(rs), host = contactById(e.host), status = eventStatus(e);
        return '<article class="card event-card"><div class="card-head"><span class="section-kicker">' + esc(e.date || '未填日期') + '</span>' + statusTag(status) + '</div><h2><a href="' + linkTo('events',e.id) + '">' + esc(e.title) + '</a></h2><p class="section-note">' + esc(e.type || '未分类') + ' · ' + (e.isMine ? '我家办事' : '亲友办事') + (host ? ' · '+esc(displayName(host)) : '') + '</p><p class="event-place">' + esc(e.place || '地点未填写') + '</p><div class="event-totals"><div><span>收到</span><b class="c-in">¥ '+money(t.inAmt)+'</b></div><div><span>送出</span><b class="c-out">¥ '+money(t.outAmt)+'</b></div><div><span>参与亲友</span><b>'+new Set(rs.map(r=>r.contactId)).size+' 人</b></div></div><div class="panel-footer"><a href="'+linkTo('events',e.id)+'">名单与核对 →</a><button class="btn sm" data-act="voice-add" data-event="'+esc(e.id)+'">批量</button><button class="btn primary sm" data-act="add-record" data-event="'+esc(e.id)+'">记一笔</button></div></article>';
      }).join('') + '</div>' : '<div class="card empty">没有符合当前条件的事由。<p>新建事由，或切换状态查看其他礼簿。</p></div>');
  }
  function pageEventDetail(id) {
    const e = eventById(id);
    if (!e) return '<div class="card"><div class="empty">事由不存在</div></div>';
    const recs = recordsOf({ eventId: id }).sort((a, b) => b.amount - a.amount || byDateDesc(a, b));
    const t = totals(recs);
    const host = contactById(e.host);
    const main = e.isMine ? recs.filter(r => r.direction === 'in') : recs.filter(r => r.direction === 'out');
    const participantCount = new Set(main.map(r => r.contactId)).size;
    const avg = participantCount ? sum(main.map(r => r.amount)) / participantCount : 0;
    const byUnit = [...groupBy(recs, r => contactById(r.contactId)?.unit || '（未填单位）').entries()].map(([u, rs]) => ({ u, t: totals(rs), depts: [...groupBy(rs, r => contactById(r.contactId)?.dept || '（未填科室）').entries()].map(([d, drs]) => ({ d, t: totals(drs) })) })).sort((a, b) => (b.t.inAmt + b.t.outAmt) - (a.t.inAmt + a.t.outAmt));
    const byMethod = [...groupBy(recs, r => r.method || '未填').entries()].map(([m, rs]) => `${m} ${rs.length} 笔 ${money(sum(rs.map(r => r.amount)))} 元`).join('；');
    // 回礼对照：这次收到礼的人，之前我给过他多少
    const compare = e.isMine ? main.map(r => { const c = contactById(r.contactId); const prev = state.records.filter(x => x.contactId === r.contactId && x.direction === 'out' && x.date <= r.date).sort(byDateDesc)[0]; return { c, r, prev }; }) : main.map(r => { const c = contactById(r.contactId); const prev = state.records.filter(x => x.contactId === r.contactId && x.direction === 'in' && x.date <= r.date).sort(byDateDesc)[0]; return { c, r, prev }; });
    return `
      <a class="back no-print" href="#/events">← 返回事由列表</a>
      <div class="page-title"><h1>${esc(e.title)}</h1>${e.isMine ? '<span class="tag mine">我家办事</span>' : ''}<span class="tag">${esc(e.type)}</span><span class="meta">${e.date}${e.place ? ' · ' + esc(e.place) : ''}${host ? ` · 主办：<a href="#/contacts/${host.id}">${esc(displayName(host))}</a>` : ''}</span>
        <div class="btn-row no-print" style="margin-left:auto"><button class="btn sm" data-act="edit-event" data-id="${e.id}">编辑</button><button class="btn sm" data-act="export-event-csv" data-id="${e.id}">导出名单 CSV</button><button class="btn sm" data-act="print">打印</button><button class="btn sm" data-act="voice-add" data-event="${e.id}">🎤 语音批量</button><button class="btn primary sm" data-act="add-record" data-event="${e.id}">＋ 添加记录</button></div></div>
      ${e.note ? `<p class="c-muted">${esc(e.note)}</p>` : ''}
      <div class="card event-workbench"><div><h2>这场事的记账台 ${statusTag(eventStatus(e))}</h2><p>连续录入沿用事由与金额；核对名单后可标记完成。明细改变会自动转回待核对。</p></div><div class="btn-row"><button class="btn primary" data-act="add-record" data-event="${esc(e.id)}">连续记账</button><button class="btn" data-act="review-event" data-id="${esc(e.id)}" ${!recs.length || e.date>today() ? 'disabled' : ''}>${eventStatus(e).key==='reviewed'?'重新核对':'标记名单已核对'}</button></div></div>
      ${statCards(t, { netSub: '本事由', cnt: '每人平均', cntSub: `${e.isMine ? '收礼' : '送礼'} ${participantCount} 人 · ${main.length} 笔`, countValue: money(avg) })}
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
  let contactView = { q: '', mode: 'group', balance: 'all' };
  function pageContacts() {
    const q = contactView.q.trim().toLowerCase(), all = contactSummaries();
    const list = all.filter(x => (!q || [x.c.name,x.c.unit,x.c.dept,x.c.relation,x.c.phone,x.c.note].join(' ').toLowerCase().includes(q)) &&
      (contactView.balance === 'all' || (contactView.balance === 'positive' ? x.bal > 0 : contactView.balance === 'negative' ? x.bal < 0 : contactView.balance === 'none' ? !x.t.count : x.t.count > 0 && x.bal === 0)));
    const row = x => '<tr><td><a class="title" href="'+linkTo('contacts',x.c.id)+'">'+esc(x.c.name)+'</a><small class="cell-sub">'+esc([x.c.unit,x.c.dept,x.c.relation].filter(Boolean).join(' · ') || '未填写关系')+'</small></td><td class="num c-in">'+money(x.t.inAmt)+'</td><td class="num c-out">'+money(x.t.outAmt)+'</td><td class="num">'+(x.bal > 0 ? '收多 '+money(x.bal) : x.bal < 0 ? '送多 '+money(-x.bal) : x.t.count ? '收送持平' : '暂无往来')+'</td><td>'+esc(x.last?.date || '—')+'<small class="cell-sub">'+x.t.count+' 笔</small></td><td><button class="btn sm" data-act="add-record" data-contact="'+esc(x.c.id)+'">记一笔</button> <button class="btn link sm" data-act="edit-contact" data-id="'+esc(x.c.id)+'">编辑</button></td></tr>';
    const table = rows => '<div class="table-wrap"><table><thead><tr><th>亲友 / 单位</th><th class="num">累计收到</th><th class="num">累计送出</th><th class="num">往来差额</th><th>最近往来</th><th class="no-print">操作</th></tr></thead><tbody>'+rows.map(row).join('')+'</tbody></table></div>';
    list.sort((a,b) => contactView.mode === 'recent' ? byDateDesc(a.last || {}, b.last || {}) : contactView.mode === 'balance' ? Math.abs(b.bal)-Math.abs(a.bal) : b.t.gross-a.t.gross || String(a.c.name).localeCompare(String(b.c.name),'zh'));
    const body = contactView.mode === 'group' ? [...groupBy(list,x=>x.c.unit || '未填单位')].map(([unit,rows]) => '<details class="contact-group" open><summary>'+esc(unit)+' <span>'+rows.length+' 人</span></summary>'+table(rows)+'</details>').join('') : table(list);
    return moduleHead('往来有记录，回礼有参考', '截至今天的有效往来。差额仅作参考，不代表债务或必须回礼。','<button class="btn primary" data-act="add-contact">＋ 新增亲友</button>') +
      '<div class="filter-shortcuts no-print">'+[['all','全部亲友',all.length],['positive','收多于送',all.filter(x=>x.bal>0).length],['negative','送多于收',all.filter(x=>x.bal<0).length],['balanced','收送持平',all.filter(x=>x.t.count && x.bal===0).length],['none','尚无往来',all.filter(x=>!x.t.count).length]].map(([key,label,n])=>'<button class="btn sm '+(contactView.balance===key?'selected':'')+'" data-act="contact-scope" data-scope="'+key+'" aria-pressed="'+(contactView.balance===key)+'">'+label+' '+n+'</button>').join('')+'</div><section class="card"><div class="module-controls"><label>找亲友<input id="cq" value="'+esc(contactView.q)+'" placeholder="姓名 / 单位 / 电话 / 备注"></label><label>查看方式<select id="cmode">'+options([{value:'group',label:'按单位分组'},{value:'list',label:'往来金额最多'},{value:'recent',label:'最近往来优先'},{value:'balance',label:'往来差额最大'}],contactView.mode)+'</select></label></div><div class="result-summary" aria-live="polite">找到 '+list.length+' 位亲友<span>点击姓名查看完整时间线</span></div>'+(list.length ? body : '<div class="empty">没有符合条件的亲友。<p>可以更换关键词或查看全部亲友。</p></div>')+'</section>';
  }
  function pageContactDetail(id) {
    const c = contactById(id);
    if (!c) return '<div class="card"><div class="empty">联系人不存在</div></div>';
    const recs = recordsOf({ contactId: id }).sort(byDateDesc);
    const eligible = recs.filter(r => FZAnalytics.validRecord(r) && r.date <= today());
    const t = FZAnalytics.summarize(eligible);
    const lastIn = eligible.find(r => r.direction === 'in'), lastOut = eligible.find(r => r.direction === 'out');
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
        <div class="stat"><div class="label">往来差额</div><div class="value ${bal > 0 ? 'c-in' : bal < 0 ? 'c-out' : ''}">${bal > 0 ? '收多 ' : bal < 0 ? '送多 ' : ''}${money(Math.abs(bal))}</div><div class="sub">截至今天 · 仅供回礼参考</div></div>
        <div class="stat"><div class="label">往来时间</div><div class="value" style="font-size:16px">${first ? `${first.date}<br>至 ${last.date}` : '—'}</div><div class="sub">${recs.length} 笔往来${first && last ? `，${Math.floor(daysBetween(first.date, today()) / 365)} 年` : ''}</div></div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <section class="card" style="grid-column:1/-1"><div class="card-head"><h2>下次见面前，先看这几笔</h2><button class="btn sm" data-act="person-records" data-id="${esc(c.id)}">筛选全部流水</button></div><div class="reference-grid"><div><span>最近对方给我</span><strong>${lastIn ? '¥ ' + money(lastIn.amount) : '暂无记录'}</strong><small>${lastIn ? esc(lastIn.date) + ' · ' + esc(eventLabel(eventById(lastIn.eventId))) : '有记录后会显示在这里'}</small></div><div><span>最近我给对方</span><strong>${lastOut ? '¥ ' + money(lastOut.amount) : '暂无记录'}</strong><small>${lastOut ? esc(lastOut.date) + ' · ' + esc(eventLabel(eventById(lastOut.eventId))) : '有记录后会显示在这里'}</small></div><div><span>回礼参考</span><strong>${lastIn && Number(state.settings.returnRatio)>0 ? '¥ '+money(Math.round(Number(lastIn.amount)*Number(state.settings.returnRatio)*100)/100) : '按实际情况决定'}</strong><small>最近收到金额 × 设置系数；不自动记入账本</small></div></div></section>
        <div class="card" style="grid-column:1/-1"><h2>完整时间线</h2>
          ${recs.length ? [...years.entries()].map(([y, rs]) => { const yt = totals(rs); return `<div class="tl-year">${y} 年 <span style="font-weight:400;font-size:13px">收 <span class="c-in">${money(yt.inAmt)}</span> · 送 <span class="c-out">${money(yt.outAmt)}</span></span></div><div class="timeline">${rs.map(r => { const ev = eventById(r.eventId); return `<div class="tl-item ${r.direction}"><div class="tl-date">${r.date}</div><div class="tl-body"><div><span class="tag ${r.direction}">${r.direction === 'in' ? '他给我' : '我给他'}</span> <a href="#/events/${r.eventId}"><b>${esc(eventLabel(ev))}</b></a> <span class="c-muted">${esc(ev?.type || '')}${r.method ? ' · ' + esc(r.method) : ''}${r.note ? ' · ' + esc(r.note) : ''}</span></div><div class="btn-row"><span class="amt ${r.direction === 'in' ? 'c-in' : 'c-out'}">${r.direction === 'in' ? '+' : '-'}${money(r.amount)}</span><button class="btn link sm no-print" data-act="edit-record" data-id="${r.id}">编辑</button></div></div></div>`; }).join('')}</div>`; }).join('') : '<div class="empty">还没有往来记录</div>'}
        </div>
        ${hosted.length ? `<div class="card" style="grid-column:1/-1"><h2>作为主办人的事由</h2>${hosted.map(e => `<div class="list-item"><a href="#/events/${e.id}">${esc(e.title)}</a><span class="meta">${e.date} · ${esc(e.type)}</span></div>`).join('')}</div>` : ''}
      </div>`;
  }

  /* ========== 页面：统计 ========== */
  const statMoney = n => money(n);
  function statRows(rows, limit = 10) {
    const list = rows.filter(r => r.count).slice(0, limit);
    if (!list.length) return '<div class="empty">暂无可统计数据</div>';
    const max = Math.max(1, ...list.map(r => r.gross));
    return `<div class="legend"><span><i style="background:var(--in)"></i>收</span><span><i style="background:var(--out)"></i>送</span></div><div class="rank-bars">${list.map(r => {
      const net = r.inAmt - r.outAmt;
      return `<div class="rank-row"><div class="rank-label" title="${esc(r.label)}">${r.link ? `<a href="${r.link}">${esc(r.label)}</a>` : esc(r.label)}</div><div class="rank-main"><div class="rank-track"><span class="rank-fill in" style="width:${r.inAmt / max * 100}%"></span><span class="rank-fill out" style="width:${r.outAmt / max * 100}%"></span></div><div class="rank-meta"><span>收 ${statMoney(r.inAmt)} · 送 ${statMoney(r.outAmt)}</span><b class="${net >= 0 ? 'c-in' : 'c-out'}">${net >= 0 ? '+' : '−'}${statMoney(Math.abs(net))}</b><em>合计 ${statMoney(r.gross)}</em></div></div></div>`;
    }).join('')}</div>`;
  }
  function statTable(rows, limit = 12) {
    const list = rows.filter(r => r.count).slice(0, limit);
    if (!list.length) return '<div class="empty">暂无可统计数据</div>';
    return `<div class="table-wrap stats-table-wrap"><table><thead><tr><th>对象</th><th class="num">笔数</th><th class="num">收到</th><th class="num">送出</th><th class="num">差额</th><th>最近</th></tr></thead><tbody>${list.map(r => { const n = r.inAmt - r.outAmt; return `<tr><td>${r.link ? `<a href="${r.link}"><b>${esc(r.label)}</b></a>` : `<b>${esc(r.label)}</b>`}</td><td class="num">${r.count}</td><td class="num c-in">${statMoney(r.inAmt)}</td><td class="num c-out">${statMoney(r.outAmt)}</td><td class="num ${n >= 0 ? 'c-in' : 'c-out'}">${n >= 0 ? '+' : '−'}${statMoney(Math.abs(n))}</td><td class="c-muted">${r.last || '—'}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  function balanceTable(rows, title) {
    const list = rows.filter(r => r.contact).slice(0, 8);
    return `<h3>${title}（${rows.length} 人）</h3>${list.length ? `<div class="table-wrap stats-table-wrap"><table><thead><tr><th>联系人</th><th class="num">累计收到</th><th class="num">累计送出</th><th class="num">差额</th></tr></thead><tbody>${list.map(r => { const n = r.net; return `<tr><td><a href="#/contacts/${encodeURIComponent(r.key)}"><b>${esc(displayName(r.contact))}</b></a></td><td class="num c-in">${statMoney(r.inAmt)}</td><td class="num c-out">${statMoney(r.outAmt)}</td><td class="num ${n >= 0 ? 'c-in' : 'c-out'}">${n >= 0 ? '+' : '−'}${statMoney(Math.abs(n))}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">暂无</div>'}`;
  }
  function statTrend(rows) {
    const max = Math.max(1, ...rows.map(r => Math.max(r.inAmt, r.outAmt)));
    const W = 760, H = 240, L = 54, R = 12, T = 16, B = 38, CW = W - L - R, CH = H - T - B, step = CW / rows.length, bar = Math.max(8, Math.min(18, step * .25));
    const short = s => s.length > 7 ? s.slice(5) : s;
    const grid = [0, .25, .5, .75, 1].map(v => { const y = T + CH * (1 - v); return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" class="chart-grid"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="chart-axis">${statMoney(max * v)}</text>`; }).join('');
    const bars = rows.map((r, i) => { const x = L + i * step + step / 2, ih = r.inAmt / max * CH, oh = r.outAmt / max * CH; return `<g><rect x="${x - bar - 2}" y="${T + CH - ih}" width="${bar}" height="${ih}" rx="3" class="chart-bar in"><title>${esc(r.key)} 收 ${statMoney(r.inAmt)}</title></rect><rect x="${x + 2}" y="${T + CH - oh}" width="${bar}" height="${oh}" rx="3" class="chart-bar out"><title>${esc(r.key)} 送 ${statMoney(r.outAmt)}</title></rect><text x="${x}" y="${H - 13}" text-anchor="middle" class="chart-axis">${esc(short(r.key))}</text></g>`; }).join('');
    return `<div class="chart-wrap"><svg class="trend-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="收送金额趋势"><title>收送金额趋势</title>${grid}<line x1="${L}" y1="${T + CH}" x2="${W - R}" y2="${T + CH}" class="chart-axis-line"/>${bars}</svg></div>`;
  }
  let statsYear = '', statsMode = 'all';
  function pageStats() {
    if (!state.records.length) return '<div class="card"><div class="empty">暂无数据</div></div>';
    const todayDate = today(), years = [...new Set(state.records.map(r => String(r.date || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y) && y <= todayDate.slice(0, 4)))].sort().reverse();
    const mode = statsYear ? `year:${statsYear}` : statsMode;
    let a;
    try { a = FZAnalytics.build(state, { mode }, todayDate); } catch (e) { a = FZAnalytics.build(state, { mode: 'all' }, todayDate); }
    const labelFor = (r, key) => key === 'person' ? (a.contacts.get(r.key) ? displayName(a.contacts.get(r.key)) : '未关联联系人') : key === 'event' ? (a.events.get(r.key)?.title || '未关联事由') : r.key;
    const rowsFor = key => a.structures[key].map(r => ({ ...r, label: labelFor(r, key), count: r.count, gross: r.gross, inAmt: r.inAmt, outAmt: r.outAmt, last: r.records.map(x => x.date).sort().slice(-1)[0] || '' }));
    const persons = a.byPerson.map(r => ({ ...r, label: labelFor(r, 'person'), link: a.contacts.get(r.key) ? '#/contacts/' + encodeURIComponent(r.key) : null, last: r.records.map(x => x.date).sort().slice(-1)[0] || '', gross: r.gross }));
    const previousText = a.period.comparison ? ` · 对比上期 ${statMoney(a.prevTotals.gross)}（${a.prevTotals.gross ? ((a.totals.gross / a.prevTotals.gross - 1) * 100).toFixed(1) + '%' : '—'}）` : '';
    const periodText = `${a.period.label}：${a.period.from} 至 ${a.period.to}${previousText}`;
    const auditItems = FZAnalytics.audit(state, todayDate, { includeConfirmed: true });
    const openingNet = a.opening.net, closingNet = a.closing.net, issueCount = auditItems.filter(x => !x.confirmed).length, confirmedCount = auditItems.filter(x => x.confirmed).length;
    const concentration = persons.length ? persons.slice(0, 3).reduce((s, r) => s + r.gross, 0) / Math.max(1, a.totals.gross) * 100 : 0;
    const modes = [{ value: 'all', label: '全部历史' }, { value: 'ytd', label: '本年截至今天' }, { value: 'last12', label: '近 12 个月' }, ...years.map(y => ({ value: `year:${y}`, label: `${y} 年` }))];
    const audit = issueCount ? `<button class="btn link sm" data-act="home-records" data-preset="issues">有 ${issueCount} 条记录需要核对 →</button>` : confirmedCount ? `${confirmedCount} 条提示已经人工确认` : '记录字段完整，未发现核对提示';
    return `
      <div class="stats-head"><div><div class="eyebrow">经营视角 · 人情往来</div><h1>统计分析</h1><p class="c-muted">${esc(periodText)} · 收送差额 = 收 − 送</p></div><label class="stats-period">分析期间<select id="statsPeriod">${options(modes, mode)}</select></label></div>
      <div class="stats-kpis"><div class="stat"><div class="label">本期往来总额</div><div class="value">${statMoney(a.totals.gross)}</div><div class="sub">收 ${statMoney(a.totals.inAmt)} · 送 ${statMoney(a.totals.outAmt)}</div></div><div class="stat"><div class="label">本期收送差额</div><div class="value ${a.totals.net >= 0 ? 'c-in' : 'c-out'}">${a.totals.net >= 0 ? '+' : '−'}${statMoney(Math.abs(a.totals.net))}</div><div class="sub">期内结果</div></div><div class="stat"><div class="label">截至期末人情差额</div><div class="value ${closingNet >= 0 ? 'c-in' : 'c-out'}">${closingNet >= 0 ? '+' : '−'}${statMoney(Math.abs(closingNet))}</div><div class="sub">累计收 − 累计送</div></div><div class="stat"><div class="label">活跃对象</div><div class="value">${new Set(a.records.map(r => r.contactId)).size}</div><div class="sub">涉及 ${new Set(a.records.map(r => r.eventId)).size} 个事由</div></div><div class="stat"><div class="label">笔均 / 中位数</div><div class="value">${statMoney(a.totals.count ? a.totals.gross / a.totals.count : 0)}</div><div class="sub">中位数 ${statMoney(a.median)}</div></div></div>
      <div class="stats-insights"><span>期初累计差额：<b>${openingNet >= 0 ? '+' : '−'}${statMoney(Math.abs(openingNet))}</b></span><span>期内收礼笔均：<b>${statMoney(a.totals.inCnt ? a.totals.inAmt / a.totals.inCnt : 0)}</b></span><span>期内送礼笔均：<b>${statMoney(a.totals.outCnt ? a.totals.outAmt / a.totals.outCnt : 0)}</b></span><span>Top 3 对象占总额：<b>${concentration.toFixed(1)}%</b></span><span class="${issueCount ? 'c-warn' : 'c-in'}">${audit}</span></div>
      <div class="stats-layout"><section class="card stats-wide"><div class="card-head"><div><h2>收送趋势</h2><p class="chart-caption">按月展示；跨度超过 24 个月时自动按年汇总</p></div><div class="legend"><span><i style="background:var(--in)"></i>收</span><span><i style="background:var(--out)"></i>送</span></div></div>${statTrend(a.trend)}</section><section class="card"><h2>收送结构</h2><p class="chart-caption">按业务维度拆分，优先关注差额和总额</p>${statRows(rowsFor('type'), 8)}</section></div>
      <div class="stats-layout"><section class="card"><h2>往来对象</h2><p class="chart-caption">按本期金额排序；累计差额见联系人详情</p>${statTable(persons)}</section><section class="card"><h2>单位 / 科室</h2><p class="chart-caption">用于识别集中往来来源</p><div class="stats-subhead">单位</div>${statRows(rowsFor('unit'), 8)}<div class="stats-subhead">科室</div>${statRows(rowsFor('dept'), 8)}</section></div>
      <div class="stats-layout"><section class="card"><h2>关系 / 支付方式</h2><div class="stats-subhead">关系</div>${statRows(rowsFor('relation'), 8)}<div class="stats-subhead">支付方式</div>${statRows(rowsFor('method'), 8)}</section><section class="card"><h2>人情余额</h2><p class="chart-caption">截至期末累计净额，正数表示收得更多，负数表示对方尚未回礼</p><div class="balance-list">${balanceTable(a.positive, '我欠人情')}${balanceTable(a.negative, '对方欠我')}</div></section></div>
      <div class="card stats-audit"><div class="card-head"><div><h2>数据核对</h2><p class="chart-caption">统计只纳入日期、方向、金额有效且不晚于今天的记录。人工确认会关闭提示，但不会把无效字段强行计入统计。</p></div><div class="btn-row"><b class="${issueCount ? 'c-warn' : 'c-in'}">${issueCount ? issueCount + ' 条待确认' : '没有待确认项'}</b>${confirmedCount ? `<button class="btn sm" data-act="record-preset" data-preset="confirmed">查看已确认 ${confirmedCount} 条</button>` : ''}</div></div>${issueCount ? `<div class="audit-list">${a.issues.slice(0, 8).map(x => `<div class="audit-item"><span>${esc(x.record.date || '无日期')} · ${esc(x.record.note || x.record.id)}</span><b>${esc(x.reasons.join('、'))}</b></div>`).join('')}${issueCount > 8 ? `<div class="c-muted">还有 ${issueCount - 8} 条，请到记录页筛选核对。</div>` : ''}</div>` : `<div class="empty">${confirmedCount ? '所有核对提示均已人工确认，可随时查看或重新核对。' : '金额、日期、方向和关联关系均可用于统计。'}</div>`}</div>`;
  }


  /* ========== 页面：设置 ========== */
  function pageSettings() {
    const s = state.settings;
    const auditItems = FZAnalytics.audit(state, today(), { includeConfirmed: true }), check = auditItems.filter(x => !x.confirmed), confirmed = auditItems.filter(x => x.confirmed), recovery = getRecovery();
    return `
      ${moduleHead('账本在自己手里', '查看数据状况、下载备份、预览导入；原有 JSON 可继续使用。')}
      <section class="card safety-panel"><div><span class="section-kicker">数据与恢复</span><h2>${state.records.length} 笔往来，${state.contacts.length} 位亲友</h2><p>仅保存在当前浏览器；手机和电脑需通过 JSON 备份迁移，尚未自动同步。</p></div><div class="btn-row"><button class="btn" data-act="home-records" data-preset="issues">待确认 ${check.length} 笔</button>${confirmed.length ? `<button class="btn" data-act="home-records" data-preset="confirmed">已确认 ${confirmed.length} 笔</button>` : ''}${recovery ? '<button class="btn" id="restoreRecovery">恢复导入前的账本</button>' : ''}</div>${recovery ? `<p class="section-note">保留最近一次导入前的本机恢复点：${new Date(recovery.savedAt).toLocaleString('zh-CN')}。恢复会先保存当前版本，可再次切换。</p>` : '<p class="section-note">每次合并或覆盖导入前，自动保留一个本机恢复点。恢复点与本站数据一起清理，不能代替下载备份。</p>'}</section>
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
          <p class="c-muted" style="font-size:13px;margin-top:12px">示例数据用于体验，会与现有数据合并。<br>版本 1.3.1 · 本地账本 · 支持离线</p>
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
  const RECOVERY_KEY = 'fzq_recovery_v1';
  function getRecovery() {
    try { const r = JSON.parse(localStorage.getItem(RECOVERY_KEY)); return r?.data ? r : null; } catch { return null; }
  }
  function installData(next, message) {
    const previous = state;
    try {
      // 先写恢复点，再原子替换主数据；任何存储失败均不切换内存账本。
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({ savedAt: Date.now(), data: previous }));
      next = { ...next, meta: { ...next.meta, updatedAt: Date.now() } };
      localStorage.setItem(KEY, JSON.stringify(next));
      state = next; closeModal(); render(); toast(message);
    } catch (e) { toast('未更新账本：本机存储空间不足或不可写，请先导出备份。', true); }
  }
  function restoreRecovery() {
    const saved = getRecovery(); if (!saved) return;
    let next; try { next = normalizeData(saved.data); } catch (e) { return toast('恢复点格式异常，当前账本未改变', true); }
    confirmDialog('恢复到 ' + esc(new Date(saved.savedAt).toLocaleString('zh-CN')) + ' 的账本？包含 ' + next.records.length + ' 笔记录。当前账本将保留为新的恢复点。', () => installData(next, '已恢复，可在设置中切回上一版本'), '恢复账本');
  }
  function importJson(file) {
    const reader = new FileReader();
    reader.onerror = () => toast('文件读取失败，请重新选择', true);
    reader.onload = () => {
      let d;
      try {
        const raw = JSON.parse(reader.result);
        if (!Array.isArray(raw.contacts) || !Array.isArray(raw.records)) throw new Error('备份需要包含联系人与记录数组');
        d = normalizeData(raw);
      } catch (e) { return toast('未导入：' + e.message, true); }
      const preview = FZAnalytics.mergePreview(state, d), check = FZAnalytics.audit(d, today());
      const conflicts = Object.values(preview.counts).reduce((n,c) => n+c.conflicts,0);
      const m = openModal('<h2>先看看这份账本</h2><p class="section-note">' + esc(file.name) + ' · 旧版 JSON 可直接使用</p><div class="table-wrap"><table><thead><tr><th>内容</th><th class="num">文件内</th><th class="num">合并新增</th><th class="num">同 ID 内容不同</th></tr></thead><tbody>' +
        [['contacts','亲友'],['events','事由'],['records','流水']].map(([k,label]) => '<tr><td>'+label+'</td><td class="num">'+d[k].length+'</td><td class="num">'+preview.counts[k].added+'</td><td class="num">'+preview.counts[k].conflicts+'</td></tr>').join('') +
        '</tbody></table></div><p>'+(check.length ? '文件内有 '+check.length+' 笔核对提示，导入后可逐笔检查。' : '未发现日期、金额和关联异常。')+'</p><p class="section-note">合并按 ID 去重，同 ID 保留当前内容'+(conflicts ? '（'+conflicts+' 项不同）' : '')+'；覆盖则使用文件中的完整账本。两种方式均先保存导入前恢复点。</p><div class="actions"><button class="btn" data-cancel>取消</button><button class="btn" data-replace>覆盖当前账本</button><button class="btn primary" data-merge>合并新增内容</button></div>');
      $('[data-cancel]',m).onclick = closeModal;
      $('[data-merge]',m).onclick = () => installData(preview.result, '已合并，旧记录保留');
      $('[data-replace]',m).onclick = () => confirmDialog('将当前 ' + state.records.length + ' 笔记录替换为文件中的 ' + d.records.length + ' 笔记录？导入前账本会保留为本机恢复点。', () => installData(d, '已覆盖导入，原账本可恢复'), '确认覆盖');
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

  /* 搜索统一保留中文组合输入、光标和滚动位置；离开页面取消旧定时器。 */
  let viewTimer;
  function bindSearch(input, update) {
    if (!input) return;
    let composing = false;
    const schedule = e => {
      clearTimeout(viewTimer);
      if (composing || e?.isComposing) return;
      update(input.value);
      viewTimer = setTimeout(() => {
        if (composing || !input.isConnected) return;
        const focused = document.activeElement === input, start = input.selectionStart, end = input.selectionEnd, scroll = window.scrollY;
        const selector = input.id ? '#' + input.id : '#filters [name="' + input.name + '"]';
        render();
        const next = $(selector);
        if (focused && next) { next.focus({ preventScroll: true }); if (next.type === 'text' || next.type === 'search') next.setSelectionRange(start, end); }
        window.scrollTo(0, scroll);
      }, 280);
    };
    input.addEventListener('compositionstart', () => { composing = true; clearTimeout(viewTimer); });
    input.addEventListener('compositionend', () => { composing = false; schedule(); });
    input.addEventListener('input', schedule);
  }
  /* ========== 页面级事件绑定（在 render 后） ========== */
  const origRender = render;
  render = function () {
    clearTimeout(viewTimer);
    origRender();
    if (loadError) return;
    const view = $('#view');
    const { page, id } = route();
    const demoBtn = $('#loadDemo', view); if (demoBtn) demoBtn.onclick = loadDemo;
    if (page === 'records') {
      const filt = $('#filters', view);
      $$('input', filt).forEach(input => bindSearch(input, value => { recFilter[input.name] = value; recordPage = 1; }));
      $$('select', filt).forEach(input => input.onchange = () => { recFilter[input.name] = input.value; recordPage = 1; render(); });
      $('#resetFilter', view).onclick = () => { setRecordPreset('all'); render(); };
      $('#exportFiltered', view).onclick = () => exportRecordsCsv(filteredRecords(), '份子钱流水');
      $$('th.sortable', view).forEach(th => th.onclick = () => { const k = th.dataset.sort; if (recFilter.sortKey === k) recFilter.sortDir = recFilter.sortDir === 'asc' ? 'desc' : 'asc'; else { recFilter.sortKey = k; recFilter.sortDir = k === 'amount' || k === 'date' ? 'desc' : 'asc'; } render(); });
    }
    if (page === 'contacts' && !id) {
      bindSearch($('#cq', view), value => { contactView.q = value; });
      $('#cmode', view).onchange = e => { contactView.mode = e.target.value; render(); };
    }
    if (page === 'events' && !id) {
      bindSearch($('#eq', view), value => { eventView.q = value; });
      $('#eventScope', view).onchange = e => { eventView.scope = e.target.value; render(); };
      $('#eventMine', view).onchange = e => { eventView.mine = e.target.value; render(); };
    }
    if (page === 'stats') { const sy = $('#statsPeriod', view); if (sy) sy.onchange = () => { statsYear = sy.value.startsWith('year:') ? sy.value.slice(5) : ''; statsMode = sy.value.startsWith('year:') ? 'all' : sy.value; render(); }; }
    if (page === 'settings') {
      const restore = $('#restoreRecovery', view); if (restore) restore.onclick = restoreRecovery;
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

  $('#quickAdd').disabled = Boolean(loadError);
  $('#voiceAdd').disabled = Boolean(loadError);
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
