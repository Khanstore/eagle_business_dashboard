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
            from_date: this._fmt(new Date(now.getFullYear(), now.getMonth(), 1)),
            to_date: this._fmt(now),
            partner_filter: '',
            active_preset: 'this_month',
            selected_month: this.monthOptions[0].value,
            selected_year: String(now.getFullYear()),
            sortKey: '',
            sortOrder: 'asc',
        });

        onWillStart(async () => {
            await this.loadData();
        });
    }

    // ── Helpers ──────────────────────────────────────────────
    _fmt(date) {
        return date.toISOString().split('T')[0];
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
            this.state.quotations    = data.quotations    || [];
            this.state.orders        = data.orders        || [];
            this.state.purchases     = data.purchases     || [];
            this.state.rfq           = data.rfq           || [];
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

    // ── Print ─────────────────────────────────────────────────
    printDashboard() {
        // Find the dashboard container node
        const container = this.__owl__.bdom && this.__owl__.bdom.el
            ? this.__owl__.bdom.el
            : document.querySelector('.o_action_manager .container');

        if (!container) {
            console.error('Dashboard: could not find container to print.');
            return;
        }

        // Clone the content so we can strip non-print elements
        const clone = container.cloneNode(true);
        clone.querySelectorAll('.d-print-none, button, input, select').forEach(el => el.remove());

        // Copy Bootstrap and FontAwesome stylesheets from the host page
        const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .map(l => `<link rel="stylesheet" href="${l.href}">`)
            .join('\n');

        const printWin = window.open('', '_blank', 'width=1200,height=800');
        printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Business Dashboard</title>
  ${styleLinks}
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: sans-serif;
      font-size: 12px;
    }
    .container {
      max-height: none !important;
      overflow: visible !important;
      width: 100% !important;
      max-width: 100% !important;
      padding: 0 !important;
    }
    /* Make the two-column rows use full width with equal halves */
    .row { display: flex; flex-wrap: nowrap; gap: 12px; margin-bottom: 8px; }
    .col-6 { flex: 1 1 0; min-width: 0; overflow: hidden; }
    /* Compact tables */
    table { width: 100%; font-size: 11px; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 3px 5px; border: 1px solid #ccc; word-break: break-word; overflow: hidden; }
    h2 { font-size: 16px; margin: 0 0 8px; }
    h3 { font-size: 13px; margin: 0 0 4px; }
    a { color: inherit !important; text-decoration: none !important; }
    tr { page-break-inside: avoid; }
    /* Scale entire body to fit A4/letter width */
    @media print {
      @page { margin: 10mm; size: A4 landscape; }
      body { font-size: 10px; padding: 0; }
      table { font-size: 9px; }
      th, td { padding: 2px 4px; }
    }
  </style>
</head>
<body>${clone.outerHTML}</body>
</html>`);
        printWin.document.close();

        printWin.onload = () => {
            printWin.focus();
            printWin.print();
            printWin.close();
        };

        // Fallback
        setTimeout(() => {
            try { printWin.focus(); printWin.print(); printWin.close(); }
            catch(e) { /* already closed */ }
        }, 1800);
    }

    // ── Navigation ────────────────────────────────────────────
    openOrder(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "sale.order", res_id: id, views: [[false, "form"]], target: "new" });
    }
    openPurchase(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "purchase.order", res_id: id, views: [[false, "form"]], target: "new" });
    }
    openTransaction(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "account.payment", res_id: id, views: [[false, "form"]], target: "new" });
    }
    openPartner(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "res.partner", res_id: id, views: [[false, "form"]], target: "new" });
    }
}

Dashboard.template = "advanced_business_dashboard.dashboard";
registry.category("actions").add("advanced_dashboard_tag", Dashboard);