(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BusinessCore = api;
})(globalThis, function () {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024, DAY = 86400000;
  class ContractError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const fail = (code, message) => { throw new ContractError(code, message); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const own = (value, key) => Object.hasOwn(value, key);
  const dict = () => Object.create(null);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const ptr = value => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
  function shape(value, required, optional = [], path = '') {
    if (!object(value) || required.some(key => !own(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('INVALID_INPUT', (path || '入力') + ' の項目・必須値を確認してください。');
  }
  function array(value, path) { if (!Array.isArray(value)) fail('INVALID_INPUT', path + ' は配列にしてください。'); return value; }
  function text(value, path) { if (typeof value !== 'string' || !value.trim()) fail('INVALID_INPUT', path + ' は空でない文字列にしてください。'); return value; }
  function boolean(value, path) { if (typeof value !== 'boolean') fail('INVALID_INPUT', path + ' は true / false を明示してください。'); }
  function unique(values, code, path) { if (new Set(values).size !== values.length) fail(code, path + ' の識別子が重複しています。'); }
  function finding(list, rule_id, severity, path, observed, message, uncertainty = '') {
    list.push({ rule_id, severity, path, observed: JSON.parse(JSON.stringify(observed)), message, uncertainty });
  }
  function jsonLimits(request) {
    let rows = 0;
    function walk(value, depth) {
      if (depth > 64) fail('LIMIT_EXCEEDED', 'JSON の入れ子は 64 段階以下にしてください。');
      if (Array.isArray(value)) {
        if (value.length > 10000) fail('LIMIT_EXCEEDED', '配列は 10,000 件以下にしてください。');
        rows += value.filter(item => object(item)).length;
        if (rows > 10000) fail('LIMIT_EXCEEDED', '1 回の入力に含まれる行は合計 10,000 件以下にしてください。');
        value.forEach(item => walk(item, depth + 1));
      } else if (object(value)) Object.values(value).forEach(item => walk(item, depth + 1));
      else if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) fail('INVALID_INPUT', 'JSON で表せる値だけを使ってください。');
    }
    walk(request, 0);
    if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_BYTES) fail('LIMIT_EXCEEDED', 'JSON 入力は 2 MiB 以下にしてください。');
  }
  function isoDate(value, path) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_DATE', path + ' は YYYY-MM-DD の実在する日付にしてください。');
    const milliseconds = Date.parse(value + 'T00:00:00.000Z');
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) fail('INVALID_DATE', path + ' は実在する ISO 日付にしてください。');
    return milliseconds;
  }
  function duration(value, path) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail('INVALID_DURATION', path + ' は 0 以上の整数、未確認は null にしてください。');
  }
  function aggregate(values, mode) {
    if (values.some(value => value === null)) return null;
    const total = mode === 'parallel' ? values.reduce((maximum, value) => Math.max(maximum, value), 0) : values.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(total)) fail('INVALID_DURATION', '期間の合計が安全な整数の範囲を超えています。');
    return total;
  }
  function weekdays(start, end) {
    const days = (end - start) / DAY, weeks = Math.floor(days / 7);
    let count = weeks * 5;
    for (let i = weeks * 7; i < days; i++) { const weekday = new Date(start + i * DAY).getUTCDay(); if (weekday !== 0 && weekday !== 6) count++; }
    return count;
  }
  function subtractDays(needed, total, mode, holidays) {
    const earliest = Date.parse('0000-01-01T00:00:00.000Z');
    if (total === 0) return needed;
    if (mode === 'calendar_days') {
      const date = needed - total * DAY;
      if (!Number.isSafeInteger(date) || date < earliest) fail('INVALID_DATE', '逆算した日付が対応範囲（西暦 0000〜9999）を超えます。');
      return date;
    }
    const exclusions = [...new Set(holidays)].filter(date => date < needed && ![0, 6].includes(new Date(date).getUTCDay()));
    const count = date => weekdays(date, needed) - exclusions.filter(holiday => holiday >= date).length;
    if (count(earliest) < total) fail('INVALID_DATE', '逆算した日付が対応範囲（西暦 0000〜9999）を超えます。');
    // Find the smallest backward offset reaching the requested counted days.
    let low = 1, high = (needed - earliest) / DAY;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (count(needed - middle * DAY) >= total) high = middle; else low = middle + 1; }
    return needed - low * DAY;
  }
  function schedule(args, findings) {
    shape(args, ['needed_on', 'calendar', 'fabrication_days', 'initial_reviews', 'review_mode', 'revision_days', 're_reviews', 'revision_counts', 'as_of']);
    shape(args.calendar, ['mode'], ['holidays'], '/calendar');
    if (!['calendar_days', 'business_days'].includes(args.calendar.mode) || !['parallel', 'serial'].includes(args.review_mode)) fail('UNSUPPORTED_MODE', '暦は calendar_days / business_days、審査方式は parallel / serial を指定してください。');
    if (args.calendar.mode === 'business_days' && !own(args.calendar, 'holidays')) fail('INVALID_INPUT', '営業日では holidays を明示してください。除外日がなければ [] とします。');
    const needed = isoDate(args.needed_on, '/needed_on'), asOf = isoDate(args.as_of, '/as_of');
    const holidays = own(args.calendar, 'holidays') ? array(args.calendar.holidays, '/calendar/holidays').map((date, index) => isoDate(date, '/calendar/holidays/' + index)) : [];
    if (args.calendar.mode === 'calendar_days' && holidays.length) finding(findings, 'CALENDAR_HOLIDAYS_IGNORED', 'info', '/calendar/holidays', { mode: args.calendar.mode, holidays: args.calendar.holidays }, '暦日モードではすべての日付を数えます。入力された除外日は逆算に適用しません。');
    duration(args.fabrication_days, '/fabrication_days'); duration(args.revision_days, '/revision_days');
    for (const name of ['initial_reviews', 're_reviews']) {
      if (!Array.isArray(args[name])) fail('INVALID_DURATION', '/' + name + ' は期間の配列にしてください。');
      args[name].forEach((value, index) => duration(value, '/' + name + '/' + index));
    }
    if (!Array.isArray(args.revision_counts) || args.revision_counts.some(value => !Number.isSafeInteger(value) || value < 0)) fail('INVALID_DURATION', 'revision_counts は 0 以上の整数の配列にしてください。');
    if (args.revision_counts.length > 1000) fail('LIMIT_EXCEEDED', 'シナリオは 1,000 件以下にしてください。');
    const initial = aggregate(args.initial_reviews, args.review_mode), again = args.revision_counts.some(count => count > 0) ? aggregate(args.re_reviews, args.review_mode) : 0;
    const scenarios = dict(), firstCountIndexes = new Map(); let unknownCount = 0, negativeCount = 0;
    args.revision_counts.forEach((count, index) => {
      if (firstCountIndexes.has(count)) {
        const firstIndex = firstCountIndexes.get(count);
        finding(findings, 'DUPLICATE_SCENARIO_COUNT', 'info', '/revision_counts/' + index, { revision_count: count, first_index: firstIndex, source_paths: { first: '/revision_counts/' + firstIndex, duplicate: '/revision_counts/' + index } }, '同じ再提出回数が重複しています。同じシナリオへ集約し、結果と件数の重複を避けました。'); return;
      }
      firstCountIndexes.set(count, index);
      const unknown = [];
      if (args.fabrication_days === null) unknown.push('/fabrication_days');
      args.initial_reviews.forEach((value, i) => { if (value === null) unknown.push('/initial_reviews/' + i); });
      if (count > 0) {
        if (args.revision_days === null) unknown.push('/revision_days');
        args.re_reviews.forEach((value, i) => { if (value === null) unknown.push('/re_reviews/' + i); });
      }
      const path = '/revision_counts/' + index;
      if (unknown.length) {
        scenarios[String(count)] = { total_days: null, planned_submit: null, slack_days: null }; unknownCount++;
        finding(findings, 'UNKNOWN_DURATION', 'warning', path, { revision_count: count, unknown_paths: unknown.slice(0, 50), unknown_path_count: unknown.length }, '必要な期間が未確認のため、このシナリオの提出日を計算できません。', 'null の期間を 0 日で補完していません。未知期間の位置は冒頭 50 件まで表示します。'); return;
      }
      const total = args.fabrication_days + initial + (count > 0 ? count * (args.revision_days + again) : 0);
      if (!Number.isSafeInteger(total)) fail('INVALID_DURATION', '逆算期間が安全な整数の範囲を超えています。');
      const date = subtractDays(needed, total, args.calendar.mode, holidays), planned = new Date(date).toISOString().slice(0, 10), slack = (date - asOf) / DAY;
      scenarios[String(count)] = { total_days: total, planned_submit: planned, slack_days: slack };
      if (slack < 0) { negativeCount++; finding(findings, 'NEGATIVE_SLACK', 'warning', path, { revision_count: count, planned_submit: planned, as_of: args.as_of, slack_days: slack }, '逆算した提出日は基準日より前です。日程と前提の見直しが必要です。'); }
    });
    return { summary: { scenario_count: firstCountIndexes.size, requested_count: args.revision_counts.length, unknown_count: unknownCount, negative_slack_count: negativeCount }, derived: { scenarios } };
  }
  function survey(args, findings) {
    shape(args, ['questions']); array(args.questions, '/questions');
    const questions = dict(), questionIds = [];
    args.questions.forEach((question, questionIndex) => {
      const path = '/questions/' + questionIndex;
      shape(question, ['id', 'type', 'choices', 'denominator_policy', 'responses', 'reports'], [], path);
      questionIds.push(text(question.id, path + '/id'));
      if (!['single', 'multiple'].includes(question.type) || !['answered', 'eligible', 'total'].includes(question.denominator_policy)) fail('INVALID_INPUT', path + ' の設問方式と分母方針を明示してください。');
      array(question.choices, path + '/choices').forEach((choice, i) => text(choice, path + '/choices/' + i)); unique(question.choices, 'INVALID_INPUT', path + '/choices');
      array(question.responses, path + '/responses'); array(question.reports, path + '/reports');
      const rowIds = [], answered = [], eligible = [], all = [];
      const counts = { total: question.responses.length, eligible: 0, answered: 0, missing: 0, not_asked: 0, selections: 0 }, numerator = dict();
      question.choices.forEach(choice => { numerator[choice] = 0; });
      question.responses.forEach((response, responseIndex) => {
        const ref = path + '/responses/' + responseIndex;
        shape(response, ['row_id', 'state', 'selected'], [], ref); rowIds.push(text(response.row_id, ref + '/row_id'));
        if (!['answered', 'missing', 'not_asked'].includes(response.state) || !Array.isArray(response.selected) || response.selected.some(choice => typeof choice !== 'string' || !question.choices.includes(choice)) || new Set(response.selected).size !== response.selected.length) fail('INVALID_STATE_AND_ANSWER', ref + ' の状態と選択肢を確認してください。');
        if ((response.state === 'answered' && (question.type === 'single' ? response.selected.length !== 1 : response.selected.length < 1)) || (response.state !== 'answered' && response.selected.length !== 0)) fail('INVALID_STATE_AND_ANSWER', ref + ' の状態と回答数が一致しません。回答を推測して補完しません。');
        all.push(response.row_id);
        if (response.state !== 'not_asked') { eligible.push(response.row_id); counts.eligible++; }
        if (response.state === 'answered') {
          answered.push(response.row_id); counts.answered++; counts.selections += response.selected.length;
          response.selected.forEach(choice => { numerator[choice]++; });
        } else counts[response.state]++;
      });
      unique(rowIds, 'DUPLICATE_ROW_ID', path + '/responses');
      const rowSets = { total: all.sort(compare), eligible: eligible.sort(compare), answered: answered.sort(compare), selections: [...answered] };
      const denominator = counts[question.denominator_policy], percentages = dict(), reports = dict(), reportIds = [];
      const denominatorRows = rowSets[question.denominator_policy];
      question.choices.forEach(choice => { percentages[choice] = denominator === 0 ? null : numerator[choice] / denominator * 100; });
      if (denominator === 0) finding(findings, 'ZERO_DENOMINATOR', 'warning', path + '/denominator_policy', { policy: question.denominator_policy, denominator: 0 }, '宣言した分母が 0 のため割合は未計算です。', '0% として表示せず null にしています。');
      question.reports.forEach((report, reportIndex) => {
        const ref = path + '/reports/' + reportIndex;
        shape(report, ['id', 'choice', 'denominator_kind', 'value_pct'], [], ref); reportIds.push(text(report.id, ref + '/id'));
        if (!question.choices.includes(report.choice) || !['answered', 'eligible', 'total', 'selections'].includes(report.denominator_kind) || typeof report.value_pct !== 'number' || !Number.isFinite(report.value_pct)) fail('INVALID_INPUT', ref + ' の選択肢、分母方式、有限の報告割合を確認してください。');
        const reportedDenominator = counts[report.denominator_kind], expected = reportedDenominator === 0 ? null : numerator[report.choice] / reportedDenominator * 100;
        const correct = expected === null ? null : report.value_pct >= expected - 0.01 && report.value_pct <= expected + 0.01;
        reports[report.id] = { arithmetic_correct: correct, expected_pct: expected, denominator: reportedDenominator, denominator_row_ids: [...rowSets[report.denominator_kind]] };
        if (expected === null) finding(findings, 'ZERO_DENOMINATOR', 'warning', ref + '/denominator_kind', { denominator_kind: report.denominator_kind, denominator: 0 }, 'この報告の分母が 0 のため算術の正否を判定できません。', '分母が 0 の報告割合は null として扱います。');
        else if (!correct) finding(findings, 'PERCENT_MISMATCH', 'error', ref + '/value_pct', { reported_pct: report.value_pct, expected_pct: expected, denominator: reportedDenominator }, '報告割合と、この報告が指定した分母による計算が一致しません。');
        if (report.denominator_kind !== question.denominator_policy) finding(findings, 'DENOMINATOR_POLICY_MISMATCH', 'warning', ref + '/denominator_kind', { declared_policy: question.denominator_policy, report_policy: report.denominator_kind, denominator: reportedDenominator, denominator_row_ids: rowSets[report.denominator_kind] }, '報告の分母方式が設問で宣言した方針と異なります。算術の正否とは別の指摘です。');
      });
      unique(reportIds, 'INVALID_INPUT', path + '/reports');
      questions[question.id] = { counts, denominator, denominator_row_ids: [...denominatorRows], choice_percentages: percentages, reports };
    });
    unique(questionIds, 'INVALID_INPUT', '/questions');
    return { summary: { question_count: questionIds.length, finding_count: findings.length }, derived: { questions } };
  }
  function quote(args, findings) {
    shape(args, ['requirements', 'quotes']); array(args.requirements, '/requirements'); array(args.quotes, '/quotes');
    const requirementIds = [], requiredIds = [], quotes = dict(), quoteIds = [], currencies = [];
    args.requirements.forEach((requirement, index) => {
      const path = '/requirements/' + index; shape(requirement, ['id', 'required'], [], path);
      requirementIds.push(text(requirement.id, path + '/id')); boolean(requirement.required, path + '/required');
      if (requirement.required) requiredIds.push(requirement.id);
    });
    unique(requirementIds, 'DUPLICATE_ID', '/requirements');
    args.quotes.forEach((bid, bidIndex) => {
      const path = '/quotes/' + bidIndex;
      shape(bid, ['id', 'currency', 'responses', 'costs'], [], path);
      quoteIds.push(text(bid.id, path + '/id')); currencies.push(text(bid.currency, path + '/currency'));
      array(bid.responses, path + '/responses'); array(bid.costs, path + '/costs');
      const responses = new Map(), responseIds = [], costIds = [];
      bid.responses.forEach((response, index) => {
        const ref = path + '/responses/' + index;
        shape(response, ['requirement_id', 'status', 'mapping_status', 'source_ref'], [], ref);
        if (!requirementIds.includes(response.requirement_id) || !['included', 'excluded', 'unknown'].includes(response.status) || !['approved', 'unconfirmed'].includes(response.mapping_status)) fail('INVALID_INPUT', ref + ' の要求 ID、状態、承認状態を確認してください。');
        text(response.source_ref, ref + '/source_ref'); responseIds.push(response.requirement_id);
        responses.set(response.requirement_id, { response, index });
      });
      unique(responseIds, 'DUPLICATE_ID', path + '/responses');
      const unanswered = [], unfulfilled = []; let known = 0, unknownRequired = false;
      requiredIds.forEach(id => {
        const entry = responses.get(id);
        if (!entry) {
          unanswered.push(id); unfulfilled.push(id);
          finding(findings, 'UNANSWERED_REQUIRED', 'error', path + '/responses', { requirement_id: id, quote_id: bid.id }, '必須要求への回答がありません。要求 ID と見積内の根拠を確認してください。', '未回答は未確認であり、含まれるとも除外されるとも推測しません。'); return;
        }
        const { response, index } = entry, ref = path + '/responses/' + index;
        if (response.mapping_status === 'unconfirmed') {
          unfulfilled.push(id); finding(findings, 'MAPPING_UNCONFIRMED', 'warning', ref + '/mapping_status', { requirement_id: id, source_ref: response.source_ref, status: response.status }, '要求 ID との対応付けが未承認です。充足した要求として扱いません。', '人による対応付けの承認が必要です。');
        } else if (response.status !== 'included') {
          unfulfilled.push(id);
          finding(findings, response.status === 'excluded' ? 'SCOPE_EXCLUDED' : 'SCOPE_UNKNOWN', 'warning', ref + '/status', { requirement_id: id, status: response.status, source_ref: response.source_ref }, response.status === 'excluded' ? '必須作業が明示的に除外されています。' : '必須作業を含むかが未確認です。', response.status === 'unknown' ? '見積の根拠を確認する必要があります。' : '');
        }
      });
      bid.costs.forEach((cost, index) => {
        const ref = path + '/costs/' + index;
        shape(cost, ['id', 'required', 'amount'], [], ref); costIds.push(text(cost.id, ref + '/id')); boolean(cost.required, ref + '/required');
        if (cost.amount !== null && (typeof cost.amount !== 'number' || !Number.isFinite(cost.amount) || cost.amount < 0)) fail('INVALID_INPUT', ref + '/amount は 0 以上の有限数、未知は null を明示してください。');
        if (cost.amount !== null) known += cost.amount;
        else if (cost.required) {
          unknownRequired = true;
          finding(findings, 'UNKNOWN_REQUIRED_COST', 'warning', ref + '/amount', { cost_id: cost.id, amount: null }, '必須費用が未知のため総額を確定できません。', 'null を 0 円で補完していません。');
        } else {
          finding(findings, 'OPTIONAL_COST_UNKNOWN', 'warning', ref + '/amount', { cost_id: cost.id, amount: null }, '任意費用が未知です。表示額は必須費用と値がある任意費用の小計です。', '任意費用の未知額は価格に変換していません。契約上の総額を示しません。');
        }
      });
      unique(costIds, 'DUPLICATE_ID', path + '/costs');
      if (!Number.isFinite(known)) fail('INVALID_INPUT', '費用の合計が有限数の範囲を超えています。');
      if (known > Number.MAX_SAFE_INTEGER) finding(findings, 'COST_PRECISION_LIMIT', 'warning', path + '/costs', { known_cost: known }, '費用の小計が JavaScript の安全な整数範囲を超えています。数値の精度を確認してください。', '浮動小数の合計値です。元の値を丸めたり通貨換算したりしていません。');
      quotes[bid.id] = { required_unanswered: unanswered.sort(compare), required_unfulfilled: unfulfilled.sort(compare), known_cost: known, total: unknownRequired ? null : known, comparable: unfulfilled.length === 0 && !unknownRequired };
    });
    unique(quoteIds, 'DUPLICATE_ID', '/quotes');
    const currencyKinds = [...new Set(currencies)].sort(compare);
    if (currencyKinds.length > 1) finding(findings, 'CURRENCY_MISMATCH', 'warning', '/quotes', { currencies: currencyKinds }, '見積の通貨が異なります。換算や価格順位付けは行いません。');
    return { summary: { comparable: quoteIds.length > 0 && Object.values(quotes).every(bid => bid.comparable) && currencyKinds.length === 1, quote_count: quoteIds.length, total_definition: 'required-plus-priced-options subtotal' }, derived: { quotes } };
  }
  function checks(args, findings) {
    shape(args, ['required_checks', 'workflows', 'event', 'observed_checks', 'merge_queue']);
    array(args.required_checks, '/required_checks'); array(args.workflows, '/workflows'); array(args.observed_checks, '/observed_checks'); boolean(args.merge_queue, '/merge_queue');
    if (args.workflows.length > 200) fail('LIMIT_EXCEEDED', 'workflow は 200 件以下にしてください。');
    const supportedEvents = ['pull_request', 'merge_group'];
    shape(args.event, ['type', 'base_branch', 'changed_files', 'head_sha'], [], '/event');
    if (!supportedEvents.includes(args.event.type)) fail('INVALID_INPUT', 'イベントは pull_request / merge_group を明示してください。');
    text(args.event.base_branch, '/event/base_branch'); text(args.event.head_sha, '/event/head_sha');
    array(args.event.changed_files, '/event/changed_files').forEach((file, index) => text(file, '/event/changed_files/' + index));
    const source = (value, path) => { if (value !== 'github_actions') fail('UNSUPPORTED_SOURCE', path + ' は github_actions のみ対応します。'); };
    const names = [];
    args.required_checks.forEach((check, index) => {
      const path = '/required_checks/' + index; shape(check, ['name', 'source'], [], path);
      names.push(text(check.name, path + '/name')); source(check.source, path + '/source');
    });
    unique(names, 'INVALID_INPUT', '/required_checks');
    const producers = new Map(), workflowIds = [];
    function pattern(value, path, prefixAllowed) {
      text(value, path);
      const prefix = prefixAllowed && value.endsWith('/**');
      const literal = prefix ? value.slice(0, -2) : value;
      if (/[\*?\[\]!{}\\]/.test(literal)) fail('UNSUPPORTED_PATTERN', path + ' は完全一致、パスは末尾 /** の接頭辞だけに対応します。');
      return { value: literal, prefix };
    }
    args.workflows.forEach((workflow, index) => {
      const path = '/workflows/' + index;
      shape(workflow, ['id', 'events', 'jobs'], ['branches', 'paths', 'source'], path);
      workflowIds.push(text(workflow.id, path + '/id'));
      if (own(workflow, 'source')) source(workflow.source, path + '/source');
      array(workflow.events, path + '/events').forEach(event => { if (!supportedEvents.includes(event)) fail('INVALID_INPUT', path + '/events に未対応のイベントがあります。'); });
      const branches = own(workflow, 'branches') ? array(workflow.branches, path + '/branches').map((branch, i) => pattern(branch, path + '/branches/' + i, false).value) : [];
      const paths = own(workflow, 'paths') ? array(workflow.paths, path + '/paths').map((value, i) => pattern(value, path + '/paths/' + i, true)) : [];
      const eventMatch = workflow.events.includes(args.event.type), branchMatch = !branches.length || branches.includes(args.event.base_branch);
      const pathMatch = !paths.length || args.event.changed_files.some(file => paths.some(path => path.prefix ? file.startsWith(path.value) : file === path.value));
      array(workflow.jobs, path + '/jobs').forEach((job, jobIndex) => {
        const ref = path + '/jobs/' + jobIndex;
        shape(job, ['name', 'condition'], ['source'], ref); text(job.name, ref + '/name');
        if (typeof job.condition !== 'boolean') fail('UNSUPPORTED_CONDITION', ref + '/condition は JSON の true / false のみ対応します。式は実行しません。');
        if (own(job, 'source')) source(job.source, ref + '/source');
        if (!names.includes(job.name)) return;
        if (producers.has(job.name)) fail('AMBIGUOUS_CHECK_NAME', '必須チェック ' + job.name + ' の生成元が複数あります。自動解決しません。');
        producers.set(job.name, { workflow, index, job, jobIndex, eventMatch, branchMatch, pathMatch });
      });
    });
    unique(workflowIds, 'INVALID_INPUT', '/workflows');
    const observations = new Map();
    args.observed_checks.forEach((check, index) => {
      const path = '/observed_checks/' + index;
      shape(check, ['name', 'source', 'sha', 'conclusion'], [], path); text(check.name, path + '/name'); text(check.sha, path + '/sha'); source(check.source, path + '/source');
      if (check.conclusion !== null && typeof check.conclusion !== 'string') fail('INVALID_INPUT', path + '/conclusion は状態の文字列または未確認の null にしてください。');
      if (!names.includes(check.name)) return;
      if (!observations.has(check.name)) observations.set(check.name, []);
      observations.get(check.name).push(check);
      if (check.sha !== args.event.head_sha) finding(findings, 'STALE_SHA', 'warning', path + '/sha', { name: check.name, observed_sha: check.sha, head_sha: args.event.head_sha }, '観測結果の SHA が今回の変更と異なるため、充足根拠には使いません。');
      if (check.conclusion === null) finding(findings, 'CHECK_RESULT_UNKNOWN', 'info', path + '/conclusion', { name: check.name, sha: check.sha, conclusion: null }, 'この観測結果の結論は未確認です。成功として扱いません。', 'null の結論は未確認のまま残しています。');
      const conclusions = ['success', 'neutral', 'skipped', 'failure', 'cancelled', 'timed_out', 'action_required', 'pending', 'startup_failure', 'stale'];
      if (check.conclusion !== null && !conclusions.includes(check.conclusion)) finding(findings, 'UNKNOWN_CHECK_CONCLUSION', 'warning', path + '/conclusion', { name: check.name, conclusion: check.conclusion }, 'この観測状態の意味は未確認です。成功として扱いません。', '未対応の状態文字列です。');
    });
    const predicted = dict(), satisfied = dict();
    names.forEach((name, index) => {
      const producer = producers.get(name);
      satisfied[name] = (observations.get(name) || []).some(check => check.source === 'github_actions' && check.sha === args.event.head_sha && ['success', 'neutral', 'skipped'].includes(check.conclusion));
      if (!producer) {
        predicted[name] = { state: 'not_generated', gate_result: 'pending' };
        finding(findings, 'MISSING_CHECK_PRODUCER', 'warning', '/required_checks/' + index, { name }, '宣言された workflow 内に必須チェックの生成元がありません。', '外部の生成元や実際の設定を取得していません。'); return;
      }
      const path = '/workflows/' + producer.index;
      const runs = producer.eventMatch && producer.branchMatch && producer.pathMatch;
      predicted[name] = !runs ? { state: 'not_generated', gate_result: 'pending' } : !producer.job.condition ? { state: 'skipped_success', gate_result: 'success_if_reported' } : { state: 'generated', gate_result: 'unknown' };
      const generationUncertainty = '宣言された設定の静的予測です。入力された観測結果は別に判定し、生成予測で上書きしません。';
      if (!producer.eventMatch) finding(findings, 'EVENT_NOT_TRIGGERED', 'warning', path + '/events', { name, event: args.event.type, declared_events: producer.workflow.events }, '今回のイベントは宣言された workflow を起動しません。', generationUncertainty);
      if (!producer.branchMatch) finding(findings, 'BRANCH_FILTER_REQUIRED_PENDING', 'warning', path + '/branches', { name, base_branch: args.event.base_branch, branches: producer.workflow.branches }, '対象ブランチ条件に一致せず、必須チェックが未生成になる予測です。', generationUncertainty);
      if (!producer.pathMatch) finding(findings, 'PATH_FILTER_REQUIRED_PENDING', 'warning', path + '/paths', { name, paths: producer.workflow.paths, changed_files: args.event.changed_files }, '変更ファイルがパス条件に一致せず、必須チェックが未生成になる予測です。', generationUncertainty);
      if (args.merge_queue && args.event.type === 'merge_group' && !producer.workflow.events.includes('merge_group')) finding(findings, 'MISSING_MERGE_GROUP', 'warning', path + '/events', { name, declared_events: producer.workflow.events }, 'merge queue を使う今回のイベントに、必須生成元の merge_group 対応がありません。');
    });
    return { summary: { mode: 'simulation', required_count: names.length, observed_satisfied_count: Object.values(satisfied).filter(Boolean).length }, derived: { predicted_checks: predicted, observed_satisfaction: satisfied } };
  }
  function catalog(args, findings) {
    shape(args, ['profile', 'key_field', 'before', 'current', 'proposed', 'proposed_columns', 'current_captured_at', 'overwrite_mode']);
    if (args.profile !== 'shopify_product_csv' || args.overwrite_mode !== true) fail('UNSUPPORTED_MODE', 'shopify_product_csv、overwrite_mode=true の読み取り専用比較のみ対応します。');
    const key = text(args.key_field, '/key_field'); text(args.current_captured_at, '/current_captured_at');
    array(args.proposed_columns, '/proposed_columns').forEach((field, i) => text(field, '/proposed_columns/' + i)); unique(args.proposed_columns, 'INVALID_INPUT', '/proposed_columns');
    if (args.proposed_columns.includes(key)) fail('INVALID_INPUT', 'proposed_columns から識別子の列を除いてください。キー変更は推測しません。');
    const indexes = {};
    for (const name of ['before', 'current', 'proposed']) {
      const keys = [], rows = new Map();
      array(args[name], '/' + name).forEach((row, index) => {
        const path = '/' + name + '/' + index;
        if (!object(row) || !own(row, key) || Object.values(row).some(value => typeof value !== 'string')) fail('INVALID_INPUT', path + ' のキーと全セルを文字列で明示してください。');
        text(row[key], path + '/' + ptr(key)); keys.push(row[key]); rows.set(row[key], { row, index });
      });
      unique(keys, 'DUPLICATE_KEY', '/' + name); indexes[name] = rows;
    }
    const beforeKeys = [...indexes.before.keys()].sort(compare), currentKeys = [...indexes.current.keys()].sort(compare);
    if (JSON.stringify(beforeKeys) !== JSON.stringify(currentKeys)) fail('SNAPSHOT_KEY_MISMATCH', '基準と現在のキー集合が一致しません。行の追加・削除や名寄せを推測しません。');
    for (const id of indexes.proposed.keys()) if (!indexes.before.has(id)) fail('UNKNOWN_ROW_KEY', '編集案に基準にない行キーがあります。');
    const fields = args.before.length ? Object.keys(args.before[0]).filter(field => field !== key).sort(compare) : [];
    for (const name of ['before', 'current']) args[name].forEach(row => {
      if (JSON.stringify(Object.keys(row).filter(field => field !== key).sort(compare)) !== JSON.stringify(fields)) fail('INVALID_INPUT', '基準と現在の全行で列集合を一致させてください。欠けたセルは明示的な空文字で入力します。');
    });
    if (args.proposed_columns.some(field => !fields.includes(field))) fail('INVALID_INPUT', '編集案の列が基準・現在の列集合にありません。');
    args.proposed.forEach((row, index) => {
      if (args.proposed_columns.some(field => !own(row, field))) fail('MISSING_INCLUDED_CELL', '/proposed/' + index + ' に宣言した列がありません。空欄も空文字で明示してください。');
      if (Object.keys(row).some(field => field !== key && !args.proposed_columns.includes(field))) fail('INVALID_INPUT', '/proposed/' + index + ' に proposed_columns 外の列があります。');
    });
    const cells = dict(), finalRows = []; let conflicts = 0;
    args.current.forEach((row, currentIndex) => {
      const id = row[key], baseEntry = indexes.before.get(id), proposalEntry = indexes.proposed.get(id), candidate = dict(), reviewed = dict();
      Object.entries(row).forEach(([field, value]) => { candidate[field] = value; });
      fields.forEach(field => {
        const base = baseEntry.row[field], current = row[field], included = !!proposalEntry && args.proposed_columns.includes(field), proposal = included ? proposalEntry.row[field] : base;
        let status;
        if (current === base && proposal === base) status = 'unchanged';
        else if (current !== base && proposal === base) status = 'current_only';
        else if (current === base && proposal !== base) status = 'proposed_only';
        else if (current === proposal) status = 'same_change';
        else status = 'conflict';
        const value = status === 'conflict' ? null : ['unchanged', 'current_only'].includes(status) ? current : proposal;
        reviewed[field] = { base, current, proposed: proposal, status, value }; candidate[field] = value;
        const sourcePaths = { base: '/before/' + baseEntry.index + '/' + ptr(field), current: '/current/' + currentIndex + '/' + ptr(field) };
        if (included) sourcePaths.proposed = '/proposed/' + proposalEntry.index + '/' + ptr(field);
        const path = included ? sourcePaths.proposed : sourcePaths.current;
        const observed = { row_key: id, field, base, current, proposed: proposal, source_paths: sourcePaths };
        if (status === 'conflict') { conflicts++; finding(findings, 'CONCURRENT_EDIT', 'error', path, observed, '基準から現在と編集案が異なる値へ変更されています。競合セルの採用値は null です。', '競合を自動統合していません。人による確認が必要です。'); }
        if (included && field === 'Vendor' && proposal === '' && (base !== '' || current !== '')) finding(findings, 'CSV_BLANK_CLEAR', 'warning', path, observed, '含めた Vendor 列が空文字です。既存値を消す可能性があるため確認してください。');
        if (included && ['Option1 Value', 'Option2 Value', 'Option3 Value'].includes(field) && (proposal !== base || proposal !== current)) finding(findings, 'VARIANT_ID_REGENERATION_RISK', 'warning', path, observed, '編集案の option 値が基準または現在と異なります。variant ID 再生成と依存先への影響を確認してください。', '新しい ID や実際のインポート結果は推定していません。');
      });
      cells[id] = reviewed; finalRows.push(candidate);
    });
    return { summary: { conflict_count: conflicts, deleted_count: 0, requires_review: findings.length > 0, row_count: args.current.length }, derived: { cells, final_rows: finalRows, current_captured_at: args.current_captured_at, freshness_verified: false } };
  }
  const implementations = { resubmission_schedule: schedule, survey_denominator_audit: survey, required_check_audit: checks, catalog_three_way_guard: catalog, quote_scope_preflight: quote };
  function execute(request) {
    try {
      shape(request, ['tool', 'arguments']); jsonLimits(request);
      if (typeof request.tool !== 'string' || !own(implementations, request.tool)) fail('UNSUPPORTED_TOOL', '未対応のツールです。登録済みのツール名を指定してください。');
      const findings = [], computed = implementations[request.tool](request.arguments, findings);
      findings.sort((a, b) => compare(a.path, b.path) || compare(a.rule_id, b.rule_id));
      return { schema_version: '1.0', tool: request.tool, findings, summary: computed.summary, derived: computed.derived };
    } catch (error) {
      return { error: { code: error instanceof ContractError ? error.code : 'INTERNAL_ERROR', message: error instanceof ContractError ? error.message : '処理を完了できませんでした。入力と対応範囲を確認してください。' } };
    }
  }
  return Object.freeze({ execute, MAX_BYTES, tools: Object.freeze(Object.keys(implementations)) });
});
