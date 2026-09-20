/* Behavioral tests against extracted production functions. No app state is read. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
process.env.TZ = 'America/Vancouver';
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '../index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function replayModel('));
assert(source, 'Main application script found');
const config = source.slice(0, source.indexOf('// ═══════ Dad'));
const model = source.slice(source.indexOf('const clone ='), source.indexOf('// ═══════ ONBOARDING'));
function pick(name) {
  const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
  assert(match, name + ' function found');
  return match[0];
}
let now = new Date(2026, 8, 20, 8).getTime();
const NativeDate = Date;
class ClockDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const storage = new Map();
const context = vm.createContext({
  Date: ClockDate, console,
  localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
  document: { getElementById: () => null },
  render() {}, renderParentPanel() {}, setSettingsMsg() {}, applyTheme() {}
});
vm.runInContext(config + '\n' + model + '\nlet settingsDraft = null; let settingsBaseline = \"\";\n' + ['applySettingsToToday', 'resetSettingsDraft', 'saveSettings', 'pzToggleFlag', 'buildDayDetail', '_clock'].map(pick).join('\n'), context);
function run(js) { return vm.runInContext(js, context); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function clock(k, hour = 8, minute = 0) {
  const [y, m, d] = k.split('-').map(Number);
  now = new NativeDate(y, m - 1, d, hour, minute).getTime();
}
function fixture({today = '2026-09-21', epoch = '2026-09-18', earned = ['2026-09-18','2026-09-19'], counting = [1,2,3,4,5,6], rest = []} = {}) {
  clock(today);
  context.fixtureInput = {today, epoch, earned, counting, rest};
  return run(`(() => {
    const f = fixtureInput;
    const s = ensureToday(initState('Test'));
    s.epoch = f.epoch;
    s.migratedFillHalves = 0;
    s.settings.countingDays = f.counting;
    s.countingLog = [{from: f.epoch, days: f.counting}];
    s.settings.restDays = f.rest;
    s.restLog = [{from: f.epoch, days: f.rest}];
    s.days = {};
    for (const k of f.earned) {
      s.days[k] = freshDayState(s.settings);
      s.days[k].checks = {morning:true,bedtime:true};
    }
    s.days[f.today] ||= freshDayState(s.settings);
    return s;
  })()`);
}
function replay(state) { context.subject = state; return plain(run('replayModel(subject, Date.now())')); }
let passed = 0, failed = 0, skipped = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
const hasRest = run('typeof isRestDay === "function"');
assert.equal(hasRest, true, 'Recurring rest-day implementation is present');
function restTest(name, fn) {
  if (hasRest) test(name, fn);
  else { skipped++; console.log('SKIP ' + name + ' (rest-day implementation not present yet)'); }
}
function isRest(state, k) { context.subject = state; context.key = k; return run('isRestDay(key, subject)'); }

test('leeway days retain jar and streak before the next active deadline', () => {
  const r = replay(fixture());
  assert.equal(r.fillHalves, 4);
  assert.equal(r.streak, 2);
});
test('active-day morning deadline still clears the current jar and streak', () => {
  const s = fixture();
  clock('2026-09-21', 10);
  const r = replay(s);
  assert.equal(r.fillHalves, 0);
  assert.equal(r.streak, 0);
  assert.equal(r.lastWipeId, '2026-09-21:1');
});
test('one-off retro pause repairs a missed-day loss', () => {
  const s = fixture({earned:['2026-09-18']});
  assert.equal(replay(s).fillHalves, 0);
  s.days['2026-09-19'] = run('freshDayState(subject.settings)');
  s.days['2026-09-19'].paused = true;
  const r = replay(s);
  assert.equal(r.fillHalves, 2);
  assert.equal(r.streak, 1);
});
test('pausing a day retains its already earned halves without adding a streak day', () => {
  const s = fixture();
  s.days['2026-09-19'].paused = true;
  const r = replay(s);
  assert.equal(r.fillHalves, 4);
  assert.equal(r.streak, 1);
});
restTest('scheduled rest prevents both missed-half losses even on a counting day', () => {
  const s = fixture({today:'2026-09-20',counting:[0,1,2,3,4,5,6],rest:[0]});
  clock('2026-09-20', 23);
  assert.equal(isRest(s, '2026-09-20'), true);
  const r = replay(s);
  assert.equal(r.fillHalves, 4);
  assert.equal(r.streak, 2);
  assert.equal(r.lastWipeId, '');
});
restTest('a missed rest day needs no day record to preserve the jar and streak', () => {
  const s = fixture({counting:[0,1,2,3,4,5,6],rest:[0]});
  assert.equal(s.days['2026-09-20'], undefined);
  const r = replay(s);
  assert.equal(r.fillHalves, 4);
  assert.equal(r.streak, 2);
});
restTest('adding a rest schedule does not reinterpret earlier matching weekdays', () => {
  const s = fixture({today:'2026-09-21',epoch:'2026-09-12',earned:['2026-09-12'],counting:[0,1,2,3,4,5,6],rest:[0]});
  s.restLog = [{from:'2026-09-20',days:[0]}];
  assert.equal(isRest(s, '2026-09-13'), false);
  assert.equal(isRest(s, '2026-09-20'), true);
  assert.equal(replay(s).fillHalves, 0);
});
restTest('rest today retains earned halves without adding a streak day', () => {
  const s = fixture({today:'2026-09-20',earned:['2026-09-18','2026-09-19','2026-09-20'],rest:[0]});
  const r = replay(s);
  assert.equal(r.fillHalves, 6);
  assert.equal(r.streak, 2);
});
restTest('an empty rest-day selection remains valid after migration', () => {
  const s = fixture();
  context.subject = s;
  const normalized = run('ensureToday(subject)');
  assert.deepEqual(plain(normalized.settings.restDays), []);
  assert.equal(isRest(normalized,'2026-09-20'), false);
});
restTest('saving a new rest schedule preserves historical rules and logs today once', () => {
  const s = fixture({rest:[0]});
  s.restLog = [{from:'2026-09-20',days:[0]}];
  context.subject = s;
  run('saveState(subject); settingsDraft = clone(subject.settings); settingsDraft._name = subject.name; settingsDraft.restDays = [0,1]; saveSettings();');
  const saved = run('loadState()');
  assert.equal(isRest(saved, '2026-09-14'), false);
  assert.equal(isRest(saved, '2026-09-20'), true);
  assert.equal(isRest(saved, '2026-09-21'), true);
  assert.equal(replay(saved).fillHalves, 4);
  assert.equal(replay(saved).streak, 2);
  assert.equal(saved.restLog.filter(e => e.from === '2026-09-21').length, 1);
  run('settingsDraft = clone(loadState().settings); settingsDraft._name = "Test"; settingsDraft.restDays = [0,1,2]; saveSettings();');
  const twice = run('loadState()');
  assert.equal(twice.restLog.filter(e => e.from === '2026-09-21').length, 1);
  assert.equal(isRest(twice, '2026-09-14'), false);
});
restTest('banked jars and payout ledger survive adding a rest day', () => {
  const s = fixture({today:'2026-09-20',rest:[0]});
  s.migratedFillHalves = 18;
  s.jarsPaid = 1;
  const r = replay(s);
  assert.equal(r.banked, 1);
  assert.equal(r.fillHalves, 2);
  assert.equal(s.jarsPaid, 1);
});

restTest('old installed saves gain Sunday rest only from the update date', () => {
  const s = fixture({today:'2026-09-20',epoch:'2026-09-12',earned:['2026-09-12','2026-09-13']});
  delete s.settings.restDays;
  delete s.restLog;
  context.subject = s;
  const priorDay = JSON.stringify(s.days['2026-09-13']);
  const migrated = run('ensureToday(subject)');
  assert.deepEqual(plain(migrated.settings.restDays), [0]);
  assert.deepEqual(plain(migrated.restLog), [{from:'2026-09-20',days:[0]}]);
  assert.equal(isRest(migrated,'2026-09-13'), false);
  assert.equal(isRest(migrated,'2026-09-20'), true);
  assert.equal(JSON.stringify(migrated.days['2026-09-13']), priorDay);
});
restTest('custom old counting schedules migrate their optional weekdays into rest', () => {
  const s = fixture({today:'2026-09-20',counting:[1,2,3,4,5]});
  delete s.settings.restDays;
  delete s.restLog;
  context.subject = s;
  const migrated = run('ensureToday(subject)');
  assert.deepEqual(plain(migrated.settings.restDays), [0,6]);
  assert.equal(isRest(migrated,'2026-09-19'), false);
  assert.equal(isRest(migrated,'2026-09-26'), true);
});
restTest('moving the rest weekday keeps earlier schedules intact', () => {
  const s = fixture({today:'2026-09-22',rest:[0]});
  s.days['2026-09-21'] = run('freshDayState(subject.settings)');
  s.days['2026-09-21'].checks = {morning:true,bedtime:true};
  s.restLog = [{from:'2026-09-20',days:[0]}];
  context.subject = s;
  run('saveState(subject); resetSettingsDraft(subject); settingsDraft.restDays = [2]; saveSettings();');
  const saved = run('loadState()');
  assert.equal(isRest(saved,'2026-09-20'), true);
  assert.equal(isRest(saved,'2026-09-22'), true);
  assert.equal(isRest(saved,'2026-09-27'), false);
  assert.deepEqual(plain(saved.settings.countingDays), [0,1,3,4,5,6]);
  assert.equal(replay(saved).fillHalves, 6);
  assert.equal(replay(saved).streak, 3);
});
restTest('choosing no recurring rest days persists through reload', () => {
  const s = fixture({rest:[0]});
  context.subject = s;
  run('saveState(subject); resetSettingsDraft(subject); settingsDraft.restDays = []; saveSettings();');
  const saved = run('ensureToday(loadState())');
  assert.deepEqual(plain(saved.settings.restDays), []);
  assert.deepEqual(plain(saved.settings.countingDays), [0,1,2,3,4,5,6]);
  assert.equal(isRest(saved,'2026-09-27'), false);
});
restTest('choosing all seven rest days persists without re-seeding counting days', () => {
  const s = fixture({rest:[0]});
  context.subject = s;
  run('saveState(subject); resetSettingsDraft(subject); settingsDraft.restDays = [0,1,2,3,4,5,6]; saveSettings();');
  const saved = run('ensureToday(loadState())');
  assert.deepEqual(plain(saved.settings.restDays), [0,1,2,3,4,5,6]);
  assert.deepEqual(plain(saved.settings.countingDays), []);
  assert.equal(isRest(saved,'2026-09-22'), true);
  context.subject = saved;
  assert.equal(run('isCountingDay("2026-09-22", subject)'), false);
  assert.equal(replay(saved).fillHalves, 4);
  assert.equal(replay(saved).streak, 2);
});
restTest('a one-off rest toggle repairs and restores the same historical missed day', () => {
  const s = fixture({earned:['2026-09-18'],rest:[0]});
  context.subject = s;
  run('saveState(subject); pzToggleFlag("2026-09-19", "paused");');
  const paused = run('loadState()');
  assert.equal(paused.fillHalves, 2);
  assert.equal(paused.streak, 1);
  run('pzToggleFlag("2026-09-19", "paused");');
  const restored = run('loadState()');
  assert.equal(restored.fillHalves, 0);
  assert.equal(restored.streak, 0);
});
test('historical no-school totals exclude unrequired school tasks', () => {
  const s = fixture();
  const d = s.days['2026-09-19'];
  d.noSchool = true;
  for (const task of [...d.taskDefs.morning,...d.taskDefs.bedtime]) d.tasks[task.id] = true;
  context.subject = s;
  const detail = run('buildDayDetail(subject,"2026-09-19","2026-09-21")');
  assert.match(detail, /10\/10 done/);
  assert.doesNotMatch(detail, /10\/12 done/);
  assert.doesNotMatch(detail, /Math block|English block/);
});

// Confirmation paths load fresh state, so a second tab can change the day while an overlay is open.
context.document = {
  getElementById: () => ({classList:{add(){},remove(){}},style:{}}),
  querySelector: () => ({classList:{add(){},remove(){}},style:{}})
};
for (const fn of ['resetCelebrationUI','closeCelebration','showToast','chimeRoutine','buzz']) context[fn] = () => {};
context.academicDoneSvg = () => '';
run('let _drainRunning = false; let _pendingDrop = null; let _pendingAcademic = null;');
run(['toggleTask','openDrop','openAcademicCheck','finishDrop','finishAcademic'].map(pick).join('\n'));
restTest('child task and drop entry paths ignore rest days', () => {
  const s = fixture({today:'2026-09-20',rest:[0]});
  context.subject = s;
  run('saveState(subject); toggleTask("m1"); openDrop("morning"); openAcademicCheck();');
  const saved = run('loadState()');
  assert.equal(saved.days['2026-09-20'].tasks.m1, false);
  assert.equal(run('_pendingDrop'), null);
  assert.equal(run('_pendingAcademic'), null);
});
restTest('in-progress star confirmation obeys rest added elsewhere', () => {
  const s = fixture({today:'2026-09-20',rest:[0]});
  context.subject = s;
  run('saveState(subject); _pendingDrop = {which:"morning",day:getToday(),tapAt:Date.now()}; finishDrop("morning",Date.now());');
  const saved = run('loadState()');
  assert.equal(saved.days['2026-09-20'].checks.morning, false);
  assert.equal(saved.days['2026-09-20'].drop.morning, undefined);
});
restTest('in-progress school confirmation obeys rest added elsewhere', () => {
  const s = fixture({today:'2026-09-20',rest:[0]});
  context.subject = s;
  run('saveState(subject); _pendingAcademic = getToday(); finishAcademic(Date.now());');
  const saved = run('loadState()');
  assert.equal(saved.days['2026-09-20'].academic.done, null);
});
console.log(`\n${passed} passed; ${failed} failed; ${skipped} awaiting implementation.`);
process.exitCode = failed ? 1 : 0;
