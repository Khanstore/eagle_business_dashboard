/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

/* ===========================================================================
   Shared base for the two in-app manuals.
   Keeps the same shell as the dashboards: eagle-app > eagle-header + body.
   =========================================================================== */
class ManualBase extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        this.state = useState({
            section: this.constructor.sections[0].id,
            query: "",
            darkMode: false,
            companyName: "",
            companyId: 0,
            themeColor: "#4f5bd5",
        });

        onWillStart(async () => {
            try {
                const info = await this.orm.call("dashboard.data", "get_company_info", []);
                this.state.companyName = info.name || "";
                this.state.companyId = info.id || 0;
            } catch (e) {
                console.warn("Manual: company info unavailable", e);
            }
            try {
                const color = await this.orm.call("dashboard.data", "get_theme_color", []);
                if (color) this.state.themeColor = color;
            } catch (e) {
                /* theme colour is cosmetic only - ignore */
            }
        });
    }

    get sections() {
        return this.constructor.sections;
    }

    /* Filtered sidebar entries. Plain loop - no spread, no ?? (OWL parser). */
    get visibleSections() {
        const q = (this.state.query || "").toLowerCase().trim();
        if (!q) return this.constructor.sections;
        const out = [];
        for (const s of this.constructor.sections) {
            if (s.title.toLowerCase().indexOf(q) !== -1) out.push(s);
        }
        return out;
    }

    get themeStyle() {
        return "--eagle-accent:" + this.state.themeColor + ";";
    }

    get currentTitle() {
        for (const s of this.constructor.sections) {
            if (s.id === this.state.section) return s.title;
        }
        return "";
    }

    select(id) {
        this.state.section = id;
        const body = document.querySelector(".eagle-manual-content");
        if (body) body.scrollTop = 0;
    }

    toggleDark() {
        this.state.darkMode = !this.state.darkMode;
    }

    printManual() {
        window.print();
    }

    goToBusinessDashboard() {
        this.action.doAction("eagle_business_dashboard.advanced_dashboard_action");
    }
    goToFinanceDashboard() {
        this.action.doAction("eagle_business_dashboard.finance_dashboard_action");
    }
    goToOperationsDashboard() {
        this.action.doAction("eagle_business_dashboard.operations_dashboard_action");
    }
}

/* ─────────────────────────── USER MANUAL ─────────────────────────── */
class UserManual extends ManualBase {}
UserManual.sections = [
    { id: "start",     title: "Getting Started",        icon: "fa-flag-checkered" },
    { id: "business",  title: "Business Dashboard",     icon: "fa-line-chart" },
    { id: "finance",   title: "Finance Dashboard",      icon: "fa-money" },
    { id: "operations",title: "Operations Dashboard",   icon: "fa-truck" },
    { id: "quicksale", title: "Quick Sale",             icon: "fa-bolt" },
    { id: "process",   title: "One-Click Process",      icon: "fa-forward" },
    { id: "payments",  title: "Payments & Invoices",    icon: "fa-credit-card" },
    { id: "filters",   title: "Filters & Presets",      icon: "fa-filter" },
    { id: "stock",     title: "Low Stock & Reorder",    icon: "fa-cubes" },
    { id: "approvals", title: "Approval Queue",         icon: "fa-check-square-o" },
    { id: "visibility",title: "Dashboard Visibility",   icon: "fa-eye" },
    { id: "export",    title: "Exports & Printing",     icon: "fa-download" },
    { id: "share",     title: "Snapshot Sharing",       icon: "fa-share-alt" },
    { id: "collab",    title: "Comments & Presence",    icon: "fa-comments-o" },
    { id: "digest",    title: "Daily Digest Email",     icon: "fa-envelope-o" },
    { id: "menus",     title: "Master Menus",           icon: "fa-sitemap" },
    { id: "shortcuts", title: "Keyboard Shortcuts",     icon: "fa-keyboard-o" },
    { id: "trouble",   title: "Troubleshooting",        icon: "fa-life-ring" },
];
UserManual.template = "advanced_business_dashboard.user_manual";
registry.category("actions").add("eagle_user_manual_tag", UserManual);

/* ──────────────────────── DEVELOPER MANUAL ───────────────────────── */
class DeveloperManual extends ManualBase {}
DeveloperManual.sections = [
    { id: "structure", title: "Module Structure",       icon: "fa-folder-open-o" },
    { id: "manifest",  title: "Manifest & Assets",      icon: "fa-file-code-o" },
    { id: "models",    title: "Python Models",          icon: "fa-database" },
    { id: "rpc",       title: "RPC Method Reference",   icon: "fa-exchange" },
    { id: "owl",       title: "OWL Architecture",       icon: "fa-code" },
    { id: "filterstate",title:"Shared Filter State",    icon: "fa-link" },
    { id: "quicksale", title: "Quick Sale Internals",   icon: "fa-bolt" },
    { id: "bundles",   title: "Bundles & Forecasting",  icon: "fa-cubes" },
    { id: "fulfil",    title: "Order Fulfilment Chain", icon: "fa-forward" },
    { id: "snapshot",  title: "Snapshot Controller",    icon: "fa-globe" },
    { id: "cron",      title: "Cron & Daily Digest",    icon: "fa-clock-o" },
    { id: "security",  title: "Security & Groups",      icon: "fa-shield" },
    { id: "addkpi",    title: "Adding a New KPI",       icon: "fa-plus-square-o" },
    { id: "css",       title: "CSS Design System",      icon: "fa-paint-brush" },
    { id: "gotchas",   title: "Odoo 18 / OWL Gotchas",  icon: "fa-exclamation-triangle" },
    { id: "perf",      title: "Known Performance Debt", icon: "fa-tachometer" },
    { id: "deploy",    title: "Upgrade & Deployment",   icon: "fa-server" },
    { id: "checklist", title: "Release Checklist",      icon: "fa-list-ol" },
];
DeveloperManual.template = "advanced_business_dashboard.developer_manual";
registry.category("actions").add("eagle_developer_manual_tag", DeveloperManual);
