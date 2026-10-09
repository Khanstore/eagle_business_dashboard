/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, onWillStart, onMounted, onWillDestroy, onPatched, useState } from "@odoo/owl";
import { enhanceEagleTables } from "./table_tools";
import { useService } from "@web/core/utils/hooks";
import { sharedFilterState } from "./shared_filter_state";
import { EagleQuickSaleDialog } from "./quick_sale_dialog";
import { EagleQuickInternalTransferDialog } from "./quick_internal_transfer_dialog";

/**
 * Operations workspace.
 *
 * This is intentionally a separate client action from the Business Dashboard.
 * It keeps the same Eagle visual language and filter behavior, but focuses on
 * the day-to-day sales/purchase/payment/warehouse workflow shown in the
 * Operations menu mock-up.
 */
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
        for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) {
            this.yearOptions.push(y);
        }

        const readStoredFold = (key) => {
            try {
                const value = localStorage.getItem(`eagle_operations_managed_fold_v2_${key}`);
                return value === null ? false : value === "true";
            } catch (e) {
                return false;
            }
        };
        const readStoredSort = (key) => {
            try {
                const value = JSON.parse(localStorage.getItem(`eagle_operations_managed_sort_${key}`) || "null");
                if (value && typeof value.key === "string" && ["asc", "desc"].includes(value.direction)) return value;
            } catch (e) {}
            return { key: "", direction: "asc" };
        };

        this.state = useState({
            quotations: [],
            orders: [],
            purchases: [],
            rfq: [],
            transactions: [],
            deliveries: [],
            receipts: [],
            internal: [],
            pending_deliveries: 0,
            pending_receipts: 0,
            late: 0,
            today_done: 0,
            from_date: sharedFilterState.from_date,
            to_date: sharedFilterState.to_date,
            partner_filter: sharedFilterState.partner_filter,
            partner_id_filter: "",
            includeChildContacts: false,
            partnerOptions: [],
            active_preset: sharedFilterState.active_preset,
            selected_month: sharedFilterState.selected_month,
            selected_year: sharedFilterState.selected_year,
            statusFilter: "",
            companyName: "",
            companyId: 0,
            teamNotes: "",
            notesSaved: false,
            notesMentioned: null,
            darkMode: false,
            onlineUsers: [],
            themeColor: "#4f5bd5",
            validatingPaymentId: 0,
            validatingPickingId: 0,
            showCommandPalette: false,
            commandQuery: "",
            sortKey: "",
            sortOrder: "asc",
            // These two high-traffic tables use Owl-owned controls so clicks and
            // row ordering survive virtual-DOM patches and targeted refreshes.
            tableSectionsOpen: {
                orders: readStoredFold("orders"),
                purchases: readStoredFold("purchases"),
            },
            tableSort: {
                orders: readStoredSort("orders"),
                purchases: readStoredSort("purchases"),
            },
            lastUpdated: "",
        });

        this._heartbeatTimer = null;
        this._quickSaleDialog = null;
        this._quickInternalTransferDialog = null;

        try {
            this.state.darkMode = localStorage.getItem("eagle_dark_mode") === "1";
        } catch (e) {}

        onWillStart(async () => {
            await this.loadAll();
            try {
                this.state.themeColor = await this.orm.call("dashboard.data", "get_theme_color", []);
            } catch (e) {}
        });

        onMounted(() => {
            this._keydownHandler = (ev) => this._onKeyDown(ev);
            window.addEventListener("keydown", this._keydownHandler);
            this.heartbeatNow();
            this._heartbeatTimer = setInterval(() => this.heartbeatNow(), 30000);
            enhanceEagleTables(this.el, "operations");
        });

        onPatched(() => enhanceEagleTables(this.el, "operations"));

        onWillDestroy(() => {
            if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
            if (this._keydownHandler) window.removeEventListener("keydown", this._keydownHandler);
            if (this._quickSaleDialog) {
                this._quickSaleDialog.close();
                this._quickSaleDialog = null;
            }
            if (this._quickInternalTransferDialog) {
                this._quickInternalTransferDialog.close();
                this._quickInternalTransferDialog = null;
            }
        });
    }

    get themeStyle() {
        return `--eagle-accent:${this.state.themeColor};`;
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
            this.state.showCommandPalette = true;
            this.state.commandQuery = "";
            return;
        }
        if (ev.key === "Escape" && this.state.showCommandPalette) {
            this.state.showCommandPalette = false;
            return;
        }
        if (typing || this.state.showCommandPalette) return;
        const k = ev.key.toLowerCase();
        if (k === "b") this.goToBusinessDashboard();
        else if (k === "f") this.goToFinanceDashboard();
        else if (k === "d") this.toggleDarkMode();
        else if (k === "r") this.createPayment("inbound");
        else if (k === "s") this.createPayment("outbound");
    }

    closeCommandPalette() {
        this.state.showCommandPalette = false;
    }

    onCommandQueryChange(ev) {
        this.state.commandQuery = ev.target.value;
    }

    get commandActions() {
        const all = [
            { label: "New Sales Order", icon: "fa-file-text-o", run: () => this.createOrder() },
            { label: "New Purchase Order", icon: "fa-shopping-bag", run: () => this.createPurchase() },
            { label: "Quick Internal Transfer", icon: "fa-random", run: () => this.openQuickInternalTransfer() },
            { label: "Receive Money", icon: "fa-arrow-down", run: () => this.createPayment("inbound") },
            { label: "Send Money", icon: "fa-arrow-up", run: () => this.createPayment("outbound") },
            { label: "Go to Business Dashboard", icon: "fa-th-large", run: () => this.goToBusinessDashboard() },
            { label: "Go to Finance Dashboard", icon: "fa-line-chart", run: () => this.goToFinanceDashboard() },
            { label: "Toggle Dark Mode", icon: "fa-moon-o", run: () => this.toggleDarkMode() },
        ];
        const q = this.state.commandQuery.trim().toLowerCase();
        return q ? all.filter((a) => a.label.toLowerCase().includes(q)) : all;
    }

    runCommand(action) {
        this.state.showCommandPalette = false;
        action.run();
    }

    openQuickSale() {
        if (!this._quickSaleDialog) {
            this._quickSaleDialog = new EagleQuickSaleDialog({
                orm: this.orm,
                formatAmount: (value) => this.formatAmount(value),
                onCreated: async (result) => {
                    if (result && result.id) {
                        this._openTab("sale.order", result.id);
                        await this.refreshSaleOrderRecord(result.id);
                    }
                },
            });
        }
        this._quickSaleDialog.open();
    }

    openQuickInternalTransfer() {
        if (!this._quickInternalTransferDialog) {
            this._quickInternalTransferDialog = new EagleQuickInternalTransferDialog({
                orm: this.orm,
                onCreated: async (result) => {
                    if (result && result.id) {
                        this._openTab("stock.picking", result.id);
                        await this.refreshPickingRecord(result.id);
                    }
                },
            });
        }
        this._quickInternalTransferDialog.open();
    }

    toggleDarkMode() {
        this.state.darkMode = !this.state.darkMode;
        try {
            localStorage.setItem("eagle_dark_mode", this.state.darkMode ? "1" : "0");
        } catch (e) {}
    }

    _fmt(d) {
        return d.toISOString().split("T")[0];
    }

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
        const n = new Date();
        const y = n.getFullYear();
        const m = n.getMonth();
        const d = n.getDate();
        if (p === "today") {
            this._setDates(n, n, p);
            return;
        }
        if (p === "this_week") {
            const day = n.getDay();
            const mon = new Date(y, m, d - ((day + 6) % 7));
            const sun = new Date(y, m, d + (7 - ((day + 6) % 7)) % 7);
            this._setDates(mon, sun, p);
            return;
        }
        if (p === "this_month") {
            this._setDates(new Date(y, m, 1), new Date(y, m + 1, 0), p);
            return;
        }
        if (p === "this_year") {
            this._setDates(new Date(y, 0, 1), new Date(y, 11, 31), p);
            return;
        }
        if (p === "all") {
            this.state.from_date = "";
            this.state.to_date = "";
            this.state.active_preset = "all";
            this._syncShared();
            this.loadAll();
        }
    }

    onMonthChange(ev) {
        const [y, mo] = ev.target.value.split("-").map(Number);
        this.state.selected_month = ev.target.value;
        this._setDates(new Date(y, mo - 1, 1), new Date(y, mo, 0), "custom");
    }

    onYearChange(ev) {
        const y = Number(ev.target.value);
        this.state.selected_year = ev.target.value;
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
        try {
            const [data, operations, widgets, company, notes] = await Promise.all([
                this.orm.call("dashboard.data", "get_dashboard", [this.state.from_date || false, this.state.to_date || false]),
                this.orm.call("dashboard.data", "get_operations_dashboard", [this.state.from_date || false, this.state.to_date || false]),
                this.orm.call("dashboard.data", "get_operations_widgets", []),
                this.orm.call("dashboard.data", "get_company_info", []),
                this.orm.call("dashboard.data", "get_team_notes", []),
            ]);

            this.state.orders = data.orders || [];
            this.state.purchases = data.purchases || [];
            this.state.quotations = data.quotations || [];
            this.state.rfq = data.rfq || [];
            this.state.transactions = data.transactions || [];
            this.state.deliveries = operations.deliveries || [];
            this.state.receipts = operations.receipts || [];
            this.state.internal = operations.internal || [];
            this.state.pending_deliveries = widgets.pending_deliveries || 0;
            this.state.pending_receipts = widgets.pending_receipts || 0;
            this.state.late = widgets.late || 0;
            this.state.today_done = widgets.today_done || 0;
            this.state.companyName = company ? company.name : "";
            this.state.companyId = company ? company.id : 0;
            this.state.teamNotes = notes || "";

            const pm = {};
            [...this.state.quotations, ...this.state.orders, ...this.state.purchases, ...this.state.rfq, ...this.state.transactions,
                ...this.state.deliveries, ...this.state.receipts, ...this.state.internal]
                .forEach((r) => {
                    if (r.partner_id && r.partner) pm[r.partner_id] = r.partner;
                });
            this.state.partnerOptions = Object.entries(pm)
                .map(([id, name]) => ({ id: String(id), name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            if (this.state.sortKey) this._applySort();
            this.state.lastUpdated = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        } catch (e) {
            console.error("Operations workspace load error:", e);
        }
    }

    _statusMatch(r) {
        if (!this.state.statusFilter) return true;
        return r.status === this.state.statusFilter || r.state === this.state.statusFilter || r.invoice_status === this.state.statusFilter || r.billing_status === this.state.statusFilter;
    }

    _ok(r) {
        const q = (this.state.partner_filter || "").trim().toLowerCase();
        const pid = this.state.partner_id_filter;
        let nameOk = true;
        if (q) {
            nameOk = (r.partner || "").toLowerCase().includes(q);
            if (this.state.includeChildContacts) {
                nameOk = nameOk || (r.partner_parent || "").toLowerCase().includes(q);
            }
        }
        return nameOk && (!pid || String(r.partner_id) === pid) && this._statusMatch(r);
    }

    toggleIncludeChildContacts() {
        this.state.includeChildContacts = !this.state.includeChildContacts;
    }

    get filteredOrders() { return this.state.orders.filter((r) => this._ok(r)); }
    get filteredPurchases() { return this.state.purchases.filter((r) => this._ok(r)); }
    get filteredQuotations() { return this.state.quotations.filter((r) => this._ok(r)); }
    get filteredRfq() { return this.state.rfq.filter((r) => this._ok(r)); }
    get filteredTransactions() { return this.state.transactions.filter((r) => this._ok(r)); }
    get filteredDeliveries() { return this.state.deliveries.filter((r) => this._ok(r)); }
    get filteredReceipts() { return this.state.receipts.filter((r) => this._ok(r)); }
    get filteredInternal() { return this.state.internal.filter((r) => this._ok(r)); }

    get sortedOrders() { return this._sortOperationsRows(this.filteredOrders, "orders"); }
    get sortedPurchases() { return this._sortOperationsRows(this.filteredPurchases, "purchases"); }

    toggleOperationsTable(key) {
        if (!(key in this.state.tableSectionsOpen)) return;
        this.state.tableSectionsOpen[key] = !this.state.tableSectionsOpen[key];
        try {
            localStorage.setItem(`eagle_operations_managed_fold_v2_${key}`, String(this.state.tableSectionsOpen[key]));
        } catch (e) {}
    }

    onOperationsTableTitleKeydown(ev, key) {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        this.toggleOperationsTable(key);
    }

    sortOperationsTable(tableKey, field) {
        const current = this.state.tableSort[tableKey];
        if (!current) return;
        const direction = current.key === field && current.direction === "asc" ? "desc" : "asc";
        this.state.tableSort[tableKey] = { key: field, direction };
        try {
            localStorage.setItem(`eagle_operations_managed_sort_${tableKey}`, JSON.stringify(this.state.tableSort[tableKey]));
        } catch (e) {}
    }

    _sortOperationsRows(rows, tableKey) {
        const setting = this.state.tableSort[tableKey];
        if (!setting || !setting.key) return rows;
        const direction = setting.direction === "desc" ? -1 : 1;
        const comparable = (value) => {
            if (value === null || value === undefined || value === "") return { type: "empty", value: "" };
            if (typeof value === "number") return { type: "number", value };
            const raw = String(value).trim();
            let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
            if (match) return { type: "number", value: Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)) };
            match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
            if (match) return { type: "number", value: Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)) };
            const numeric = raw.replace(/,/g, "");
            if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(numeric)) return { type: "number", value: Number(numeric) };
            return { type: "text", value: raw };
        };
        return [...rows].sort((left, right) => {
            const a = comparable(left[setting.key]);
            const b = comparable(right[setting.key]);
            if (a.type === "empty" && b.type !== "empty") return 1;
            if (b.type === "empty" && a.type !== "empty") return -1;
            if (a.type === "number" && b.type === "number") return (a.value - b.value) * direction;
            return String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" }) * direction;
        });
    }

    get showDateColumn() {
        return !(this.state.from_date && this.state.to_date && this.state.from_date === this.state.to_date);
    }

    formatAmount(value) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n.toFixed(2) : "0.00";
    }

    _sum(arr, field) {
        return arr.reduce((s, r) => s + (Number(r[field]) || 0), 0).toFixed(2);
    }

    get txTotalReceived() { return this._sum(this.filteredTransactions, "received"); }
    get txTotalPaid() { return this._sum(this.filteredTransactions, "paid"); }

    sortTransactions(key) {
        this.state.sortOrder = this.state.sortKey === key && this.state.sortOrder === "asc" ? "desc" : "asc";
        this.state.sortKey = key;
        this._applySort();
    }

    _applySort() {
        const k = this.state.sortKey;
        const order = this.state.sortOrder === "asc" ? 1 : -1;
        this.state.transactions.sort((a, b) => {
            const av = a[k] ?? "";
            const bv = b[k] ?? "";
            if (typeof av === "number" && typeof bv === "number") return (av - bv) * order;
            return String(av).localeCompare(String(bv)) * order;
        });
    }

    _writeCSV(rows, filename) {
        if (!rows || !rows.length) return;
        const keys = Object.keys(rows[0]);
        const lines = [keys.join(",")];
        for (const r of rows) {
            lines.push(keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(","));
        }
        const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    exportOrders() { this._writeCSV(this.filteredOrders, "operations_orders.csv"); }
    exportPurchases() { this._writeCSV(this.filteredPurchases, "operations_purchases.csv"); }
    exportQuotes() { this._writeCSV(this.filteredQuotations, "operations_quotations.csv"); }
    exportRfq() { this._writeCSV(this.filteredRfq, "operations_rfq.csv"); }
    exportTx() { this._writeCSV(this.filteredTransactions, "operations_transactions.csv"); }
    exportDeliveries() { this._writeCSV(this.filteredDeliveries, "operations_deliveries.csv"); }
    exportReceipts() { this._writeCSV(this.filteredReceipts, "operations_receipts.csv"); }
    exportInternal() { this._writeCSV(this.filteredInternal, "operations_internal_transfers.csv"); }

    async createOrder() {
        await this.action.doAction({
            type: "ir.actions.act_window",
            name: "New Sales Order",
            res_model: "sale.order",
            views: [[false, "form"]],
            target: "current",
        });
        await this.loadAll();
    }

    async createPurchase() {
        await this.action.doAction({
            type: "ir.actions.act_window",
            name: "New Purchase Order",
            res_model: "purchase.order",
            views: [[false, "form"]],
            target: "current",
        });
        await this.loadAll();
    }

    async createPayment(type) {
        const partnerType = type === "inbound" ? "customer" : "supplier";
        await this.action.doAction({
            type: "ir.actions.act_window",
            name: type === "inbound" ? "Receive Money" : "Send Money",
            res_model: "account.payment",
            views: [[false, "form"]],
            target: "current",
            context: { default_payment_type: type, default_partner_type: partnerType },
        });
        await this.loadAll();
    }

    async validatePayment(id) {
        if (this.state.validatingPaymentId) return;
        this.state.validatingPaymentId = id;
        try {
            const result = await this.orm.call("dashboard.data", "validate_payment", [id]);
            await this.refreshPaymentRecord(id);
            if (result && result.already_posted) {
                this.openTransaction(id);
                return;
            }
        } catch (e) {
            console.error("Payment validation failed:", e);
            window.alert(e?.data?.message || e?.message || "Unable to validate this payment.");
        } finally {
            this.state.validatingPaymentId = 0;
        }
    }

    async validatePicking(id, ev) {
        if (ev) ev.stopPropagation();
        if (this.state.validatingPickingId) return;
        this.state.validatingPickingId = id;
        try {
            const result = await this.orm.call("dashboard.data", "validate_picking", [id]);
            if (result && result.action) {
                await this.action.doAction(result.action);
            }
            await this.refreshPickingRecord(id);
            if (!(result && result.ok) && result && result.message) {
                window.alert(result.message);
            }
        } catch (e) {
            console.error("Picking validation failed:", e);
            window.alert(e?.data?.message || e?.message || "Unable to change the stock transfer status.");
        } finally {
            this.state.validatingPickingId = 0;
        }
    }

    _replaceOperationRow(rows, row, visible = true) {
        if (!rows || !row || !row.id) return;
        const idx = rows.findIndex((r) => Number(r.id) === Number(row.id));
        if (!visible) {
            if (idx >= 0) rows.splice(idx, 1);
            return;
        }
        if (idx >= 0) {
            Object.assign(rows[idx], row);
        } else {
            rows.unshift(row);
        }
    }

    async refreshPaymentRecord(id) {
        try {
            const payload = await this.orm.call("dashboard.data", "get_operations_payment_refresh", [
                id, this.state.from_date || false, this.state.to_date || false,
            ]);
            if (!payload || !payload.found) {
                this._replaceOperationRow(this.state.transactions, { id }, false);
                return;
            }
            this._replaceOperationRow(this.state.transactions, payload.row, payload.visible !== false);
        } catch (e) {
            console.error("Payment row refresh failed:", e);
        }
    }

    async refreshPickingRecord(id) {
        try {
            const payload = await this.orm.call("dashboard.data", "get_operations_picking_refresh", [
                id, this.state.from_date || false, this.state.to_date || false,
            ]);
            if (!payload || payload.found === false) {
                [this.state.deliveries, this.state.receipts, this.state.internal].forEach((rows) =>
                    this._replaceOperationRow(rows, { id }, false));
                return;
            }
            const row = payload.row || { id };
            const target = payload.kind === "delivery"
                ? this.state.deliveries
                : payload.kind === "internal"
                    ? this.state.internal
                    : this.state.receipts;
            // Ensure a row exists in only the list matching its picking type.
            [this.state.deliveries, this.state.receipts, this.state.internal]
                .filter((rows) => rows !== target)
                .forEach((rows) => this._replaceOperationRow(rows, { id }, false));
            this._replaceOperationRow(target, row, payload.visible !== false);
            if (payload.widgets) {
                this.state.pending_deliveries = payload.widgets.pending_deliveries || 0;
                this.state.pending_receipts = payload.widgets.pending_receipts || 0;
                this.state.late = payload.widgets.late || 0;
                this.state.today_done = payload.widgets.today_done || 0;
            }
        } catch (e) {
            console.error("Picking row refresh failed:", e);
        }
    }

    async refreshSaleOrderRecord(id) {
        try {
            const payload = await this.orm.call("dashboard.data", "get_operations_sale_order_refresh", [
                id, this.state.from_date || false, this.state.to_date || false,
            ]);
            if (!payload || !payload.found) return;
            const row = payload.row || {};
            if (row.state === "sale") {
                this._replaceOperationRow(this.state.orders, row, payload.visible !== false);
                this._replaceOperationRow(this.state.quotations, { id }, false);
            } else {
                this._replaceOperationRow(this.state.quotations, row, payload.visible !== false);
                this._replaceOperationRow(this.state.orders, { id }, false);
            }
        } catch (e) {
            console.error("Sales order row refresh failed:", e);
        }
    }

    async saveTrackingReference(delivery, ev) {
        if (ev) ev.stopPropagation();
        const value = String(ev?.target?.value || '').trim();
        if (!value) {
            if (ev?.target) ev.target.value = '';
            return;
        }
        try {
            const result = await this.orm.call("dashboard.data", "save_picking_tracking_reference", [delivery.id, value]);
            if (result && result.ok) {
                delivery.tracking_reference = result.tracking_reference || value;
                return;
            }
            if (result && result.tracking_reference) {
                delivery.tracking_reference = result.tracking_reference;
            }
            window.alert(result?.message || "Unable to save the tracking reference.");
        } catch (e) {
            console.error("Tracking reference save failed:", e);
            window.alert(e?.data?.message || e?.message || "Unable to save the tracking reference.");
        }
    }

    onTrackingReferenceKeydown(delivery, ev) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            ev.target.blur();
        } else if (ev.key === "Escape") {
            ev.preventDefault();
            ev.target.value = '';
            ev.target.blur();
        }
    }

    deliveryStatusLabel(state) {
        const labels = {
            draft: "Draft",
            waiting: "Waiting",
            confirmed: "Waiting",
            assigned: "Ready",
            done: "Done",
            cancel: "Cancelled",
        };
        return labels[state] || String(state || '').replace(/_/g, ' ');
    }

    async saveNotes() {
        try {
            const res = await this.orm.call("dashboard.data", "save_team_notes_with_mentions", [this.state.teamNotes]);
            this.state.notesSaved = true;
            this.state.notesMentioned = res && res.notified ? res.notified : null;
            setTimeout(() => {
                this.state.notesSaved = false;
                this.state.notesMentioned = null;
            }, 3000);
        } catch (e) {
            console.error("Team notes save failed:", e);
        }
    }

    _openTab(model, id) {
        const t = window.open(`/web#model=${model}&id=${id}&view_type=form`, "_blank");
        if (t) t.focus();
    }

    async _newTab(model, domain, name) {
        try {
            const actionId = await this.orm.call("dashboard.data", "open_dynamic_action", [model, domain, name || "Dashboard List"]);
            const t = window.open(`/odoo/action-${actionId}`, "_blank");
            if (t) t.focus();
        } catch (e) {
            console.error("Failed to open list:", e);
        }
    }

    openOrder(id) { this._openTab("sale.order", id); }
    openPurchase(id) { this._openTab("purchase.order", id); }
    openPartner(id) { this._openTab("res.partner", id); }
    openTransaction(id) { this._openTab("account.payment", id); }
    openPicking(id) { this._openTab("stock.picking", id); }
    openLocation(id) { if (id) this._openTab("stock.location", id); }
    openUser(id) { if (id) this._openTab("res.users", id); }

    openPendingDeliveries() {
        this._newTab("stock.picking", [["picking_type_id.code", "=", "outgoing"], ["state", "not in", ["done", "cancel"]]], "Pending Deliveries");
    }
    openPendingReceipts() {
        this._newTab("stock.picking", [["picking_type_id.code", "=", "incoming"], ["state", "not in", ["done", "cancel"]]], "Pending Receipts");
    }
    openLateTransfers() {
        this._newTab("stock.picking", [["state", "not in", ["done", "cancel"]], ["scheduled_date", "<", new Date().toISOString().split("T")[0]]], "Late Transfers");
    }

    goToBusinessDashboard() {
        this._syncShared();
        this.action.doAction("eagle_business_dashboard.advanced_dashboard_action");
    }
    goToFinanceDashboard() {
        this._syncShared();
        this.action.doAction("eagle_business_dashboard.finance_dashboard_action");
    }
}

OperationsDashboard.template = "advanced_business_dashboard.operations_dashboard";
registry.category("actions").add("operations_dashboard_tag", OperationsDashboard);
