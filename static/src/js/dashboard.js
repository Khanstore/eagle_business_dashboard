/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onWillStart, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class Dashboard extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        const now = new Date();

        // Build month options list (current month + 11 previous)
        this.monthOptions = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            this.monthOptions.push({
                value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                label: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
            });
        }

        // Year options: current year and 4 previous
        this.yearOptions = [];
        for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) {
            this.yearOptions.push(y);
        }

        this.state = useState({
            quotations: [],
            orders: [],
            purchases: [],
            rfq: [],
            transactions: [],
            from_date: this._fmt(now),
            to_date: this._fmt(now),
            partner_filter: '',
            active_preset: 'today',
            selected_month: this.monthOptions[0].value,
            selected_year: String(now.getFullYear()),
            sortKey: '',
            sortOrder: 'asc',
            // Print modal
            showPrintModal:    false,
            printOrderLines:   false,
            printPurchaseLines: false,
            printTxDetails:    true,
        });

        // Lines cached outside OWL state (reactive proxy strips nested arrays)
        this._orderLines    = {};  // sale.order id -> [...lines]   (Orders + Quotations)
        this._purchaseLines = {};  // purchase.order id -> [...lines] (Purchase + RFQ)

        onWillStart(async () => {
            await this.loadData();
        });
    }

    // ── Helpers ──────────────────────────────────────────────
    _fmt(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    _setDates(from, to, preset = 'custom') {
        this.state.from_date = this._fmt(from);
        this.state.to_date   = this._fmt(to);
        this.state.active_preset = preset;
        this.loadData();
    }

    // ── Preset buttons ────────────────────────────────────────
    applyPreset(preset) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const d = now.getDate();

        switch (preset) {
            case 'today':
                this._setDates(now, now, preset);
                break;
            case 'this_week': {
                const day = now.getDay(); // 0=Sun
                const mon = new Date(y, m, d - ((day + 6) % 7));
                const sun = new Date(y, m, d + (7 - ((day + 6) % 7)) % 7);
                this._setDates(mon, sun, preset);
                break;
            }
            case 'this_month':
                this._setDates(new Date(y, m, 1), new Date(y, m + 1, 0), preset);
                break;
            case 'this_year':
                this._setDates(new Date(y, 0, 1), new Date(y, 11, 31), preset);
                break;
            case 'all':
                this.state.from_date = '';
                this.state.to_date   = '';
                this.state.active_preset = 'all';
                this.loadData();
                break;
        }
    }

    // ── Month picker ──────────────────────────────────────────
    onMonthChange(ev) {
        const [y, m] = ev.target.value.split('-').map(Number);
        this.state.selected_month = ev.target.value;
        this._setDates(new Date(y, m - 1, 1), new Date(y, m, 0), 'custom');
    }

    // ── Year picker ───────────────────────────────────────────
    onYearChange(ev) {
        const y = Number(ev.target.value);
        this.state.selected_year = ev.target.value;
        this._setDates(new Date(y, 0, 1), new Date(y, 11, 31), 'custom');
    }

    // ── Custom date inputs ────────────────────────────────────
    onDateChange() {
        if (this.state.from_date && this.state.to_date) {
            this.state.active_preset = 'custom';
            this.loadData();
        }
    }

    // ── Data loading ──────────────────────────────────────────
    async loadData() {
        try {
            const data = await this.orm.call(
                "dashboard.data",
                "get_dashboard",
                [this.state.from_date || false, this.state.to_date || false]
            );

            this._orderLines    = {};
            this._purchaseLines = {};

            const quotations = (data.quotations || []).map(r => {
                this._orderLines[r.id] = r.lines || [];
                const { lines, ...rest } = r;
                return rest;
            });
            const orders = (data.orders || []).map(r => {
                this._orderLines[r.id] = r.lines || [];
                const { lines, ...rest } = r;
                return rest;
            });
            const purchases = (data.purchases || []).map(r => {
                this._purchaseLines[r.id] = r.lines || [];
                const { lines, ...rest } = r;
                return rest;
            });
            const rfq = (data.rfq || []).map(r => {
                this._purchaseLines[r.id] = r.lines || [];
                const { lines, ...rest } = r;
                return rest;
            });

            this.state.quotations    = quotations;
            this.state.orders        = orders;
            this.state.purchases     = purchases;
            this.state.rfq           = rfq;
            this.state.transactions  = data.transactions  || [];

            if (this.state.sortKey) this._applySort();
        } catch (error) {
            console.error("Dashboard failed to load data:", error);
        }
    }

    // ── Partner filter ────────────────────────────────────────
    _matchesPartner(record) {
        const q = this.state.partner_filter.trim().toLowerCase();
        return !q || (record.partner || '').toLowerCase().includes(q);
    }
    get filteredOrders()       { return this.state.orders.filter(r => this._matchesPartner(r)); }
    get filteredPurchases()    { return this.state.purchases.filter(r => this._matchesPartner(r)); }
    get filteredQuotations()   { return this.state.quotations.filter(r => this._matchesPartner(r)); }
    get filteredRfq()          { return this.state.rfq.filter(r => this._matchesPartner(r)); }
    get filteredTransactions() { return this.state.transactions.filter(r => this._matchesPartner(r)); }

    // ── Sorting ───────────────────────────────────────────────
    sortTransactions(key) {
        if (this.state.sortKey === key) {
            this.state.sortOrder = this.state.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.state.sortKey = key;
            this.state.sortOrder = 'asc';
        }
        this._applySort();
    }

    _applySort() {
        const key = this.state.sortKey;
        const order = this.state.sortOrder === 'asc' ? 1 : -1;
        this.state.transactions.sort((a, b) => {
            let valA = a[key] ?? '', valB = b[key] ?? '';
            if (typeof valA === 'number' && typeof valB === 'number') return (valA - valB) * order;
            return valA.toString().localeCompare(valB.toString()) * order;
        });
    }

    // ── Totals ────────────────────────────────────────────────
    get txTotalReceived() {
        return this.filteredTransactions.reduce((s, r) => s + (parseFloat(r.received) || 0), 0).toFixed(2);
    }
    get txTotalPaid() {
        return this.filteredTransactions.reduce((s, r) => s + (parseFloat(r.paid) || 0), 0).toFixed(2);
    }

    // ── Show the Date column only when the selected range spans more than
    //    a single day (e.g. hidden for "Today", shown for week/month/year/all/custom) ──
    get showDateColumn() {
        const { from_date, to_date } = this.state;
        return !(from_date && to_date && from_date === to_date);
    }

    // ── Print modal ───────────────────────────────────────────
    openPrintModal()  { this.state.showPrintModal = true; }
    closePrintModal() { this.state.showPrintModal = false; }

    doPrint() {
        // Snapshot toggles + data before closing the modal
        const includeOrderLines    = this.state.printOrderLines;
        const includePurchaseLines = this.state.printPurchaseLines;
        const includeTxDetails     = this.state.printTxDetails;

        const quotations  = this.filteredQuotations.map(r => ({ ...r, lines: this._orderLines[r.id] || [] }));
        const orders      = this.filteredOrders.map(r => ({ ...r, lines: this._orderLines[r.id] || [] }));
        const purchases   = this.filteredPurchases.map(r => ({ ...r, lines: this._purchaseLines[r.id] || [] }));
        const rfq         = this.filteredRfq.map(r => ({ ...r, lines: this._purchaseLines[r.id] || [] }));
        const transactions = [...this.filteredTransactions];

        this.state.showPrintModal = false;

        const fromLabel = this.state.from_date || 'All';
        const toLabel   = this.state.to_date   || 'All';

        const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .map(l => `<link rel="stylesheet" href="${l.href}">`).join('\n');

        const fmt = (v) => { const n = parseFloat(v); return isNaN(n) ? '0.00' : n.toFixed(2); };

        const totalOrders    = orders.reduce((s, r)    => s + (parseFloat(r.amount) || 0), 0);
        const totalPurchases = purchases.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
        const totalQuotes    = quotations.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
        const totalRfq       = rfq.reduce((s, r)       => s + (parseFloat(r.amount) || 0), 0);
        const totalReceived  = transactions.reduce((s, r) => s + (parseFloat(r.received) || 0), 0);
        const totalPaid      = transactions.reduce((s, r) => s + (parseFloat(r.paid) || 0), 0);

        // ── Generic order/purchase table with optional product-lines sub-table ──
        const buildOrderTable = (records, includeLines, extraCol) => {
            if (!records || records.length === 0)
                return '<p style="color:#888;font-size:11px;margin:4px 0 12px;">No records found.</p>';

            const extraHeader = extraCol ? `<th>${extraCol.label}</th>` : '';
            let html = `<table class="detail-table">
                <thead><tr>
                    <th>Reference</th><th>Partner</th><th>Date</th><th>Status</th>${extraHeader}<th style="text-align:right">Amount</th>
                </tr></thead>
                <tbody>`;

            for (const r of records) {
                const extraCell = extraCol ? `<td>${r[extraCol.field] || ''}</td>` : '';
                const colCount  = extraCol ? 6 : 5;
                html += `<tr class="move-header">
                    <td>${r.name || ''}</td>
                    <td>${r.partner || ''}</td>
                    <td>${r.date || ''}</td>
                    <td>${r.status || ''}</td>
                    ${extraCell}
                    <td style="text-align:right">${fmt(r.amount)}</td>
                </tr>`;

                if (includeLines && r.lines && r.lines.length > 0) {
                    const lineRows = r.lines.map(l => `<tr class="line-row">
                        <td>${l.product || ''}</td>
                        <td style="text-align:right">${fmt(l.qty)}</td>
                        <td style="text-align:right">${fmt(l.price_unit)}</td>
                        <td style="text-align:right">${fmt(l.discount)}</td>
                        <td>${l.tax || ''}</td>
                        <td style="text-align:right">${fmt(l.subtotal)}</td>
                    </tr>`).join('');

                    html += `<tr><td colspan="${colCount}" style="padding:0 0 8px 28px;border-bottom:none;">
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

        // ── Transactions table — Received in blue, Paid in red ──
        const buildTxTable = (rows) => {
            if (!rows || rows.length === 0)
                return '<p style="color:#888;font-size:11px;margin:4px 0 12px;">No records found.</p>';
            const trs = rows.map(r => `<tr>
                <td>${r.name || ''}</td>
                <td>${r.partner || ''}</td>
                <td>${r.date || ''}</td>
                <td>${r.ledger || ''}</td>
                <td style="text-align:right;color:#0d6efd">${fmt(r.received)}</td>
                <td style="text-align:right;color:#dc3545">${fmt(r.paid)}</td>
                <td>${r.state || ''}</td>
            </tr>`).join('');
            return `<table class="detail-table">
                <thead><tr>
                    <th>Name</th><th>Partner</th><th>Date</th><th>Ledger</th>
                    <th style="text-align:right">Received</th><th style="text-align:right">Paid</th><th>Status</th>
                </tr></thead>
                <tbody>${trs}</tbody>
            </table>`;
        };

        const quotationsHtml = buildOrderTable(quotations, includeOrderLines);
        const ordersHtml     = buildOrderTable(orders, includeOrderLines, { label: 'Invoice Status', field: 'invoice_status' });
        const purchasesHtml  = buildOrderTable(purchases, includePurchaseLines, { label: 'Billing Status', field: 'billing_status' });
        const rfqHtml        = buildOrderTable(rfq, includePurchaseLines);

        const txSectionHtml = includeTxDetails
            ? `<h2>Transactions (${transactions.length} records)</h2>
               <table class="summary-table">
                 <thead><tr><th>Section</th><th style="text-align:right">Total Received</th><th style="text-align:right">Total Paid</th></tr></thead>
                 <tbody><tr><td>Transactions</td>
                   <td style="text-align:right;color:#0d6efd">${fmt(totalReceived)}</td>
                   <td style="text-align:right;color:#dc3545">${fmt(totalPaid)}</td>
                 </tr></tbody>
               </table>
               ${buildTxTable(transactions)}`
            : '';

        const printWin = window.open('', '_blank', 'width=1200,height=800');
        printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Business Dashboard</title>
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
    .conclusion-table { border-collapse: collapse; margin: 10px 0 18px; min-width: 420px; }
    .conclusion-table th, .conclusion-table td { padding: 5px 12px; border: 1px solid #999; font-size: 12px; }
    .conclusion-table thead tr { background: #e8e8e8; font-weight: bold; }
    .conclusion-table tbody tr:nth-child(odd) { background: #f9f9f9; }
    .conclusion-table tbody td:first-child { font-weight: 600; }
    .detail-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; }
    .detail-table th { background: #f0f0f0; padding: 3px 6px; border: 1px solid #ccc; text-align: left; }
    .detail-table td { padding: 3px 6px; border: 1px solid #ddd; vertical-align: top; }
    .move-header td { background: #fafafa; font-weight: 500; }
    .lines-table { width: 100%; border-collapse: collapse; font-size: 9px; margin: 2px 0 4px; }
    .lines-table th { background: #e8f0fe; padding: 2px 5px; border: 1px solid #c5d5f5; text-align: left; }
    .lines-table td { padding: 2px 5px; border: 1px solid #dde5f8; }
    .lines-table tbody tr:nth-child(even) td { background: #f5f8ff; }
    tr { page-break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
    @media print {
      @page { margin: 10mm; size: A4 landscape; }
      body { font-size: 10px; padding: 0; }
    }
  </style>
</head>
<body>
  <h1>Business Dashboard</h1>
  <div class="period">Period: ${fromLabel} &mdash; ${toLabel}</div>

  <table class="conclusion-table">
    <thead><tr><th>Section</th><th style="text-align:right">Records</th><th style="text-align:right">Total Amount</th></tr></thead>
    <tbody>
      <tr><td>Quotations</td><td style="text-align:right">${quotations.length}</td><td style="text-align:right">${fmt(totalQuotes)}</td></tr>
      <tr><td>Orders</td><td style="text-align:right">${orders.length}</td><td style="text-align:right">${fmt(totalOrders)}</td></tr>
      <tr><td>Purchase</td><td style="text-align:right">${purchases.length}</td><td style="text-align:right">${fmt(totalPurchases)}</td></tr>
      <tr><td>RFQ</td><td style="text-align:right">${rfq.length}</td><td style="text-align:right">${fmt(totalRfq)}</td></tr>
    </tbody>
  </table>

  <h2>Orders (${orders.length} records)</h2>
  ${ordersHtml}

  <h2>Purchase (${purchases.length} records)</h2>
  ${purchasesHtml}

  <h2>Quotations (${quotations.length} records)</h2>
  ${quotationsHtml}

  <h2>RFQ (${rfq.length} records)</h2>
  ${rfqHtml}

  ${txSectionHtml}
</body>
</html>`);
        printWin.document.close();
        printWin.onload = () => { printWin.focus(); printWin.print(); printWin.close(); };
        setTimeout(() => { try { printWin.focus(); printWin.print(); printWin.close(); } catch(e) {} }, 1800);
    }

    // ── Navigation ────────────────────────────────────────────
    openOrder(id) {
        this.action.doAction(
            { type: "ir.actions.act_window", res_model: "sale.order", res_id: id, views: [[false, "form"]], target: "new" },
            { onClose: () => this.loadData() }
        );
    }
    openPurchase(id) {
        this.action.doAction(
            { type: "ir.actions.act_window", res_model: "purchase.order", res_id: id, views: [[false, "form"]], target: "new" },
            { onClose: () => this.loadData() }
        );
    }
    createOrder() {
        this.action.doAction(
            { type: "ir.actions.act_window", res_model: "sale.order", views: [[false, "form"]], target: "new" },
            { onClose: () => this.loadData() }
        );
    }
    createPurchase() {
        this.action.doAction(
            { type: "ir.actions.act_window", res_model: "purchase.order", views: [[false, "form"]], target: "new" },
            { onClose: () => this.loadData() }
        );
    }
    // payment_type: 'inbound' (Receive Money) | 'outbound' (Make Payment)
    createPayment(paymentType) {
        this.action.doAction(
            {
                type: "ir.actions.act_window",
                res_model: "account.payment",
                views: [[false, "form"]],
                target: "new",
                context: {
                    default_payment_type: paymentType,
                    default_partner_type: paymentType === 'inbound' ? 'customer' : 'supplier',
                },
            },
            { onClose: () => this.loadData() }
        );
    }
    openTransaction(id) {
        this.action.doAction(
            { type: "ir.actions.act_window", res_model: "account.payment", res_id: id, views: [[false, "form"]], target: "new" },
            { onClose: () => this.loadData() }
        );
    }
    openPartner(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "res.partner", res_id: id, views: [[false, "form"]], target: "new" });
    }
}

Dashboard.template = "advanced_business_dashboard.dashboard";
registry.category("actions").add("advanced_dashboard_tag", Dashboard);
