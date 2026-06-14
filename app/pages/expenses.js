import { select, insert, remove } from '../db.js';
import { showToast, openModal, closeModal, localDateStr, fmtDate } from '../utils.js';

const CATEGORIES = ['Supplies','Fuel','Equipment','Phone','Parking','Other'];
let allExpenses = [];

export async function renderExpenses(root) {
  root.innerHTML = `
    <div class="page-title">My Expenses</div>
    <div class="page-subtitle">Personal business expenses</div>
    <div class="toolbar">
      <div class="toolbar-spacer"></div>
      <button class="btn btn-primary" id="ex-add">+ Add Expense</button>
    </div>
    <div id="ex-wrap"><div class="loading">Loading…</div></div>
  `;
  root.querySelector('#ex-add').addEventListener('click', () => openExpenseModal(root));
  const { data } = await select('personal_expenses', { order: 'date', ascending: false });
  allExpenses = data || [];
  renderExpenses2(root);
}

function renderExpenses2(root) {
  const wrap = root.querySelector('#ex-wrap');
  if (!wrap) return;
  if (!allExpenses.length) { wrap.innerHTML = `<div class="empty-state"><div class="icon">💵</div>No expenses yet.</div>`; return; }
  const total = allExpenses.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  wrap.innerHTML = `<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Total: <strong style="color:var(--accent)">$${total.toFixed(2)}</strong></div>
  <table class="data-table">
    <thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Notes</th><th></th></tr></thead>
    <tbody>
      ${allExpenses.map(r => `<tr>
        <td>${fmtDate(r.date)}</td>
        <td><span class="badge badge-muted">${r.category || '—'}</span></td>
        <td>$${parseFloat(r.amount || 0).toFixed(2)}</td>
        <td style="font-size:12px;color:var(--text-muted)">${r.notes || '—'}</td>
        <td><button class="btn btn-sm btn-danger" data-id="${r.id}">Del</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
  wrap.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this expense?')) return;
      await remove('personal_expenses', { id: btn.dataset.id });
      const { data } = await select('personal_expenses', { order: 'date', ascending: false });
      allExpenses = data || [];
      renderExpenses2(root);
    });
  });
}

function openExpenseModal(root) {
  const html = `
    <div class="modal-header"><h2>Add Expense</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label>Date</label><input type="date" id="ex-date" value="${localDateStr()}"></div>
        <div class="form-group"><label>Amount ($)</label><input type="number" id="ex-amount" step="0.01"></div>
      </div>
      <div class="form-group"><label>Category</label><select id="ex-cat">${CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label>Notes</label><input type="text" id="ex-notes" placeholder="Description…"></div>
      <div class="btn-group">
        <button class="btn btn-primary" id="ex-save">Add</button>
        <button class="btn btn-secondary" id="ex-cancel">Cancel</button>
      </div>
    </div>`;
  openModal(html, box => {
    box.querySelector('#ex-cancel').addEventListener('click', closeModal);
    box.querySelector('#ex-save').addEventListener('click', async () => {
      const row = { date: box.querySelector('#ex-date').value, amount: parseFloat(box.querySelector('#ex-amount').value) || 0, category: box.querySelector('#ex-cat').value, notes: box.querySelector('#ex-notes').value.trim() || null };
      await insert('personal_expenses', row);
      closeModal();
      showToast('✓ Expense added');
      const { data } = await select('personal_expenses', { order: 'date', ascending: false });
      allExpenses = data || [];
      renderExpenses2(root);
    });
  });
}
