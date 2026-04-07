/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onWillStart, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class Dashboard extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        const today = new Date().toISOString().split('T')[0];

        this.state = useState({
            quotations: [],
            orders: [],
            purchases: [],
            rfq: [],
            transactions: [],
            from_date: today,
            to_date: today,
            // Sorting state
            sortKey: '',
            sortOrder: 'asc',
        });

        onWillStart(async () => {
            await this.loadData();
        });
    }

    async loadData() {
        try {
            const data = await this.orm.call(
                "dashboard.data",
                "get_dashboard",
                [this.state.from_date, this.state.to_date]
            );

            // Update state with returned data
            this.state.quotations = data.quotations || [];
            this.state.orders = data.orders || [];
            this.state.purchases = data.purchases || [];
            this.state.rfq = data.rfq || [];
            this.state.transactions = data.transactions || [];

            // Re-apply existing sort to new data
            if (this.state.sortKey) {
                this._applySort();
            }
        } catch (error) {
            console.error("Dashboard failed to load data:", error);
        }
    }

    // Function called by clicking XML headers
    sortTransactions(key) {
        if (this.state.sortKey === key) {
            this.state.sortOrder = this.state.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.state.sortKey = key;
            this.state.sortOrder = 'asc';
        }
        this._applySort();
    }

    // Internal helper for array sorting
    _applySort() {
        const key = this.state.sortKey;
        const order = this.state.sortOrder === 'asc' ? 1 : -1;

        this.state.transactions.sort((a, b) => {
            let valA = a[key] ?? '';
            let valB = b[key] ?? '';

            if (typeof valA === 'number' && typeof valB === 'number') {
                return (valA - valB) * order;
            }
            return valA.toString().localeCompare(valB.toString()) * order;
        });
    }

    applyFilter() {
        this.loadData();
    }

    openOrder(id) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "sale.order",
            res_id: id,
            views: [[false, "form"]],
            target: "current",
        });
    }

    openPurchase(id) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "purchase.order",
            res_id: id,
            views: [[false, "form"]],
            target: "current",
        });
    }

    openTransaction(id) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "account.payment",
            res_id: id,
            views: [[false, "form"]],
            target: "current",
        });
    }
}

Dashboard.template = "advanced_business_dashboard.dashboard";
registry.category("actions").add("advanced_dashboard_tag", Dashboard);