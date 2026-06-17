import { select, insert, update } from '../db.js';
import { showToast, openModal, closeModal, localDateStr, fmtDate } from '../utils.js';
import { getRole } from '../auth.js';

let allItems = [];

export async function renderInventory(root) {
  root.innerHTML = `
    <div class="page-title">Inventory</div>
    <div class="page-subtitle">Supply stock and cost tracking (AVCO method)</div>
    <div class="toolbar">
      <div class="toolbar-spacer"></div>
      <button class="btn btn-primary" id="inv-add">+ Add Item</button>
    </div>
    <div id="inv-wrap"><div class="loading">Loading…</div></div>
  `;
  root.querySelector('#inv-add').addEventListener('click', () => openItemModal(null, root));
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
    <thead><tr><th>Item</th><th>In Stock</th><th>Avg Cost / Unit</th><th>Total Value</th><th></th></tr></thead>
    <tbody>
      ${allItems.map(item => {
        const qty  = parseFloat(item.quantity) || 0;
        const cost = parseFloat(item.weighted_avg_cost || item.unit_cost) || 0;
        const unit = item.unit || '';
        const level = qty <= 0 ? 'color:var(--danger)' : qty < 16 ? 'color:var(--warning,#f5a623)' : 'color:var(--success,#4caf50)';
        return `<tr>
          <td>
            <span class="inv-name-link" data-id="${item.id}" style="font-weight:700;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px">${item.name}</span>
            ${unit ? `<span style="font-size:11px;color:var(--text-muted);margin-left:4px">(${unit})</span>` : ''}
          </td>
          <td><span style="${level};font-weight:600">${qty}${unit ? ' ' + unit : ''}</span></td>
          <td style="font-family:monospace">$${cost.toFixed(4)}${unit ? ' / ' + unit : ''}</td>
          <td style="font-family:monospace">$${(qty * cost).toFixed(2)}</td>
          <td style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
            ${isField
              ? `<button class="btn btn-sm btn-secondary inv-stock-btn" data-id="${item.id}">+ Stock</button>`
              : `<button class="btn btn-sm btn-secondary inv-edit-btn" data-id="${item.id}">Edit</button>
                 <button class="btn btn-sm btn-secondary inv-stock-btn" data-id="${item.id}">+ Stock</button>`
            }
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  wrap.querySelectorAll('.inv-name-link').forEach(el => {
    el.addEventListener('click', () => {
      const item = allItems.find(i => String(i.id) === el.dataset.id);
      if (item) openHistoryModal(item);
    });
  });
  wrap.querySelectorAll('.inv-stock-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = allItems.find(i => String(i.id) === btn.dataset.id);
      if (item) openAddStockModal(item, root);
    });
  });
  wrap.querySelectorAll('.inv-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = allItems.find(i => String(i.id) === btn.dataset.id);
      if (item) openItemModal(item, root);
    });
  });
}

// ── History modal ─────────────────────────────────────────────────────────────

async function openHistoryModal(item) {
  const unit = item.unit || '';
  const avco = parseFloat(item.weighted_avg_cost || item.unit_cost) || 0;
  const qty  = parseFloat(item.quantity) || 0;

  const html = `
    <div class="modal-header">
      <h2>📊 ${item.name}</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
        <div style="background:var(--surface-2,var(--card-bg));border-radius:8px;padding:10px 16px;flex:1;min-width:120px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">In Stock</div>
          <div style="font-size:22px;font-weight:700;color:var(--accent)">${qty}${unit ? ' ' + unit : ''}</div>
        </div>
        <div style="background:var(--surface-2,var(--card-bg));border-radius:8px;padding:10px 16px;flex:1;min-width:120px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Avg Cost</div>
          <div style="font-size:22px;font-weight:700;color:var(--accent)">$${avco.toFixed(4)}${unit ? ' / ' + unit : ''}</div>
        </div>
        <div style="background:var(--surface-2,var(--card-bg));border-radius:8px;padding:10px 16px;flex:1;min-width:120px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Total Value</div>
          <div style="font-size:22px;font-weight:700">$${(qty * avco).toFixed(2)}</div>
        </div>
      </div>
      <div id="hist-table"><div class="loading">Loading history…</div></div>
    </div>`;

  openModal(html, async box => {
    const { data } = await select('inventory_log', { filter: { item_id: item.id }, order: 'logged_at', ascending: true });
    const rows = data || [];
    const histEl = box.querySelector('#hist-table');

    if (!rows.length) {
      histEl.innerHTML = '<div class="empty-state" style="padding:12px 0">No purchase or usage history yet.</div>';
      return;
    }

    // Compute running AVCO per row
    let runQty = 0, runAvco = 0;
    const annotated = rows.map(r => {
      const rQty  = Math.abs(parseFloat(r.quantity) || 0);
      const rCost = parseFloat(r.cost_per_unit) || 0;
      if (r.change_type === 'purchase') {
        const newTotal = runQty + rQty;
        runAvco = newTotal > 0 ? (runQty * runAvco + rQty * rCost) / newTotal : rCost;
        runQty  = newTotal;
      } else {
        runQty = Math.max(0, runQty - rQty);
      }
      return { ...r, snapQty: runQty, snapAvco: runAvco };
    });

    histEl.innerHTML = `<table class="data-table" style="font-size:13px">
      <thead><tr>
        <th>Date</th><th>Type</th><th>Qty</th>
        ${rows.some(r => r.change_type === 'purchase') ? '<th>Cost/Unit</th>' : ''}
        <th>Running Avg</th><th>Notes</th>
      </tr></thead>
      <tbody>
        ${annotated.map(r => {
          const rQty   = Math.abs(parseFloat(r.quantity) || 0);
          const rCost  = parseFloat(r.cost_per_unit) || 0;
          const isPurch = r.change_type === 'purchase';
          const dateStr = r.purchased_at ? fmtDate(r.purchased_at) : fmtDate(r.logged_at || r.created_at);
          return `<tr>
            <td style="white-space:nowrap">${dateStr}</td>
            <td>${isPurch ? '📦 Purchase' : '🧴 Used'}</td>
            <td style="font-family:monospace;color:${isPurch ? 'var(--success,#4caf50)' : 'var(--danger)'}">
              ${isPurch ? '+' : '−'}${rQty}${unit ? ' ' + unit : ''}
            </td>
            ${rows.some(r2 => r2.change_type === 'purchase') ? `<td style="font-family:monospace">${isPurch && rCost > 0 ? '$' + rCost.toFixed(4) : '—'}</td>` : ''}
            <td style="font-family:monospace">$${r.snapAvco.toFixed(4)}${unit ? ' / ' + unit : ''}</td>
            <td style="color:var(--text-muted)">${r.notes || '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  });
}

// ── Add Stock modal ───────────────────────────────────────────────────────────

function openAddStockModal(item, root) {
  const curCost = parseFloat(item.weighted_avg_cost || item.unit_cost || 0);
  const unit = item.unit || '';
  const today = localDateStr();

  const html = `
    <div class="modal-header"><h2>+ Stock — ${item.name}</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Purchase Date</label>
        <input type="date" id="inv-purch-date" value="${today}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Qty Added${unit ? ' (' + unit + ')' : ''}</label>
          <input type="number" id="inv-add-qty" min="0.01" step="0.01" placeholder="e.g. 128">
        </div>
        <div class="form-group">
          <label>Cost / ${unit || 'unit'} ($) <span style="font-weight:400;font-size:11px">avg: $${curCost.toFixed(4)}</span></label>
          <input type="number" id="inv-add-cost" min="0" step="0.0001" placeholder="${curCost.toFixed(4)}">
        </div>
      </div>
      <details style="margin-bottom:12px">
        <summary style="cursor:pointer;font-size:13px;color:var(--accent);user-select:none">📦 Package calculator</summary>
        <div style="margin-top:10px;padding:10px;background:var(--surface-2,var(--card-bg));border-radius:8px;display:flex;flex-direction:column;gap:8px">
          <div class="form-row">
            <div class="form-group" style="margin:0">
              <label style="font-size:12px">Total purchase price ($)</label>
              <input type="number" id="pkg-price" min="0" step="0.01" placeholder="e.g. 111.07">
            </div>
            <div class="form-group" style="margin:0">
              <label style="font-size:12px">${unit ? unit + ' in package' : 'Units in package'}</label>
              <input type="number" id="pkg-units" min="0.01" step="0.01" placeholder="e.g. 128">
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-muted)" id="pkg-result">Enter price + units to calculate cost per unit.</div>
        </div>
      </details>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;font-size:11px">(optional)</span></label>
        <input type="text" id="inv-add-notes" placeholder="e.g. 1-gallon jug from Bunzl">
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="inv-add-save">Add Stock</button>
        <button class="btn btn-secondary" id="inv-add-cancel">Cancel</button>
      </div>
    </div>`;

  openModal(html, box => {
    box.querySelector('#inv-add-cancel').addEventListener('click', closeModal);

    function calcPkg() {
      const price = parseFloat(box.querySelector('#pkg-price').value) || 0;
      const units = parseFloat(box.querySelector('#pkg-units').value) || 0;
      const result = box.querySelector('#pkg-result');
      if (price > 0 && units > 0) {
        const perUnit = price / units;
        result.textContent = `→ $${perUnit.toFixed(4)} per ${unit || 'unit'}`;
        result.style.color = 'var(--accent)';
        box.querySelector('#inv-add-cost').value = perUnit.toFixed(4);
        box.querySelector('#inv-add-qty').value  = units.toFixed(2).replace(/\.?0+$/, '');
      } else {
        result.textContent = 'Enter price + units to calculate cost per unit.';
        result.style.color = '';
      }
    }
    box.querySelector('#pkg-price').addEventListener('input', calcPkg);
    box.querySelector('#pkg-units').addEventListener('input', calcPkg);

    box.querySelector('#inv-add-save').addEventListener('click', async () => {
      const qty       = parseFloat(box.querySelector('#inv-add-qty').value) || 0;
      const newCost   = parseFloat(box.querySelector('#inv-add-cost').value);
      const purchDate = box.querySelector('#inv-purch-date').value || today;
      const notes     = box.querySelector('#inv-add-notes').value.trim() || null;

      if (qty <= 0) { showToast('Enter a positive quantity'); return; }

      const oldQty  = parseFloat(item.quantity || 0);
      const oldCost = parseFloat(item.weighted_avg_cost || item.unit_cost || 0);
      const totalQty = oldQty + qty;
      const costToUse = (!isNaN(newCost) && newCost > 0) ? newCost : oldCost;
      const newAvco = totalQty > 0 ? (oldQty * oldCost + qty * costToUse) / totalQty : costToUse;

      await update('inventory_items', { id: item.id }, {
        quantity: totalQty,
        weighted_avg_cost: newAvco,
      });

      // Log purchase lot to inventory_log
      const logRow = {
        item_id:      item.id,
        item_name:    item.name,
        change_type:  'purchase',
        quantity:     qty,
        cost_per_unit: costToUse,
        purchased_at: purchDate,
        logged_at:    new Date().toISOString(),
        notes,
      };
      const { error: logErr } = await insert('inventory_log', logRow);
      if (logErr) {
        // Retry with minimal columns if schema differs
        await insert('inventory_log', {
          item_id:     item.id,
          change_type: 'purchase',
          quantity:    qty,
          logged_at:   new Date().toISOString(),
          notes,
        });
      }

      showToast(`✓ ${qty}${unit ? ' ' + unit : ''} added — new avg $${newAvco.toFixed(4)}${unit ? '/' + unit : ''}`);
      closeModal();
      const { data } = await select('inventory_items', { order: 'name', ascending: true });
      allItems = data || [];
      renderItems(root);
    });
  });
}

// ── Add / Edit item modal ─────────────────────────────────────────────────────

function openItemModal(item, root) {
  const isNew = !item;
  const html = `
    <div class="modal-header"><h2>${isNew ? 'Add Item' : 'Edit — ' + item.name}</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group" style="flex:2">
          <label>Name</label>
          <input type="text" id="inv-name" value="${item?.name || ''}">
        </div>
        <div class="form-group" style="flex:1">
          <label>Unit <span style="font-weight:400;font-size:11px">e.g. oz, wipes</span></label>
          <input type="text" id="inv-unit" value="${item?.unit || ''}" placeholder="oz">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Current Qty</label>
          <input type="number" id="inv-qty" step="0.01" value="${item?.quantity || ''}">
        </div>
        <div class="form-group">
          <label>Avg Cost ($) / unit</label>
          <input type="number" id="inv-cost" step="0.0001" value="${item?.weighted_avg_cost || item?.unit_cost || ''}">
        </div>
      </div>
      <details style="margin-bottom:12px">
        <summary style="cursor:pointer;font-size:13px;color:var(--accent);user-select:none">📦 Package calculator</summary>
        <div style="margin-top:10px;padding:10px;background:var(--surface-2,var(--card-bg));border-radius:8px;display:flex;flex-direction:column;gap:8px">
          <div class="form-row">
            <div class="form-group" style="margin:0">
              <label style="font-size:12px">Total purchase price ($)</label>
              <input type="number" id="pkg-price" min="0" step="0.01" placeholder="e.g. 111.07">
            </div>
            <div class="form-group" style="margin:0">
              <label style="font-size:12px">Units in package</label>
              <input type="number" id="pkg-units" min="0.01" step="0.01" placeholder="e.g. 128">
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-muted)" id="pkg-result">Enter price + units to calculate cost per unit.</div>
        </div>
      </details>
      <div class="btn-group">
        <button class="btn btn-primary" id="inv-save">Save</button>
        <button class="btn btn-secondary" id="inv-cancel">Cancel</button>
      </div>
    </div>`;

  openModal(html, box => {
    box.querySelector('#inv-cancel').addEventListener('click', closeModal);

    function calcPkg() {
      const price = parseFloat(box.querySelector('#pkg-price').value) || 0;
      const units = parseFloat(box.querySelector('#pkg-units').value) || 0;
      const result = box.querySelector('#pkg-result');
      if (price > 0 && units > 0) {
        const perUnit = price / units;
        result.textContent = `→ $${perUnit.toFixed(4)} per unit`;
        result.style.color = 'var(--accent)';
        box.querySelector('#inv-cost').value = perUnit.toFixed(4);
        if (isNew) box.querySelector('#inv-qty').value = units.toFixed(2).replace(/\.?0+$/, '');
      } else {
        result.textContent = 'Enter price + units to calculate cost per unit.';
        result.style.color = '';
      }
    }
    box.querySelector('#pkg-price').addEventListener('input', calcPkg);
    box.querySelector('#pkg-units').addEventListener('input', calcPkg);

    box.querySelector('#inv-save').addEventListener('click', async () => {
      const name = box.querySelector('#inv-name').value.trim();
      const unit = box.querySelector('#inv-unit').value.trim();
      const qty  = parseFloat(box.querySelector('#inv-qty').value) || 0;
      const cost = parseFloat(box.querySelector('#inv-cost').value) || 0;
      if (!name) { showToast('Enter an item name'); return; }

      const row = { name, quantity: qty, unit_cost: cost, weighted_avg_cost: cost };
      if (unit) row.unit = unit;

      const saveRow = async (r) => isNew ? insert('inventory_items', r) : update('inventory_items', { id: item.id }, r);

      let { error } = await saveRow(row);
      if (error && unit) {
        // Retry without unit if column doesn't exist yet
        const { unit: _u, ...rowWithoutUnit } = row;
        ({ error } = await saveRow(rowWithoutUnit));
      }
      if (error) { showToast('Failed to save — check connection'); return; }

      showToast(isNew ? '✓ Item added' : '✓ Updated');
      closeModal();
      const { data } = await select('inventory_items', { order: 'name', ascending: true });
      allItems = data || [];
      renderItems(root);
    });
  });
}
