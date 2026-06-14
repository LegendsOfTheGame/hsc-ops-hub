import { select, insert, update } from '../db.js';
import { showToast, openModal, closeModal } from '../utils.js';
import { getRole } from '../auth.js';

let allItems = [];

export async function renderInventory(root) {
  const isField = getRole() === 'field';
  root.innerHTML = `
    <div class="page-title">Inventory</div>
    <div class="page-subtitle">Supply stock and cost tracking (AVCO method)</div>
    <div class="toolbar">
      <div class="toolbar-spacer"></div>
      <button class="btn btn-primary" id="inv-add">+ Add Item</button>
    </div>
    <div id="inv-wrap"><div class="loading">Loading…</div></div>
  `;
  root.querySelector('#inv-add').addEventListener('click', () => openItemModal(null, root, isField));
  const { data } = await select('inventory_items', { order: 'name', ascending: true });
  allItems = data || [];
  renderItems(root);
}

function renderItems(root) {
  const isField = getRole() === 'field';
  const wrap = root.querySelector('#inv-wrap');
  if (!wrap) return;
  if (!allItems.length) { wrap.innerHTML = `<div class="empty-state"><div class="icon">📦</div>No inventory items yet.</div>`; return; }
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>Item</th><th>Qty</th><th>Unit Cost</th><th>Total Value</th><th>Stock</th><th></th></tr></thead>
    <tbody>
      ${allItems.map(item => {
        const qty   = parseFloat(item.quantity) || 0;
        const cost  = parseFloat(item.weighted_avg_cost || item.unit_cost) || 0;
        const total = qty * cost;
        const level = qty > 5 ? 'stock-ok' : qty > 1 ? 'stock-low' : 'stock-crit';
        const pct   = Math.min(100, (qty / 10) * 100);
        return `<tr>
          <td><strong>${item.name}</strong></td>
          <td>${qty}</td>
          <td>$${cost.toFixed(2)}</td>
          <td>$${total.toFixed(2)}</td>
          <td style="min-width:80px">
            <div class="${level}"><div class="stock-bar"><div class="stock-bar-fill" style="width:${pct}%"></div></div></div>
          </td>
          <td><button class="btn btn-sm btn-secondary" data-id="${item.id}">${isField ? 'Add Stock' : 'Edit'}</button></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
  wrap.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = allItems.find(i => String(i.id) === btn.dataset.id);
      if (!item) return;
      if (isField) openAddStockModal(item, root);
      else openItemModal(item, root, false);
    });
  });
}

function openAddStockModal(item, root) {
  const html = `
    <div class="modal-header"><h2>Add Stock — ${item.name}</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Quantity to Add</label>
        <input type="number" id="inv-add-qty" min="0.01" step="0.01" placeholder="e.g. 1">
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="inv-add-save">Add Stock</button>
        <button class="btn btn-secondary" id="inv-add-cancel">Cancel</button>
      </div>
    </div>`;
  openModal(html, box => {
    box.querySelector('#inv-add-cancel').addEventListener('click', closeModal);
    box.querySelector('#inv-add-save').addEventListener('click', async () => {
      const qty = parseFloat(box.querySelector('#inv-add-qty').value) || 0;
      if (qty <= 0) { showToast('Enter a positive quantity'); return; }
      await update('inventory_items', { id: item.id }, { quantity: parseFloat(item.quantity || 0) + qty });
      showToast('✓ Stock added');
      closeModal();
      const { data } = await select('inventory_items', { order: 'name', ascending: true });
      allItems = data || [];
      renderItems(root);
    });
  });
}

function openItemModal(item, root) {
  const isNew = !item;
  const html = `
    <div class="modal-header"><h2>${isNew ? 'Add Item' : 'Edit ' + item.name}</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Name</label><input type="text" id="inv-name" value="${item?.name || ''}"></div>
      <div class="form-row">
        <div class="form-group"><label>Quantity</label><input type="number" id="inv-qty" step="0.01" value="${item?.quantity || ''}"></div>
        <div class="form-group"><label>Unit Cost ($)</label><input type="number" id="inv-cost" step="0.01" value="${item?.unit_cost || ''}"></div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="inv-save">Save</button>
        <button class="btn btn-secondary" id="inv-cancel">Cancel</button>
      </div>
    </div>`;
  openModal(html, box => {
    box.querySelector('#inv-cancel').addEventListener('click', closeModal);
    box.querySelector('#inv-save').addEventListener('click', async () => {
      const row = { name: box.querySelector('#inv-name').value.trim(), quantity: parseFloat(box.querySelector('#inv-qty').value) || 0, unit_cost: parseFloat(box.querySelector('#inv-cost').value) || 0 };
      if (isNew) { await insert('inventory_items', row); showToast('✓ Item added'); }
      else       { await update('inventory_items', { id: item.id }, row); showToast('✓ Updated'); }
      closeModal();
      const { data } = await select('inventory_items', { order: 'name', ascending: true });
      allItems = data || [];
      renderItems(root);
    });
  });
}
