/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onWillStart, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class FinanceDashboard extends Component {
    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");

        const now = new Date();

        this.monthOptions = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            this.monthOptions.push({
                value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                label: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
            });
        }

        this.yearOptions = [];
        for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) {
            this.yearOptions.push(y);
        }

        const todayStr = this._fmt(now);

        this.state = useState({
            invoices:          [],
            vendor_bills:      [],
            transactions:      [],
            journal_balances:  [],
            // ── Default: Today ──────────────────────────────────
            from_date:         todayStr,
            to_date:           todayStr,
            partner_filter:    '',
            active_preset:     'today',           // Today selected by default
            selected_month:    this.monthOptions[0].value,
            selected_year:     String(now.getFullYear()),
            sortKey:           '',
            sortOrder:         'asc',
            partner_id_filter: '',
            partnerOptions:    [],
            // Print modal
            showPrintModal:       false,
            printInvoiceLines:    false,
            printVendorLines:     false,
            printJournalBalance:  true,            // Journal Balance table toggle (replaces Transaction detail rows)
        });

        // Store lines outside OWL state — reactive proxy strips nested arrays
        this._invoiceLines = {};
        this._vendorLines  = {};

        onWillStart(async () => { await this.loadData(); });
    }

    // ── Helpers ───────────────────────────────────────────────
    _fmt(date) { return date.toISOString().split('T')[0]; }

    _setDates(from, to, preset = 'custom') {
        this.state.from_date     = this._fmt(from);
        this.state.to_date       = this._fmt(to);
        this.state.active_preset = preset;
        this.loadData();
    }

    // ── Presets ───────────────────────────────────────────────
    applyPreset(preset) {
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
        switch (preset) {
            case 'today':      this._setDates(now, now, preset); break;
            case 'this_week': {
                const day = now.getDay();
                const mon = new Date(y, m, d - ((day + 6) % 7));
                const sun = new Date(y, m, d + (7 - ((day + 6) % 7)) % 7);
                this._setDates(mon, sun, preset); break;
            }
            case 'this_month': this._setDates(new Date(y, m, 1), new Date(y, m + 1, 0), preset); break;
            case 'this_year':  this._setDates(new Date(y, 0, 1), new Date(y, 11, 31), preset);  break;
            case 'all':
                this.state.from_date = ''; this.state.to_date = '';
                this.state.active_preset = 'all';
                this.loadData(); break;
        }
    }

    onMonthChange(ev) {
        const [y, mo] = ev.target.value.split('-').map(Number);
        this.state.selected_month = ev.target.value;
        this._setDates(new Date(y, mo - 1, 1), new Date(y, mo, 0), 'custom');
    }

    onYearChange(ev) {
        const y = Number(ev.target.value);
        this.state.selected_year = ev.target.value;
        this._setDates(new Date(y, 0, 1), new Date(y, 11, 31), 'custom');
    }

    onDateChange() {
        if (this.state.from_date && this.state.to_date) {
            this.state.active_preset = 'custom';
            this.loadData();
        }
    }

    // ── Data ──────────────────────────────────────────────────
    async loadData() {
        try {
            const [data, journalBalances] = await Promise.all([
                this.orm.call(
                    "dashboard.data", "get_finance_dashboard",
                    [this.state.from_date || false, this.state.to_date || false]
                ),
                this.orm.call(
                    "dashboard.data", "get_journal_balance",
                    [this.state.from_date || false, this.state.to_date || false]
                ),
            ]);

            this._invoiceLines = {};
            this._vendorLines  = {};
            const invoices = (data.invoices || []).map(r => {
                this._invoiceLines[r.id] = r.lines || [];
                const { lines, ...rest } = r;
                return rest;
            });
            const vendorBills = (data.vendor_bills || []).map(r => {
                this._vendorLines[r.id] = r.lines || [];
                const { lines, ...rest } = r;
                return rest;
            });

            this.state.invoices         = invoices;
            this.state.vendor_bills     = vendorBills;
            this.state.transactions     = data.transactions || [];
            this.state.journal_balances = journalBalances || [];

            const partnerMap = {};
            [...invoices, ...vendorBills, ...(data.transactions || [])].forEach(r => {
                if (r.partner_id && r.partner) partnerMap[r.partner_id] = r.partner;
            });
            this.state.partnerOptions = Object.entries(partnerMap)
                .map(([id, name]) => ({ id: String(id), name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            if (this.state.sortKey) this._applySort();
        } catch (e) {
            console.error("FinanceDashboard failed to load:", e);
        }
    }

    // ── Partner filter ────────────────────────────────────────
    _matchesPartner(r) {
        const q   = this.state.partner_filter.trim().toLowerCase();
        const pid = this.state.partner_id_filter;
        const nameOk = !q   || (r.partner || '').toLowerCase().includes(q);
        const idOk   = !pid || String(r.partner_id) === pid;
        return nameOk && idOk;
    }
    get filteredInvoices()     { return this.state.invoices.filter(r => this._matchesPartner(r)); }
    get filteredVendorBills()  { return this.state.vendor_bills.filter(r => this._matchesPartner(r)); }
    get filteredTransactions() { return this.state.transactions.filter(r => this._matchesPartner(r)); }

    // ── Sorting (transactions) ────────────────────────────────
    sortTransactions(key) {
        if (this.state.sortKey === key) {
            this.state.sortOrder = this.state.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.state.sortKey = key; this.state.sortOrder = 'asc';
        }
        this._applySort();
    }

    _applySort() {
        const key = this.state.sortKey, order = this.state.sortOrder === 'asc' ? 1 : -1;
        this.state.transactions.sort((a, b) => {
            let vA = a[key] ?? '', vB = b[key] ?? '';
            if (typeof vA === 'number' && typeof vB === 'number') return (vA - vB) * order;
            return vA.toString().localeCompare(vB.toString()) * order;
        });
    }

    // ── Totals ────────────────────────────────────────────────
    _sum(arr, field) { return arr.reduce((s, r) => s + (r[field] || 0), 0).toFixed(2); }
    _cnt(arr, field) { return arr.reduce((s, r) => s + (r[field] || 0), 0); }

    get invoiceTotalAmount()    { return this._sum(this.filteredInvoices,    'amount'); }
    get invoiceTotalResidual()  { return this._sum(this.filteredInvoices,    'residual'); }
    get vendorTotalAmount()     { return this._sum(this.filteredVendorBills, 'amount'); }
    get vendorTotalResidual()   { return this._sum(this.filteredVendorBills, 'residual'); }
    get txTotalReceived()       { return this._sum(this.filteredTransactions, 'received'); }
    get txTotalPaid()           { return this._sum(this.filteredTransactions, 'paid'); }

    get jbTotalOpening()        { return this._sum(this.state.journal_balances, 'opening'); }
    get jbTotalDeposit()        { return this._sum(this.state.journal_balances, 'deposit'); }
    get jbTotalDepositCount()   { return this._cnt(this.state.journal_balances, 'deposit_count'); }
    get jbTotalWithdraw()       { return this._sum(this.state.journal_balances, 'withdraw'); }
    get jbTotalWithdrawCount()  { return this._cnt(this.state.journal_balances, 'withdraw_count'); }
    get jbTotalClosing()        { return this._sum(this.state.journal_balances, 'closing'); }

    // ── Print modal ───────────────────────────────────────────
    openPrintModal()  { this.state.showPrintModal = true; }
    closePrintModal() { this.state.showPrintModal = false; }

    doPrint() {
        // Snapshot state BEFORE touching reactive proxy
        const includeInvLines       = this.state.printInvoiceLines;
        const includeVendorLines    = this.state.printVendorLines;
        const includeJournalBalance = this.state.printJournalBalance;

        // Deep-copy data and reattach invoice/vendor lines from the plain JS cache
        const invoices     = this.filteredInvoices.map(r => ({ ...r, lines: this._invoiceLines[r.id] || [] }));
        const vendorBills  = this.filteredVendorBills.map(r => ({ ...r, lines: this._vendorLines[r.id] || [] }));
        const transactions = [...this.filteredTransactions];
        const journalBalances = [...this.state.journal_balances];

        this.state.showPrintModal = false;

        const fromLabel = this.state.from_date || 'All';
        const toLabel   = this.state.to_date   || 'All';

        const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .map(l => `<link rel="stylesheet" href="${l.href}">`).join('\n');

        const fmt = (v) => { const n = parseFloat(v); return isNaN(n) ? '0.00' : n.toFixed(2); };

        const totalInvAmount   = invoices.reduce((s,r)     => s + (parseFloat(r.amount)    || 0), 0);
        const totalInvResidual = invoices.reduce((s,r)     => s + (parseFloat(r.residual)  || 0), 0);
        const totalVenAmount   = vendorBills.reduce((s,r)  => s + (parseFloat(r.amount)    || 0), 0);
        const totalVenResidual = vendorBills.reduce((s,r)  => s + (parseFloat(r.residual)  || 0), 0);
        const totalReceived    = transactions.reduce((s,r) => s + (parseFloat(r.received)  || 0), 0);
        const totalPaid        = transactions.reduce((s,r) => s + (parseFloat(r.paid)      || 0), 0);

        // ── Journal Balance table ─────────────────────────────
        const buildJournalTable = (rows) => {
            if (!rows || rows.length === 0)
                return '<p style="color:#888;font-size:11px;margin:4px 0 12px;">No bank / cash journals found.</p>';

            const totOpening  = rows.reduce((s,r) => s + (r.opening  || 0), 0);
            const totDeposit  = rows.reduce((s,r) => s + (r.deposit  || 0), 0);
            const totDepCnt   = rows.reduce((s,r) => s + (r.deposit_count  || 0), 0);
            const totWithdraw = rows.reduce((s,r) => s + (r.withdraw || 0), 0);
            const totWitCnt   = rows.reduce((s,r) => s + (r.withdraw_count || 0), 0);
            const totClosing  = rows.reduce((s,r) => s + (r.closing  || 0), 0);

            const bodyRows = rows.map(r => {
                const closingStyle = r.closing >= 0 ? 'color:#0d6efd' : 'color:#dc3545';
                return `<tr>
                    <td>${r.journal_name || ''}</td>
                    <td style="text-align:right">${fmt(r.opening)}</td>
                    <td style="text-align:right;color:#198754">${fmt(r.deposit)} <span style="color:#6c757d;font-size:9px">(${r.deposit_count || 0})</span></td>
                    <td style="text-align:right;color:#dc3545">${fmt(r.withdraw)} <span style="color:#6c757d;font-size:9px">(${r.withdraw_count || 0})</span></td>
                    <td style="text-align:right;font-weight:bold;${closingStyle}">${fmt(r.closing)}</td>
                </tr>`;
            }).join('');

            return `<table class="jb-table">
                <thead><tr>
                    <th>Journal Name</th>
                    <th style="text-align:right">Opening</th>
                    <th style="text-align:right">Deposit</th>
                    <th style="text-align:right">Withdraw</th>
                    <th style="text-align:right">Closing</th>
                </tr></thead>
                <tbody>${bodyRows}</tbody>
                <tfoot><tr>
                    <td>Total (${rows.length} journals)</td>
                    <td style="text-align:right">${fmt(totOpening)}</td>
                    <td style="text-align:right;color:#198754">${fmt(totDeposit)} <span style="color:#6c757d;font-size:9px">(${totDepCnt})</span></td>
                    <td style="text-align:right;color:#dc3545">${fmt(totWithdraw)} <span style="color:#6c757d;font-size:9px">(${totWitCnt})</span></td>
                    <td style="text-align:right;color:#0d6efd">${fmt(totClosing)}</td>
                </tr></tfoot>
            </table>`;
        };

        // ── Invoice / Vendor Bill table ───────────────────────
        // Renders each move as a header row; when includeLines=true,
        // a sub-table with product lines appears directly below (matching Image 2 style).
        const buildMoveTable = (records, includeLines) => {
            if (!records || records.length === 0)
                return '<p style="color:#888;font-size:11px;margin:4px 0 12px;">No records found.</p>';

            let html = `<table class="detail-table">
                <thead><tr>
                    <th>Invoice</th><th>Partner</th><th>Date</th>
                    <th>Due Date</th><th style="text-align:right">Amount</th>
                    <th style="text-align:right">Outstanding</th><th>Status</th>
                </tr></thead>
                <tbody>`;

            for (const r of records) {
                html += `<tr class="move-header">
                    <td>${r.name || ''}</td>
                    <td>${r.partner || ''}</td>
                    <td>${r.date || ''}</td>
                    <td>${r.due_date || ''}</td>
                    <td style="text-align:right">${fmt(r.amount)}</td>
                    <td style="text-align:right">${fmt(r.residual)}</td>
                    <td>${r.state || ''}</td>
                </tr>`;

                if (includeLines && r.lines && r.lines.length > 0) {
                    // Product lines sub-table, indented under the invoice row
                    const lineRows = r.lines.map(l => `<tr class="line-row">
                        <td>${l.product || ''}</td>
                        <td style="text-align:right">${fmt(l.qty)}</td>
                        <td style="text-align:right">${fmt(l.price_unit)}</td>
                        <td style="text-align:right">${fmt(l.discount)}</td>
                        <td>${l.tax || ''}</td>
                        <td style="text-align:right">${fmt(l.subtotal)}</td>
                    </tr>`).join('');

                    html += `<tr><td colspan="7" style="padding:0 0 8px 28px;border-bottom:none;">
                        <table class="lines-table">
                            <thead><tr>
                                <th>Product Name</th><th style="text-align:right">Qty</th>
                                <th style="text-align:right">Rate</th><th style="text-align:right">Discount</th>
                                <th>Tax</th><th style="text-align:right">Total</th>
                            </tr></thead>
                            <tbody>${lineRows}</tbody>
                        </table>
                    </td></tr>`;
                }
            }

            html += '</tbody></table>';
            return html;
        };

        // ── Transactions flat table (always printed) ──────────
        const buildTxTable = (rows) => {
            if (!rows || rows.length === 0)
                return '<p style="color:#888;font-size:11px;margin:4px 0 12px;">No records found.</p>';
            const txRows = rows.map(r => [r.name, r.partner, r.date, r.journal, r.type, fmt(r.received), fmt(r.paid), r.state]);
            const headers = ['Reference','Partner','Date','Journal','Type','Received','Paid','Status'];
            const ths = headers.map(h => `<th>${h}</th>`).join('');
            const trs = txRows.map(r => `<tr>${r.map(c => `<td>${c != null ? c : ''}</td>`).join('')}</tr>`).join('');
            return `<table class="detail-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
        };

        const invoiceDetail       = buildMoveTable(invoices, includeInvLines);
        const vendorDetail        = buildMoveTable(vendorBills, includeVendorLines);
        const txDetail            = buildTxTable(transactions);
        const journalTableHtml    = includeJournalBalance ? buildJournalTable(journalBalances) : '';
        const journalSectionHtml  = includeJournalBalance
            ? `<h2>Journal Balance (${journalBalances.length} journals)</h2>${journalTableHtml}`
            : '';

        const printWin = window.open('', '_blank', 'width=1200,height=800');
        printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Finance Dashboard</title>
  ${styleLinks}
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; font-family: sans-serif; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .period { font-size: 11px; color: #555; margin-bottom: 12px; }
    h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 2px solid #333; padding-bottom: 2px; }
    .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .summary-table th, .summary-table td { padding: 4px 8px; border: 1px solid #ccc; font-size: 12px; }
    .summary-table th { background: #f0f0f0; }
    /* Journal balance */
    .jb-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11px; }
    .jb-table th { background: #222; color: #fff; padding: 4px 8px; border: 1px solid #444; text-align: left; }
    .jb-table td { padding: 4px 8px; border: 1px solid #ccc; vertical-align: middle; }
    .jb-table tbody tr:nth-child(even) td { background: #f8f8f8; }
    .jb-table tfoot td { background: #e8e8e8; font-weight: bold; border-top: 2px solid #555; }
    /* Invoice / vendor bill table */
    .detail-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; }
    .detail-table th { background: #f0f0f0; padding: 3px 6px; border: 1px solid #ccc; text-align: left; }
    .detail-table td { padding: 3px 6px; border: 1px solid #ddd; vertical-align: top; }
    .move-header td { background: #fafafa; font-weight: 500; }
    /* Product lines sub-table */
    .lines-table { width: 100%; border-collapse: collapse; font-size: 9px; margin: 2px 0 4px; }
    .lines-table th { background: #e8f0fe; padding: 2px 5px; border: 1px solid #c5d5f5; text-align: left; }
    .lines-table td { padding: 2px 5px; border: 1px solid #dde5f8; }
    .lines-table tbody tr:nth-child(even) td { background: #f5f8ff; }
    /* Summary conclusion */
    .conclusion-table { border-collapse: collapse; margin: 10px 0 18px; min-width: 420px; }
    .conclusion-table th, .conclusion-table td { padding: 5px 12px; border: 1px solid #999; font-size: 12px; }
    .conclusion-table thead tr { background: #e8e8e8; font-weight: bold; }
    .conclusion-table tbody tr:nth-child(odd) { background: #f9f9f9; }
    .conclusion-table tbody td:first-child { font-weight: 600; }
    tr { page-break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
    @media print {
      @page { margin: 10mm; size: A4 landscape; }
      body { font-size: 10px; padding: 0; }
    }
  </style>
</head>
<body>
  <h1>Finance Dashboard</h1>
  <div class="period">Period: ${fromLabel} &mdash; ${toLabel}</div>

  <table class="conclusion-table">
    <thead>
      <tr><th></th><th style="text-align:right">Debt</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr>
    </thead>
    <tbody>
      <tr><td>Invoice Total</td><td style="text-align:right">${fmt(totalInvAmount)}</td><td style="text-align:right">0.00</td><td style="text-align:right">${fmt(totalInvAmount)}</td></tr>
      <tr><td>Vendor Bill Total</td><td style="text-align:right">0.00</td><td style="text-align:right">${fmt(totalVenAmount)}</td><td style="text-align:right">${fmt(totalVenAmount)}</td></tr>
      <tr><td>Transaction</td><td style="text-align:right">${fmt(totalReceived)}</td><td style="text-align:right">${fmt(totalPaid)}</td><td style="text-align:right">${fmt(totalReceived - totalPaid)}</td></tr>
    </tbody>
  </table>

  ${journalSectionHtml}

  <h2>Invoices (${invoices.length} records)</h2>
  <table class="summary-table">
    <thead><tr><th>Section</th><th style="text-align:right">Total Amount</th><th style="text-align:right">Outstanding</th></tr></thead>
    <tbody><tr><td>Invoices</td><td style="text-align:right">${fmt(totalInvAmount)}</td><td style="text-align:right">${fmt(totalInvResidual)}</td></tr></tbody>
  </table>
  ${invoiceDetail}

  <h2>Vendor Bills (${vendorBills.length} records)</h2>
  <table class="summary-table">
    <thead><tr><th>Section</th><th style="text-align:right">Total Amount</th><th style="text-align:right">Outstanding</th></tr></thead>
    <tbody><tr><td>Vendor Bills</td><td style="text-align:right">${fmt(totalVenAmount)}</td><td style="text-align:right">${fmt(totalVenResidual)}</td></tr></tbody>
  </table>
  ${vendorDetail}

  <h2>Transactions (${transactions.length} records)</h2>
  <table class="summary-table">
    <thead><tr><th>Section</th><th style="text-align:right">Total Received</th><th style="text-align:right">Total Paid</th></tr></thead>
    <tbody><tr><td>Transactions</td><td style="text-align:right">${fmt(totalReceived)}</td><td style="text-align:right">${fmt(totalPaid)}</td></tr></tbody>
  </table>
  ${txDetail}
</body>
</html>`);
        printWin.document.close();
        printWin.onload = () => { printWin.focus(); printWin.print(); printWin.close(); };
        setTimeout(() => { try { printWin.focus(); printWin.print(); printWin.close(); } catch(e) {} }, 1800);
    }

    // ── Navigation ────────────────────────────────────────────
    openInvoice(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "account.move", res_id: id, views: [[false, "form"]], target: "new" });
    }
    openTransaction(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "account.payment", res_id: id, views: [[false, "form"]], target: "new" });
    }
    openPartner(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "res.partner", res_id: id, views: [[false, "form"]], target: "new" });
    }
}

FinanceDashboard.template = "advanced_business_dashboard.finance_dashboard";
registry.category("actions").add("finance_dashboard_tag", FinanceDashboard);
