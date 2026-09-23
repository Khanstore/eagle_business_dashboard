/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, onWillStart, onMounted, onWillDestroy, onPatched, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { enhanceEagleTables } from "./table_tools";
import { sharedFilterState } from "./shared_filter_state";
import { EagleQuickSaleDialog } from "./quick_sale_dialog";

class OperationsDashboard extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        const now = new Date();
        this.monthOptions = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            this.monthOptions.push({
                value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
                label: d.toLocaleString("default", { month: "long", year: "numeric" }),
            });
        }
        this.yearOptions = [];
        for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) this.yearOptions.push(y);

        this.state = useState({
            orders: [], quotations: [], purchases: [], rfq: [], transactions: [],
            dataTotals: {orders:0, quotations:0, purchases:0, rfq:0, transactions:0},
            dataPageLimits: {orders:100, purchases:100, transactions:200, lines:30},
            partnerOptions: [],
            from_date: sharedFilterState.from_date,
            to_date: sharedFilterState.to_date,
            partner_filter: sharedFilterState.partner_filter,
            active_preset: sharedFilterState.active_preset,
            selected_month: sharedFilterState.selected_month,
            selected_year: sharedFilterState.selected_year,
            statusFilter: "",
            showPrintModal: false,
            printOrderLines: true,
            printPurchaseLines: false,
            printTransactions: true,
            companyName: "", companyId: 0,
            darkMode: false,
            onlineUsers: [],
            themeColor: "#4f5bd5",
            tableOpen: {
                orders: false,
                quotations: false,
                purchases: false,
                rfq: false,
                transactions: false,
            },
            loading: true,
            error: "",
        });

        try { this.state.darkMode = localStorage.getItem("eagle_dark_mode") === "1"; } catch (e) {}
        this._quickSaleDialog = null;

        onWillStart(async () => {
            await this.loadAll();
            try { this.state.themeColor = await this.orm.call("dashboard.data", "get_theme_color", []); } catch (e) {}
        });
        onMounted(() => {
            this._keydownHandler = (ev) => this._onKeyDown(ev);
            window.addEventListener("keydown", this._keydownHandler);
            this._heartbeatTimer = setInterval(() => this.heartbeatNow(), 30000);
            this.heartbeatNow();
            enhanceEagleTables(this.el, "operation");
        });
        onPatched(() => { enhanceEagleTables(this.el, "operation"); });
        onWillDestroy(() => {
            if (this._quickSaleDialog) this._quickSaleDialog.close();
            if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
            if (this._keydownHandler) window.removeEventListener("keydown", this._keydownHandler);
        });
    }

    get themeStyle() { return `--eagle-accent:${this.state.themeColor};`; }
    formatAmount(value) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n.toFixed(2) : "0.00";
    }
    async heartbeatNow() {
        try {
            await this.orm.call("dashboard.data", "heartbeat", []);
            this.state.onlineUsers = await this.orm.call("dashboard.data", "get_online_users", []);
        } catch (e) {}
    }
    _onKeyDown(ev) {
        const tag = (ev.target.tagName || "").toLowerCase();
        const typing = tag === "input" || tag === "textarea" || tag === "select" || ev.target.isContentEditable;
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
            ev.preventDefault();
            return;
        }
        if (typing) return;
        if (ev.key.toLowerCase() === "b") this.goToBusinessDashboard();
        else if (ev.key.toLowerCase() === "f") this.goToFinanceDashboard();
        else if (ev.key.toLowerCase() === "d") this.toggleDarkMode();
    }
    toggleDarkMode() {
        this.state.darkMode = !this.state.darkMode;
        try { localStorage.setItem("eagle_dark_mode", this.state.darkMode ? "1" : "0"); } catch (e) {}
    }
    _fmt(d) { return d.toISOString().split("T")[0]; }
    _syncShared() {
        Object.assign(sharedFilterState, {
            from_date: this.state.from_date,
            to_date: this.state.to_date,
            active_preset: this.state.active_preset,
            selected_month: this.state.selected_month,
            selected_year: this.state.selected_year,
            partner_filter: this.state.partner_filter,
        });
    }
    _setDates(from, to, preset = "custom") {
        this.state.from_date = this._fmt(from);
        this.state.to_date = this._fmt(to);
        this.state.active_preset = preset;
        this._syncShared();
        this.loadAll();
    }
    applyPreset(p) {
        const n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = n.getDate();
        if (p === "today") return this._setDates(n, n, p);
        if (p === "this_week") {
            const day = n.getDay();
            const mon = new Date(y, m, d - ((day + 6) % 7));
            const sun = new Date(y, m, d + (7 - ((day + 6) % 7)) % 7);
            return this._setDates(mon, sun, p);
        }
        if (p === "this_month") return this._setDates(new Date(y, m, 1), new Date(y, m + 1, 0), p);
        if (p === "this_year") return this._setDates(new Date(y, 0, 1), new Date(y, 11, 31), p);
        this.state.from_date = "";
        this.state.to_date = "";
        this.state.active_preset = "all";
        this._syncShared();
        this.loadAll();
    }
    onMonthChange(ev) {
        const [y, mo] = ev.target.value.split("-").map(Number);
        this.state.selected_month = ev.target.value;
        this._setDates(new Date(y, mo - 1, 1), new Date(y, mo, 0), "custom");
    }
    onYearChange(ev) {
        const y = Number(ev.target.value);
        this.state.selected_year = String(y);
        this._setDates(new Date(y, 0, 1), new Date(y, 11, 31), "custom");
    }
    onDateChange() {
        if (this.state.from_date && this.state.to_date) {
            this.state.active_preset = "custom";
            this._syncShared();
            this.loadAll();
        }
    }

    async loadAll() {
        this.state.loading = true;
        this.state.error = "";
        try {
            const [data, company] = await Promise.all([
                this.orm.call("dashboard.data", "get_dashboard", [this.state.from_date || false, this.state.to_date || false]),
                this.orm.call("dashboard.data", "get_company_info", []),
            ]);
            this._orderLines = {};
            this._purchaseLines = {};
            const stripLines = (target, rows) => (rows || []).map((row) => {
                target[row.id] = row.lines || [];
                const { lines, ...rest } = row;
                return rest;
            });
            this.state.orders = stripLines(this._orderLines, data.orders);
            this.state.quotations = stripLines(this._orderLines, data.quotations);
            this.state.purchases = stripLines(this._purchaseLines, data.purchases);
            this.state.rfq = stripLines(this._purchaseLines, data.rfq);
            this.state.transactions = data.transactions || [];
            const pm = {};
            [...this.state.quotations, ...this.state.orders, ...this.state.purchases, ...this.state.rfq, ...this.state.transactions]
                .forEach((r) => { if (r.partner_id && r.partner) pm[r.partner_id] = r.partner; });
            this.state.partnerOptions = Object.entries(pm)
                .map(([id, name]) => ({ id: String(id), name }))
                .sort((a, b) => a.name.localeCompare(b.name));
            this.state.dataTotals = Object.assign({}, this.state.dataTotals, data.total_counts || {});
            this.state.dataPageLimits = Object.assign({}, this.state.dataPageLimits, data.page_limits || {});
            this.state.companyName = company?.name || "";
            this.state.companyId = company?.id || 0;
        } catch (e) {
            console.error("Operation dashboard load error:", e);
            this.state.error = "Unable to load Operation Dashboard data. Please retry.";
            this.state.orders = [];
            this.state.quotations = [];
            this.state.purchases = [];
            this.state.rfq = [];
            this.state.transactions = [];
        } finally {
            this.state.loading = false;
        }
    }

    _match(r) {
        const q = (this.state.partner_filter || "").trim().toLowerCase();
        const text = `${r.name || ""} ${r.partner || ""}`.toLowerCase();
        const nameOk = !q || text.includes(q);
        const status = r.status || r.state || "";
        const stateOk = !this.state.statusFilter || status === this.state.statusFilter;
        return nameOk && stateOk;
    }
    get filteredOrders() { return this.state.orders.filter(r => this._match(r)); }
    get filteredQuotations() { return this.state.quotations.filter(r => this._match(r)); }
    get filteredPurchases() { return this.state.purchases.filter(r => this._match(r)); }
    get filteredRfq() { return this.state.rfq.filter(r => this._match(r)); }
    get filteredTransactions() { return this.state.transactions.filter(r => this._match(r)); }
    get ordersCount() { return this.state.dataTotals.orders || this.state.orders.length; }
    get quotationsCount() { return this.state.dataTotals.quotations || this.state.quotations.length; }
    get purchasesCount() { return this.state.dataTotals.purchases || this.state.purchases.length; }
    get rfqCount() { return this.state.dataTotals.rfq || this.state.rfq.length; }
    get transactionsCount() { return this.state.dataTotals.transactions || this.state.transactions.length; }

    onStatusFilterChange(ev) { this.state.statusFilter = ev.target.value; }
    toggleTable(key) { this.state.tableOpen[key] = !this.state.tableOpen[key]; }
    _openTab(model, id) {
        const t = window.open(`/web#model=${model}&id=${id}&view_type=form`, "_blank");
        if (t) t.focus();
    }
    openOrder(id) { this._openTab("sale.order", id); }
    openPurchase(id) { this._openTab("purchase.order", id); }
    openPartner(id) { this._openTab("res.partner", id); }
    openTransaction(id) { this._openTab("account.payment", id); }
    async validatePayment(id) {
        try {
            await this.orm.call("dashboard.data", "validate_payment", [id]);
            await this.loadAll();
        } catch (e) {
            console.error("Payment validation failed:", e);
            this.state.error = "Payment could not be validated. Check the Odoo payment status and permissions.";
        }
    }

    // Quick Sale shortcut used by the floating + button on the Operation Dashboard.
    openQuickSale() {
        if (!this._quickSaleDialog) {
            this._quickSaleDialog = new EagleQuickSaleDialog({
                orm: this.orm,
                formatAmount: (value) => this.formatAmount(value),
                partnerOptions: () => this.state.partnerOptions || [],
                onCreated: async (res) => {
                    this._openTab("sale.order", res.id);
                    await this.loadAll();
                },
            });
        }
        this._quickSaleDialog.open();
    }

    closeQuickSale() {
        if (this._quickSaleDialog) this._quickSaleDialog.close();
    }

    openPrintModal() { this.state.showPrintModal = true; }
    closePrintModal() { this.state.showPrintModal = false; }
    doPrint() {
        const incOrder = this.state.printOrderLines;
        const incPurchase = this.state.printPurchaseLines;
        const incTx = this.state.printTransactions;
        const fmt = (value) => { const n = parseFloat(value); return Number.isFinite(n) ? n.toFixed(2) : "0.00"; };
        const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
        const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => `<link rel="stylesheet" href="${l.href}">`).join("");
        const orders = this.filteredOrders.map((r) => ({ ...r, lines: this._orderLines[r.id] || [] }));
        const quotations = this.filteredQuotations.map((r) => ({ ...r, lines: this._orderLines[r.id] || [] }));
        const purchases = this.filteredPurchases.map((r) => ({ ...r, lines: this._purchaseLines[r.id] || [] }));
        const rfq = this.filteredRfq.map((r) => ({ ...r, lines: this._purchaseLines[r.id] || [] }));
        const txs = this.filteredTransactions;
        const lineTable = (lines) => {
            if (!lines.length) return "";
            const head = ["Product", "Qty", "Rate", "Disc%", "Tax", "Total"].map((h) => `<th>${h}</th>`).join("");
            const body = lines.map((l) => `<tr><td>${esc(l.product)}</td><td class="num">${fmt(l.qty)}</td><td class="num">${fmt(l.price_unit)}</td><td class="num">${fmt(l.discount)}</td><td>${esc(l.tax)}</td><td class="num strong">${fmt(l.subtotal)}</td></tr>`).join("");
            return `<tr><td colspan="6"><table class="line-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></td></tr>`;
        };
        const buildTable = (records, kind, includeLines) => {
            if (!records.length) return '<p class="muted">No records.</p>';
            const cols = kind === "sales" || kind === "quotes"
                ? [["Reference", "name"], ["Partner", "partner"], ["Date", "date"], ["Status", "status"], ["Invoice Status", "invoice_status"], ["Amount", "amount"]]
                : kind === "purchases" || kind === "rfq"
                    ? [["Reference", "name"], ["Vendor", "partner"], ["Date", "date"], ["Status", "status"], ["Billing Status", "billing_status"], ["Amount", "amount"]]
                    : [["Reference", "name"], ["Date", "date"], ["Partner", "partner"], ["Journal", "ledger"], ["Received", "received"], ["Paid", "paid"], ["Status", "state"]];
            const head = cols.map(([label]) => `<th>${label}</th>`).join("");
            const body = records.map((r) => {
                const cells = cols.map(([label, key]) => {
                    const value = r[key];
                    if (key === "amount" || key === "received" || key === "paid") return `<td class="num">${fmt(value)}</td>`;
                    return `<td>${esc(value)}</td>`;
                }).join("");
                const lines = includeLines ? lineTable(r.lines || []) : "";
                return `<tr>${cells}</tr>${lines}`;
            }).join("");
            return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
        };
        const pw = window.open("", "_blank", "width=1200,height=820");
        if (!pw) return;
        this.state.showPrintModal = false;
        pw.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Operation Dashboard</title>${styles}<style>body{font-family:Arial,sans-serif;margin:0;padding:20px;color:#111827}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 8px;padding-bottom:5px;border-bottom:2px solid #1f2937}.period{color:#6b7280;font-size:12px;margin-bottom:12px}.muted{color:#6b7280;font-size:12px}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px}th{background:#1a1f36;color:#fff;text-align:left;padding:7px 9px}td{padding:7px 9px;border-bottom:1px solid #e5e7eb}.num{text-align:right;font-variant-numeric:tabular-nums}.strong{font-weight:700}.line-table{margin:0;border:1px solid #dbe3ee;font-size:10px}.line-table th{background:#eef2f7;color:#374151}.line-table td{padding:5px 7px}@media print{@page{size:A4 landscape;margin:10mm}body{padding:0}}</style></head><body><h1>Operation Dashboard</h1><div class="period">Period: ${esc(this.state.from_date || "All")} — ${esc(this.state.to_date || "All")}</div>
            <h2>Sales (${orders.length})</h2>${buildTable(orders, "sales", incOrder)}
            <h2>Quotations (${quotations.length})</h2>${buildTable(quotations, "quotes", incOrder)}
            <h2>Purchase (${purchases.length})</h2>${buildTable(purchases, "purchases", incPurchase)}
            <h2>RFQ (${rfq.length})</h2>${buildTable(rfq, "rfq", incPurchase)}
            ${incTx ? `<h2>Transactions (${txs.length})</h2>${buildTable(txs, "transactions", false)}` : ""}
            </body></html>`);
        pw.document.close();
        setTimeout(() => { try { pw.focus(); pw.print(); pw.close(); } catch (e) {} }, 700);
    }

    exportRows(rows, filename) {
        if (!rows.length) return;
        const cols = ["Reference", "Partner", "Date", "Status", "Amount"];
        const csv = [cols.join(","), ...rows.map(r => [r.name, r.partner, r.date, r.status || r.state, r.amount].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }
    exportOrders() { this.exportRows(this.filteredOrders, "sales.csv"); }
    exportQuotes() { this.exportRows(this.filteredQuotations, "quotations.csv"); }
    exportPurchases() { this.exportRows(this.filteredPurchases, "purchases.csv"); }
    exportRfq() { this.exportRows(this.filteredRfq, "rfq.csv"); }
    exportTransactions() {
        const rows = this.filteredTransactions.map(r => ({...r, status: r.state}));
        this.exportRows(rows, "transactions.csv");
    }
    goToBusinessDashboard() { this._syncShared(); this.action.doAction("eagle_business_dashboard.advanced_dashboard_action"); }
    goToFinanceDashboard() { this._syncShared(); this.action.doAction("eagle_business_dashboard.finance_dashboard_action"); }
}

OperationsDashboard.template = "advanced_business_dashboard.operations_dashboard";
registry.category("actions").add("operations_dashboard_tag", OperationsDashboard);
