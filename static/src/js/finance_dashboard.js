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

        this.state = useState({
            invoices:      [],
            vendor_bills:  [],
            transactions:  [],
            from_date:     this._fmt(new Date(now.getFullYear(), now.getMonth(), 1)),
            to_date:       this._fmt(now),
            partner_filter: '',
            active_preset:  'this_month',
            selected_month: this.monthOptions[0].value,
            selected_year:  String(now.getFullYear()),
            sortKey:   '',
            sortOrder: 'asc',
            partner_id_filter: '',
            partnerOptions: [],
            // Print modal
            showPrintModal: false,
            printDetails: true,
            printInvoiceLines: false,
            printVendorLines: false,
        });

        // Store lines outside OWL state — reactive proxy strips nested arrays
        this._invoiceLines = {};   // { id: [...lines] }
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
            const data = await this.orm.call(
                "dashboard.data", "get_finance_dashboard",
                [this.state.from_date || false, this.state.to_date || false]
            );
            // Cache lines in plain JS objects (outside OWL proxy)
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
            this.state.invoices     = invoices;
            this.state.vendor_bills = vendorBills;
            this.state.transactions = data.transactions || [];

            // Build unique partner list from all records for the dropdown
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
        const q = this.state.partner_filter.trim().toLowerCase();
        const pid = this.state.partner_id_filter;
        const nameOk = !q || (r.partner || '').toLowerCase().includes(q);
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

    get invoiceTotalAmount()   { return this._sum(this.filteredInvoices,    'amount'); }
    get invoiceTotalResidual() { return this._sum(this.filteredInvoices,    'residual'); }
    get vendorTotalAmount()    { return this._sum(this.filteredVendorBills, 'amount'); }
    get vendorTotalResidual()  { return this._sum(this.filteredVendorBills, 'residual'); }
    get txTotalReceived()      { return this._sum(this.filteredTransactions, 'received'); }
    get txTotalPaid()          { return this._sum(this.filteredTransactions, 'paid'); }

    // ── Print modal ───────────────────────────────────────────
    openPrintModal() { this.state.showPrintModal = true; }
    closePrintModal() { this.state.showPrintModal = false; }

doPrint() {
        // Snapshot everything BEFORE touching state — OWL reactive proxy
        // can trigger re-render and lose lines data if state changes first
        const includeTxDetails   = this.state.printDetails;
        const includeInvLines    = this.state.printInvoiceLines;
        const includeVendorLines = this.state.printVendorLines;

        // Deep-copy state data and reattach lines from the plain JS cache
        const invoices = this.filteredInvoices.map(r => ({
            ...r, lines: this._invoiceLines[r.id] || []
        }));
        const vendorBills = this.filteredVendorBills.map(r => ({
            ...r, lines: this._vendorLines[r.id] || []
        }));
        const transactions = [...this.filteredTransactions];

        // Close modal after snapshot
        this.state.showPrintModal = false;

        const fromLabel = this.state.from_date || 'All';
        const toLabel   = this.state.to_date   || 'All';

        const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .map(l => `<link rel="stylesheet" href="${l.href}">`).join('\n');

        const fmt = (v) => { const n = parseFloat(v); return isNaN(n) ? '0.00' : n.toFixed(2); };

        const totalInvAmount   = invoices.reduce((s,r) => s + (parseFloat(r.amount)    || 0), 0);
        const totalInvResidual = invoices.reduce((s,r) => s + (parseFloat(r.residual)  || 0), 0);
        const totalVenAmount   = vendorBills.reduce((s,r) => s + (parseFloat(r.amount)   || 0), 0);
        const totalVenResidual = vendorBills.reduce((s,r) => s + (parseFloat(r.residual) || 0), 0);
        const totalReceived    = transactions.reduce((s,r) => s + (parseFloat(r.received) || 0), 0);
        const totalPaid        = transactions.reduce((s,r) => s + (parseFloat(r.paid)     || 0), 0);

        // Simple flat table (used for transactions)
        const buildFlatTable = (headers, rows) => {
            if (!rows || rows.length === 0) return '<p style="color:#888;font-size:11px;margin:4px 0 12px;">No records found.</p>';
            const ths = headers.map(h => `<th>${h}</th>`).join('');
            const trs = rows.map(r => `<tr>${r.map(c => `<td>${c != null ? c : ''}</td>`).join('')}</tr>`).join('');
            return `<table class="detail-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
        };

        // Renders each move as a header row + optional indented lines sub-table
        const buildMoveTable = (records, headerCols, includeLines) => {
            if (!records || records.length === 0)
                return '<p style="color:#888;font-size:11px;margin:4px 0 12px;">No records found.</p>';

            const lineHeaders = ['Product', 'Description', 'Qty', 'UoM', 'Unit Price', 'Disc%', 'Taxes', 'Subtotal'];
            const colCount = headerCols.length;

            let rows = '';
            for (const r of records) {
                // Main invoice/bill row
                const cells = headerCols.map(col => `<td>${r[col] != null ? r[col] : ''}</td>`).join('');
                rows += `<tr class="move-header">${cells}</tr>`;

                // Lines sub-table if toggled on
                if (includeLines && r.lines && r.lines.length > 0) {
                    const linesHtml = r.lines.map(l => `
                        <tr class="line-row">
                            <td>${l.product || ''}</td>
                            <td>${l.description || ''}</td>
                            <td style="text-align:right">${fmt(l.qty)}</td>
                            <td>${l.uom || ''}</td>
                            <td style="text-align:right">${fmt(l.price_unit)}</td>
                            <td style="text-align:right">${fmt(l.discount)}</td>
                            <td>${l.tax || ''}</td>
                            <td style="text-align:right">${fmt(l.subtotal)}</td>
                        </tr>`).join('');
                    rows += `<tr><td colspan="${colCount}" style="padding:0 0 6px 24px;">
                        <table class="lines-table">
                            <thead><tr>${lineHeaders.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
                            <tbody>${linesHtml}</tbody>
                        </table>
                    </td></tr>`;
                }
            }

            const ths = headerCols.map(col => {
                const label = {name:'Reference', partner:'Partner', date:'Date',
                    due_date:'Due Date', amount:'Amount', residual:'Balance', state:'Status'}[col] || col;
                return `<th>${label}</th>`;
            }).join('');

            return `<table class="detail-table">
                <thead><tr>${ths}</tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        };

        const invCols    = ['name','partner','date','due_date','amount','residual','state'];
        const invoiceDetail = buildMoveTable(invoices, invCols, includeInvLines);
        const vendorDetail  = buildMoveTable(vendorBills, invCols, includeVendorLines);
        const txRows        = transactions.map(r => [r.name, r.partner, r.date, r.journal, r.type, fmt(r.received), fmt(r.paid), r.state]);
        const txDetail      = includeTxDetails
            ? buildFlatTable(['Reference','Partner','Date','Journal','Type','Received','Paid','Status'], txRows)
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
    .detail-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; }
    .detail-table th { background: #f0f0f0; padding: 3px 6px; border: 1px solid #ccc; text-align: left; }
    .detail-table td { padding: 3px 6px; border: 1px solid #ddd; vertical-align: top; }
    .move-header td { background: #fafafa; font-weight: 500; }
    .lines-table { width: 100%; border-collapse: collapse; font-size: 9px; margin: 2px 0; }
    .lines-table th { background: #e8f0fe; padding: 2px 5px; border: 1px solid #c5d5f5; text-align: left; }
    .lines-table td { padding: 2px 5px; border: 1px solid #dde5f8; }
    .lines-table tr:nth-child(even) td { background: #f5f8ff; }
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
