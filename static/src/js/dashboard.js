/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onWillStart, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

class Dashboard extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        // 👉 today date তৈরি
        const today = new Date().toISOString().split('T')[0];

        this.state = useState({
            quotations: [],
            orders: [],
            purchases: [],
            rfq: [],
            transactions: [],
            from_date: today,
            to_date: today,
        });

        // ✅ FIXED
        onWillStart(async () => {
            await this.loadData();
        });
    }

    async loadData() {
        const data = await this.orm.call(
            "dashboard.data",
            "get_dashboard",
            [this.state.from_date, this.state.to_date]
        );

        this.state.quotations = data.quotations;
        this.state.orders = data.orders;
        this.state.purchases = data.purchases;
        this.state.transactions = data.transactions;
        this.state.rfq = data.rfq;
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
            target: "new",
        });
    }

    openPurchase(id) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "purchase.order",
            res_id: id,
            views: [[false, "form"]],
            target: "new",
        });
    }

    openTransaction(id) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "account.payment",
            res_id: id,
            views: [[false, "form"]],
            target: "new",
        });
    }
}

Dashboard.template = "advanced_business_dashboard.dashboard";
registry.category("actions").add("advanced_dashboard_tag", Dashboard);