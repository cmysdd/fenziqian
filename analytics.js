/* 可独立验证的分析口径；不写存储，不修改传入的账本。金额按分汇总。 */
(function (root) {
  'use strict';
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  function normalize(data, defaults = {}) {
    if (!object(data)) throw new Error('备份必须是 JSON 对象');
    const result = { ...data, contacts: Array.isArray(data.contacts) ? data.contacts : [], events: Array.isArray(data.events) ? data.events : [], records: Array.isArray(data.records) ? data.records : [], settings: { ...defaults, ...(object(data.settings) ? data.settings : {}) }, meta: object(data.meta) ? { ...data.meta } : {} };
    for (const key of ['contacts', 'events', 'records']) {
      result[key] = result[key].filter(object).map(x => ({ ...x, id: typeof x.id === 'string' && x.id ? x.id : `legacy-${key}-${Math.random().toString(36).slice(2, 10)}` }));
    }
    for (const key of ['eventTypes', 'methods']) {
      if (!Array.isArray(result.settings[key]) || !result.settings[key].length || result.settings[key].some(x => typeof x !== 'string')) result.settings[key] = [...(defaults[key] || [])];
    }
    return result;
  }
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function cents(v) {
    if (!['number', 'string'].includes(typeof v) || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 100)) ? Math.round((n + Number.EPSILON) * 100) : null;
  }
  const validRecord = r => validDate(r.date) && ['in', 'out'].includes(r.direction) && cents(r.amount) !== null;
  function summarize(records) {
    let inc = 0, out = 0, inCnt = 0, outCnt = 0;
    for (const r of records) {
      const amount = cents(r.amount);
      if (amount === null) continue;
      if (r.direction === 'in') { inc += amount; inCnt++; }
      if (r.direction === 'out') { out += amount; outCnt++; }
    }
    return { inAmt: inc / 100, outAmt: out / 100, net: (inc - out) / 100, gross: (inc + out) / 100, inCnt, outCnt, count: inCnt + outCnt };
  }
  function shiftYear(date) {
    const y = Number(date.slice(0, 4)) - 1;
    const s = y + date.slice(4);
    return validDate(s) ? s : `${y}-02-28`;
  }
  function periodFor(filter, records, today) {
    let from, to = today, label;
    const y = today.slice(0, 4);
    if (filter.mode === 'custom') { from = filter.from; to = filter.to; label = '自定义期间'; }
    else if (filter.mode === 'ytd') { from = y + '-01-01'; label = '本年截至今天'; }
    else if (filter.mode === 'last12') {
      const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 11);
      from = d.toISOString().slice(0, 10); label = '近 12 个月';
    } else if (/^year:\d{4}$/.test(filter.mode)) {
      const year = filter.mode.slice(5); from = year + '-01-01'; to = year === y ? today : year + '-12-31'; label = year + ' 年';
    } else { from = records.filter(r => validDate(r.date) && r.date <= today).map(r => r.date).sort()[0] || y + '-01-01'; label = '全部历史'; }
    if (!validDate(from) || !validDate(to) || from > to || to > today) throw new Error('请选择有效期间：开始不晚于结束，结束不晚于今天');
    const comparison = filter.mode !== 'all' && (new Date(to) - new Date(from)) / 86400000 <= 366;
    return { from, to, label, comparison, prevFrom: comparison ? shiftYear(from) : '', prevTo: comparison ? shiftYear(to) : '' };
  }
  function group(records, keyFn) {
    const groups = new Map();
    records.forEach(r => { const key = keyFn(r); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
    return [...groups].map(([key, rs]) => ({ key, records: rs, ...summarize(rs) })).sort((a, b) => b.gross - a.gross || String(a.key).localeCompare(String(b.key), 'zh'));
  }
  function audit(data, today) {
    const contacts = new Set(data.contacts.map(c => c.id)), events = new Set(data.events.map(e => e.id));
    const duplicates = new Map();
    data.records.forEach(r => { const key = JSON.stringify([r.contactId, r.eventId, r.date, r.direction, cents(r.amount), r.method || '']); if (!duplicates.has(key)) duplicates.set(key, []); duplicates.get(key).push(r.id); });
    const duplicateIds = new Set([...duplicates.values()].filter(ids => ids.length > 1).flat());
    const issues = [];
    data.records.forEach(r => {
      const reasons = [];
      if (!validDate(r.date)) reasons.push('日期无效');
      if (cents(r.amount) === null) reasons.push('金额无效');
      if (!['in', 'out'].includes(r.direction)) reasons.push('方向无效');
      if (!contacts.has(r.contactId)) reasons.push('联系人未关联');
      if (!events.has(r.eventId)) reasons.push('事由未关联');
      if (validDate(r.date) && r.date > today) reasons.push('未来日期');
      if (duplicateIds.has(r.id)) reasons.push('疑似重复');
      if (reasons.length) issues.push({ record: r, reasons });
    });
    return issues;
  }
  function build(data, filter, today) {
    const period = periodFor(filter, data.records, today);
    const valid = data.records.filter(validRecord);
    const records = valid.filter(r => r.date >= period.from && r.date <= period.to);
    const previous = period.comparison ? valid.filter(r => r.date >= period.prevFrom && r.date <= period.prevTo) : [];
    const cumulative = valid.filter(r => r.date <= period.to);
    const opening = summarize(valid.filter(r => r.date < period.from));
    const totals = summarize(records), closing = summarize(cumulative);
    const contacts = new Map(data.contacts.map(c => [c.id, c])), events = new Map(data.events.map(e => [e.id, e]));
    const byPerson = group(records, r => r.contactId || '').map(row => ({ ...row, contact: contacts.get(row.key) }));
    const balances = group(cumulative, r => r.contactId || '').map(row => ({ ...row, contact: contacts.get(row.key), last: row.records.map(r => r.date).sort().slice(-1)[0] || '' }));
    const knownBalances = balances.filter(r => r.contact);
    const positive = knownBalances.filter(r => r.net > 0).sort((a, b) => b.net - a.net);
    const negative = knownBalances.filter(r => r.net < 0).sort((a, b) => a.net - b.net);
    const amounts = records.map(r => cents(r.amount)).sort((a, b) => a - b), n = amounts.length;
    const median = n ? (n % 2 ? amounts[(n - 1) / 2] : (amounts[n / 2 - 1] + amounts[n / 2]) / 2) / 100 : 0;
    const start = new Date(period.from.slice(0, 7) + '-01T00:00:00Z'), end = new Date(period.to.slice(0, 7) + '-01T00:00:00Z');
    const monthly = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() < 24;
    const trendGroups = new Map(group(records, r => r.date.slice(0, monthly ? 7 : 4)).map(r => [r.key, r]));
    const trend = [];
    for (let d = start; d <= end;) {
      const key = d.toISOString().slice(0, monthly ? 7 : 4);
      trend.push({ key, ...(trendGroups.get(key) || summarize([])), records: trendGroups.get(key)?.records || [] });
      if (monthly) d.setUTCMonth(d.getUTCMonth() + 1); else { d.setUTCMonth(0); d.setUTCFullYear(d.getUTCFullYear() + 1); }
    }
    const dimensions = {
      type: r => events.get(r.eventId)?.type || '未分类',
      unit: r => contacts.get(r.contactId)?.unit || '未填单位',
      dept: r => [contacts.get(r.contactId)?.unit || '未填单位', contacts.get(r.contactId)?.dept || '未填科室'].join(' / '),
      relation: r => contacts.get(r.contactId)?.relation || '未填关系',
      method: r => r.method || '未填方式',
      event: r => r.eventId || ''
    };
    const structures = Object.fromEntries(Object.entries(dimensions).map(([key, fn]) => [key, group(records, fn)]));
    return { period, records, previous, totals, prevTotals: summarize(previous), opening, closing, byPerson, balances, positive, negative, median, trend, monthly, structures, contacts, events, issues: audit(data, today), excluded: data.records.filter(r => !validRecord(r)).length, future: valid.filter(r => r.date > today).length };
  }
  root.FZAnalytics = { normalize, validDate, cents, validRecord, summarize, periodFor, group, audit, build };
  if (typeof module !== 'undefined') module.exports = root.FZAnalytics;
})(typeof window !== 'undefined' ? window : globalThis);
