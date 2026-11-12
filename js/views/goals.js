import { h, icon, openSheet } from '../ui.js';
import { app, change, newId } from '../state.js';
import { parseAmount, formatCents, centsToInput } from '../money.js';
import { budgetMonth, nowStamp, formatDateTime } from '../dates.js';
import { goalProgress, categoryBudgets, coverOptions, parsePercent, formatPercent } from '../budget.js';
import { addEntry, deleteGoal } from '../ops.js';
import { cleanGoal } from '../store.js';
import { money, howButton, bar, receiptBody, UNVERIFIED, emptyState } from '../components.js';
import { reducedMotion } from '../motion.js';

export function renderGoals(now, animate = false) {
  const st = app.state;
  const period = budgetMonth(now, st.settings.monthStartDay);
  const rv = animate ? ' reveal' : '';
  const fill = animate && !reducedMotion();

  // ---- Savings goals
  const goalRows = st.goals.map((g) => {
    const p = goalProgress(g, st.entries, now);
    const autoBp = (st.settings.autoSave ?? []).find((a) => a.goalId === g.id)?.bp ?? 0;
    return h('button', { class: 'goal', onClick: (e) => openGoalSheet(g, e.currentTarget) },
      h('div', { class: 'goal-top' },
        h('span', { class: 'goal-name' }, g.name),
        p.reached ? h('span', { class: 'badge' }, 'Reached') : autoBp ? h('span', { class: 'badge' }, `Auto-save ${formatPercent(autoBp)}`) : null),
      p.ok
        ? [h('div', { class: 'goal-amts' }, h('span', { class: 'num' }, formatCents(p.value)), h('span', { class: 'faint' }, ` of ${formatCents(g.targetCents)}`)),
          bar(p.percent, { gold: true, fill }),
          h('div', { class: 'goal-foot faint' }, p.reached ? 'Goal reached' : `${p.percent}% · ${formatCents(p.toGo)} to go`)]
        : h('p', { class: 'unverified' }, UNVERIFIED));
  });
  const goals = h('section', { class: `card sage${rv}` },
    h('h2', {}, 'Savings goals'),
    goalRows.length ? h('div', { class: 'goal-list' }, goalRows) : emptyState('goal', 'No goals yet', 'Add one, like "New shoes – $150", and watch it fill up.'),
    h('button', { class: 'add-line', onClick: () => openGoalSheet(null) }, icon('plus'), 'New goal'));

  // ---- Category budgets
  const b = categoryBudgets(st, period, now);
  const limited = b.rows.filter((r) => r.limit !== null);
  const free = b.rows.filter((r) => r.limit === null);
  const budgetRows = limited.map((r) => h('button', { class: 'budget', onClick: (e) => openBudgetSheet(r.category, e.currentTarget) },
    h('div', { class: 'goal-top' },
      h('span', {}, r.category),
      r.ok ? (r.over > 0 ? h('span', { class: 'num out' }, `Over by ${formatCents(r.over)}`) : h('span', { class: 'num' }, `${formatCents(r.value)} left`)) : h('span', { class: 'unverified' }, 'Hidden')),
    r.ok ? bar(r.percent, { over: r.over > 0, fill }) : null,
    r.ok ? h('div', { class: 'goal-foot faint' }, `${formatCents(r.spent.value)} of ${formatCents(r.effective)}${r.effective !== r.limit ? ' (this month)' : ''}`) : null));

  const total = limited.length && b.total.ok
    ? h('div', { class: 'budget-total' },
      h('div', {}, h('div', { class: 'faint small' }, 'Whole budget'),
        h('div', { class: `num big-ish ${b.total.value < 0 ? 'out' : ''}` }, b.total.value < 0 ? `Over by ${formatCents(-b.total.value)}` : `${formatCents(b.total.value)} left`),
        h('div', { class: 'faint small' }, `of ${formatCents(b.total.limit)} this month`)),
      howButton(b.total))
    : null;

  const budgets = h('section', { class: `card peach${rv}` },
    h('h2', {}, 'Category budgets'),
    total,
    limited.length ? h('div', { class: 'goal-list' }, budgetRows) : emptyState('leaf', 'No limits yet', 'Tap a category below to give it a monthly limit.'),
    free.length ? h('div', { class: 'free-list' }, free.map((r) => h('button', { class: 'row', onClick: (e) => openBudgetSheet(r.category, e.currentTarget) },
      h('span', { class: 'name' }, h('span', {}, r.category)),
      h('span', { class: 'faint small' }, r.spent.ok && r.spent.value ? `${formatCents(r.spent.value)} spent · Set a limit` : 'Set a limit')))) : null);

  return [goals, budgets];
}

// ---------- Goal sheet ----------
export function openGoalSheet(goal, from = null, prefill = 0) {
  const st = app.state;
  const d = { name: goal?.name ?? '', target: goal ? centsToInput(goal.targetCents) : '', add: '', pct: '' };
  let errors = {};
  const sheet = openSheet(goal ? goal.name : 'New goal', () => view(), { from });

  function view() {
    if (!goal) return editForm();
    const p = goalProgress(goal, st.entries, nowStamp());
    const plan = app.state.settings.autoSave ?? [];
    const mine = plan.find((a) => a.goalId === goal.id)?.bp ?? 0;
    const others = plan.filter((a) => a.goalId !== goal.id).reduce((a, p) => a + p.bp, 0);
    const isAuto = mine > 0;
    return [
      p.ok ? h('div', { class: 'confirm-card' },
        h('div', { class: 'big num goal-big' }, formatCents(p.value)),
        h('div', { class: 'meta' }, `saved of ${formatCents(goal.targetCents)}`),
        bar(p.percent, { gold: true }),
        h('div', { class: 'meta' }, p.reached ? 'Goal reached' : `${formatCents(p.toGo)} to go`),
        howButton(p)) : h('p', { class: 'unverified' }, UNVERIFIED),

      h('label', { class: 'field' }, h('span', {}, 'Add money to this goal'),
        h('div', { class: 'inline' },
          h('div', { class: 'money-input grow' }, h('span', { class: 'cur' }, '$'), h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', value: d.add, onInput: (e) => { d.add = e.target.value; } })),
          h('button', { class: 'btn primary narrow', onClick: reviewAdd }, 'Add'))),
      errors.add ? h('p', { class: 'error' }, errors.add) : null,

      h('div', { class: 'field' }, h('span', {}, 'Auto-save from each paycheck'),
        isAuto
          ? h('div', { class: 'inline' }, h('span', { class: 'grow' }, `${formatPercent(mine)} of every paycheck comes here.`),
            h('button', { class: 'btn ghost narrow', onClick: () => { change((s) => { s.settings.autoSave = (s.settings.autoSave ?? []).filter((a) => a.goalId !== goal.id); }, 'Auto-save to this goal turned off'); sheet.close(); } }, 'Turn off'))
          : h('div', { class: 'inline' },
            h('div', { class: 'pct-input grow' }, h('input', { class: 'input', inputmode: 'decimal', placeholder: '10', value: d.pct, onInput: (e) => { d.pct = e.target.value; } }), h('span', { class: 'cur-r' }, '%')),
            h('button', { class: 'btn primary narrow', onClick: () => turnOnAuto(others) }, 'Turn on'))),
      errors.pct ? h('p', { class: 'error' }, errors.pct) : null,
      others ? h('p', { class: 'faint small-note' }, `Your other goals already get ${formatPercent(others)} of each paycheck. This adds to that.`) : null,

      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle('Edit goal'); sheet.setContent(editForm()); } }, 'Edit name or target'),
        h('button', { class: 'btn danger', onClick: confirmDelete }, 'Delete goal')),
    ];
  }

  function editForm() {
    return [
      h('label', { class: 'field' }, h('span', {}, 'Name'), h('input', { class: 'input', maxlength: 60, placeholder: 'e.g. New shoes', value: d.name, onInput: (e) => { d.name = e.target.value; } })),
      errors.name ? h('p', { class: 'error' }, errors.name) : null,
      h('label', { class: 'field' }, h('span', {}, 'Target amount'),
        h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), h('input', { class: 'input', inputmode: 'decimal', placeholder: '150.00', value: d.target, onInput: (e) => { d.target = e.target.value; } }))),
      errors.target ? h('p', { class: 'error' }, errors.target) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: saveGoal }, goal ? 'Save changes' : 'Create goal')),
    ];
  }

  function saveGoal() {
    errors = {};
    const target = parseAmount(d.target);
    if (!d.name.trim()) errors.name = 'Give it a name';
    if (target === null) errors.target = 'Enter a target, like 150';
    if (Object.keys(errors).length) { sheet.setContent(editForm()); return; }
    const g = cleanGoal({ id: goal?.id ?? newId(), name: d.name.trim(), targetCents: target, createdAt: goal?.createdAt ?? new Date().toISOString() });
    change((s) => {
      if (goal) {
        s.goals = s.goals.map((x) => (x.id === g.id ? g : x));
      } else {
        s.goals.push(g);
      }
    }, goal ? 'Goal updated' : 'Goal created');
    sheet.close();
  }

  function reviewAdd() {
    errors = {};
    const cents = parseAmount(d.add);
    if (cents === null) { errors.add = 'Enter an amount, like 20'; sheet.setContent(view()); return; }
    const at = nowStamp();
    const entry = { id: newId(), type: 'saving', name: `To ${goal.name}`, cents, at, category: 'Savings', note: '', goalId: goal.id };
    sheet.setTitle('Add this?');
    sheet.setContent(
      h('div', { class: 'confirm-card' },
        h('div', { class: 'big num dim' }, icon('down', 'arrow'), formatCents(-cents)),
        h('div', { class: 'what' }, `To ${goal.name}`),
        h('div', { class: 'meta' }, formatDateTime(at)),
        h('div', { class: 'meta' }, 'Moves money from what\'s left into this goal.')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => { change((s) => addEntry(s, entry, newId), 'Added to goal'); sheet.close(); } }, 'Save'),
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle(goal.name); sheet.setContent(view()); } }, 'Back')));
  }

  function turnOnAuto(others) {
    errors = {};
    const bp = parsePercent(d.pct);
    if (bp === null || bp === 0) { errors.pct = 'Enter a percentage, like 10'; sheet.setContent(view()); return; }
    if (bp + others > 10000) { errors.pct = `With your other goals that's ${formatPercent(bp + others)}. Keep the total at 100% or less.`; sheet.setContent(view()); return; }
    change((s) => { s.settings.autoSave = [...(s.settings.autoSave ?? []).filter((a) => a.goalId !== goal.id), { goalId: goal.id, bp }]; },
      `Auto-save on: ${formatPercent(bp)} of each paycheck to ${goal.name}`);
    sheet.close();
  }

  // A bigger-than-usual paycheck: start with the extra filled in.
  if (goal && prefill) { d.add = centsToInput(prefill).replace(/\.00$/, ''); sheet.setContent(view()); }

  function confirmDelete() {
    sheet.setTitle('Delete this goal?');
    sheet.setContent(
      h('p', { class: 'dim' }, `"${goal.name}" will be removed. Money already moved to savings stays in your records.`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => { change((s) => deleteGoal(s, goal.id), 'Goal deleted'); sheet.close(); } }, 'Delete goal'),
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle(goal.name); sheet.setContent(view()); } }, 'Keep it')));
  }
}

// ---------- Category budget sheet ----------
function openBudgetSheet(category, from = null) {
  const st = app.state;
  const now = nowStamp();
  const period = budgetMonth(now, st.settings.monthStartDay);
  const current = st.limits[category];
  const d = { limit: Number.isSafeInteger(current) ? centsToInput(current) : '' };
  let error = null;
  const sheet = openSheet(category, () => view(), { from });

  function view() {
    const b = categoryBudgets(app.state, period, now);
    const row = b.rows.find((r) => r.category === category);
    const parts = [];
    if (row?.limit !== null && row) {
      parts.push(h('div', { class: 'split' }, receiptBody(row)));
      if (row.ok && row.over > 0) {
        const opts = coverOptions(b, category);
        parts.push(h('div', { class: 'field' },
          h('span', {}, `Cover the ${formatCents(row.over)} from another category (this month only)`),
          opts.length
            ? h('div', { class: 'rows' }, opts.map((o) => {
              const amount = Math.min(o.room, row.over);
              return h('button', { class: 'row', onClick: () => confirmCover(o.category, amount) },
                h('span', { class: 'name' }, h('span', {}, o.category)),
                h('span', { class: 'faint small' }, `${formatCents(o.room)} left`),
                h('span', { class: 'num small' }, `take ${formatCents(amount)}`));
            }))
            : h('p', { class: 'faint small-note' }, 'No other category has room left this month.')));
      }
    } else if (row) {
      parts.push(h('p', { class: 'dim' }, `${formatCents(row.spent.value ?? 0)} spent this month. No limit yet.`));
    }
    parts.push(
      h('label', { class: 'field' }, h('span', {}, 'Monthly limit (leave empty for no limit)'),
        h('div', { class: 'money-input' }, h('span', { class: 'cur' }, '$'), h('input', { class: 'input', inputmode: 'decimal', placeholder: 'No limit', value: d.limit, onInput: (e) => { d.limit = e.target.value; } }))),
      error ? h('p', { class: 'error' }, error) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: saveLimit }, 'Save limit')));
    return parts;
  }

  function saveLimit() {
    const raw = d.limit.trim();
    const cents = raw === '' ? null : parseAmount(raw);
    if (raw !== '' && cents === null) { error = 'Enter an amount, like 200'; sheet.setContent(view()); return; }
    change((s) => {
      if (cents === null) delete s.limits[category];
      else s.limits[category] = cents;
    }, cents === null ? `${category} has no limit` : `${category} limit set to ${formatCents(cents)}`);
    sheet.close();
  }

  function confirmCover(from, amount) {
    sheet.setTitle('Move this?');
    sheet.setContent(
      h('div', { class: 'confirm-card' },
        h('div', { class: 'big num' }, formatCents(amount)),
        h('div', { class: 'what' }, `From ${from} to ${category}`),
        h('div', { class: 'meta' }, `For ${period.short} only. Limits go back to normal next month, and your total budget stays the same.`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => {
          change((s) => { s.adjustments.push({ id: newId(), month: period.start, from, to: category, cents: amount }); }, `Moved ${formatCents(amount)} from ${from}`);
          sheet.close();
        } }, 'Move it'),
        h('button', { class: 'btn ghost', onClick: () => { sheet.setTitle(category); sheet.setContent(view()); } }, 'Back')));
  }
}
