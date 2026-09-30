/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, onWillStart, onWillDestroy, onMounted, onPatched, useState } from "@odoo/owl";
import { enhanceEagleTables } from "./table_tools";
import { useService } from "@web/core/utils/hooks";
import { sharedFilterState } from "./shared_filter_state";

class Dashboard extends Component {
    setup() {
        this.orm    = useService("orm");
        this.action = useService("action");
        const now   = new Date();

        this.monthOptions = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
            this.monthOptions.push({
                value:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
                label:d.toLocaleString('default',{month:'long',year:'numeric'}),
            });
        }
        this.yearOptions = [];
        for (let y=now.getFullYear(); y>=now.getFullYear()-4; y--) this.yearOptions.push(y);

        this.state = useState({
            // Core data
            quotations:[], orders:[], purchases:[], rfq:[], transactions:[],
            // Widgets
            overdue_count:0, overdue_amount:0, due_soon_count:0, due_soon_amount:0,
            top_customers:[], month_sales:0, sales_target:0, low_stock:[],
            // Analytics
            trend_data:[], trendGranularity:'day', trendLoading:false, trendError:'', aging:{ar:[],ap:[]},
            operations:{pending_deliveries:[],mismatch:[],stock_value:0},
            customers:{new:0,returning:0,total:0,clv:[]},
            financial:{tax_collected:0,tax_paid:0,tax_net:0,unreconciled_count:0,
                       current_sales:0,previous_sales:0,last_year_sales:0},
            // Stage 2 + 3 management analytics
            management:{sales_performance:{},product_profitability:[],inventory_risk:[]},
            warehouseComparison:[],
            dailyClosing:{date:'',sales_orders:0,sales_amount:0,customer_payments:0,customer_received:0,
                           vendor_payments:0,vendor_paid:0,customer_invoices:0,customer_invoice_amount:0,
                           vendor_bills:0,vendor_bill_amount:0,deliveries_done:0,receipts_done:0,
                           internal_transfers_done:0,draft_payments:0,pending_deliveries:0,pending_receipts:0,
                           net_cash_movement:0,journal_moves:[]},
            stageTablesOpen:{product_profitability:false,inventory_risk:false,warehouse_comparison:false,daily_journal_moves:false},
            dailyClosingDate: new Date().toISOString().split('T')[0],
            // Stage 4 control center
            actionCenter:{cards:[],total_open:0,critical:0,as_of:''},
            stage4Open:{action_center:false},
            executive:{role:'user',company:'',generated_at:'',what_changed:{},exceptions:{open:0,critical:0},data_quality:{total_flags:0,checks:[]},anomalies:[],audit:[],reorder:[]},
            executiveOpen:false,
            ultimate:{can_manage:false,period:{from_date:'',to_date:''},today_change:{},salespeople:[],margin_watch:[],returns:{count:0,amount:0,rate_pct:null,top_products:[]},customer_risk:[],reconciliation:{unreconciled_count:0,unreconciled_amount:0,in_process_count:0,in_process_amount:0},data_quality:{missing_product_barcode:0,missing_product_category:0,non_positive_sale_price:0,negative_stock_quants:0,customer_missing_email:0},approval_queue:{sales:[],purchases:[],sale_threshold:0,purchase_threshold:0}},
            ultimateOpen:false, ultimateTablesOpen:{salespeople:false,margin_watch:false,returns:false,customer_risk:false,reconciliation:false,data_quality:false,approvals:false},
            // Visibility & access
            role:'user', visibility:{}, section_labels:{}, all_defaults:{},
            // Filters
            from_date:sharedFilterState.from_date, to_date:sharedFilterState.to_date,
            partner_filter:sharedFilterState.partner_filter,
            active_preset:sharedFilterState.active_preset,
            selected_month:sharedFilterState.selected_month,
            selected_year:sharedFilterState.selected_year,
            partner_id_filter:'', partnerOptions:[],
            includeChildContacts:false,
            sortKey:'', sortOrder:'asc',
            // Quick search
            quickSearch:'', showSearchResults:false,
            // Multi-period tab
            periodTab:'current',
            // Notes
            teamNotes:'', notesSaved:false, notesMentioned:null,
            // Print/export
            showPrintModal:false, printOrderLines:false, printPurchaseLines:false, printTxDetails:true,
            showExportPrompt:false, exportPromptType:'',
            // Target modal
            showTargetModal:false, targetInput:'',
            // Settings panel
            showSettings:false, settingsDraft:{}, settingsSaved:false,
            showCustomize:false, customizeDraft:{}, customizeSaved:false, customizeBusy:false,
            userPrefs:{density:'comfortable',hidden_sections:[],collapse_on_load:true,show_hints:true,keyboard_shortcuts:true,refresh_mins:5,auto_refresh:false,dark_mode:false,accent_color:'#4f5bd5',workspace:'all'},
            showHealth:false, health:{allowed:false,checks:[],generated_at:''}, healthLoading:false,
            loading:false, lastUpdated:'', loadErrors:[],
            approvalThresholds:{sale_threshold:0,purchase_threshold:0},
            // Auto-refresh
            autoRefresh:false, refreshMins:5,
            // Company branding + Low Stock UX
            companyName:'', companyId:0,
            lowStockExpanded:false,
            showSnoozeModal:false, snoozeProductId:0, snoozeProductName:'', snoozeWeeks:1,
            // Batch 3: "make it attractive" pack
            animCounters:{},
            onlineUsers:[],
            themeColor:'#4f5bd5',
            notificationsEnabled:false,
            showConfetti:false,
            nlSummary:'',
            bestWorstDay:{best:null,worst:null},
            productBundles:[],
            streak:0, dailyTarget:0,
            showCommandPalette:false, commandQuery:'',
            recentlyViewed:[],
            showKpiComments:false, activeKpiKey:'', activeKpiLabel:'', kpiComments:[], newCommentText:'',
            showShareModal:false, shareUrl:'',
            savedFilters:[], showSaveFilterPrompt:false, filterNameInput:'',
            showQuickSale:false, quickSalePartner:'', quickSaleProduct:'', quickSalePartnerSearch:'', quickSaleProductSearch:'', quickSaleQty:1,
            validatingPaymentId:0,
            productOptions:[], quickSaleError:'', quickSaleSubmitting:false, quickSaleLastResult:'',
            quickSaleProductSearchSeq:0, quickSaleProductSearchTimer:null,
        });

        this._orderLines    = {};
        this._purchaseLines = {};
        this._refreshTimer  = null;
        this._heartbeatTimer = null;
        this._prevOverdue = null;
        this._prevLowStockLen = null;
        this._confettiShown = false;

        try { this.state.darkMode = localStorage.getItem('eagle_dark_mode') === '1'; } catch(e) {}
        try { this.state.recentlyViewed = JSON.parse(localStorage.getItem('eagle_recent_business') || '[]'); } catch(e) {}

        onWillStart(async () => {
            await this.loadUserPreferences();
            await this.loadAll();
            await this.loadSavedFilters();
            await this.loadAttractivePack();
        });
        onMounted(() => {
            this._injectPwaManifest();
            this._keydownHandler = (ev) => this._onKeyDown(ev);
            window.addEventListener('keydown', this._keydownHandler);
            this.heartbeatNow();
            this._heartbeatTimer = setInterval(() => this.heartbeatNow(), 30000);
            if (this.state.autoRefresh) this._startRefresh();
            enhanceEagleTables(this.el, 'business');
        });
        onPatched(() => {
            enhanceEagleTables(this.el, 'business');
        });
        onWillDestroy(() => {
            this._stopRefresh();
            if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
            if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
        });
    }

    // ── Helpers ──────────────────────────────────────────────────────────
    _fmt(d) { return d.toISOString().split('T')[0]; }
    _syncShared() {
        Object.assign(sharedFilterState, {
            from_date:this.state.from_date, to_date:this.state.to_date,
            active_preset:this.state.active_preset,
            selected_month:this.state.selected_month, selected_year:this.state.selected_year,
            partner_filter:this.state.partner_filter,
        });
    }
    _setDates(from, to, preset='custom') {
        this.state.from_date=this._fmt(from); this.state.to_date=this._fmt(to);
        this.state.active_preset=preset; this._syncShared(); this.loadAll();
    }
    vis(key) {
        if (this.state.visibility[key] === false) return false;
        const hidden = this.state.userPrefs.hidden_sections || [];
        return !hidden.includes(key);
    }
    get customizableSectionEntries() {
        return this.getSectionLabelEntries().filter(([key]) => key !== 'settings');
    }
    get hasLoadError() { return (this.state.loadErrors || []).length > 0; }
    get isAdminOrManager() { return this.state.role === 'admin' || this.state.role === 'manager'; }


    // ── Presets ───────────────────────────────────────────────────────────
    applyPreset(p) {
        const n=new Date(), y=n.getFullYear(), m=n.getMonth(), d=n.getDate();
        if(p==='today'){this._setDates(n,n,p);return;}
        if(p==='this_week'){const day=n.getDay(),mon=new Date(y,m,d-((day+6)%7)),sun=new Date(y,m,d+(7-((day+6)%7))%7);this._setDates(mon,sun,p);return;}
        if(p==='this_month'){this._setDates(new Date(y,m,1),new Date(y,m+1,0),p);return;}
        if(p==='this_year'){this._setDates(new Date(y,0,1),new Date(y,11,31),p);return;}
        if(p==='all'){this.state.from_date='';this.state.to_date='';this.state.active_preset='all';this._syncShared();this.loadAll();}
    }
    onMonthChange(ev){const[y,mo]=ev.target.value.split('-').map(Number);this.state.selected_month=ev.target.value;this._setDates(new Date(y,mo-1,1),new Date(y,mo,0),'custom');}
    onYearChange(ev){const y=Number(ev.target.value);this.state.selected_year=ev.target.value;this._setDates(new Date(y,0,1),new Date(y,11,31),'custom');}
    onDateChange(){if(this.state.from_date&&this.state.to_date){this.state.active_preset='custom';this._syncShared();this.loadAll();}}

    // ── Data loading ──────────────────────────────────────────────────────
    async _safeRpc(model, method, args, fallback, label) {
        try {
            return await this.orm.call(model, method, args);
        } catch (e) {
            this._loadErrors = this._loadErrors || [];
            this._loadErrors.push(label || `${model}.${method}`);
            console.error(`Dashboard ${label || method} load error:`, e);
            return fallback;
        }
    }

    async loadUserPreferences() {
        try {
            const prefs = await this.orm.call("dashboard.data", "get_user_preferences", []);
            if (prefs) {
                this.state.userPrefs = Object.assign({}, this.state.userPrefs, prefs);
                this.state.refreshMins = Number(prefs.refresh_mins) || 5;
                this.state.autoRefresh = !!prefs.auto_refresh;
                this.state.themeColor = prefs.accent_color || this.state.themeColor;
                this.state.darkMode = !!prefs.dark_mode;
                try { localStorage.setItem('eagle_dark_mode', this.state.darkMode ? '1' : '0'); } catch(e) {}
            }
        } catch (e) {
            // Preferences are optional; retain safe defaults.
            console.error('Dashboard preferences load error:', e);
        }
    }

    async loadAll() {
        this.state.loading = true;
        this._loadErrors = [];
        try {
            const [data, widgets, vis, trend, aging, ops, cust, fin, notes, company, stage23, control] = await Promise.all([
                this._safeRpc("dashboard.data","get_dashboard",[this.state.from_date||false,this.state.to_date||false],{quotations:[],orders:[],purchases:[],rfq:[],transactions:[]},'Core data'),
                this._safeRpc("dashboard.data","get_business_widgets",[],{overdue_count:0,overdue_amount:0,due_soon_count:0,due_soon_amount:0,top_customers:[],month_sales:0,sales_target:0,low_stock:[]},'Business KPIs'),
                this._safeRpc("dashboard.data","get_visibility",[],{role:this.state.role,visibility:{},section_labels:{},all_defaults:{}},'Visibility'),
                this._safeRpc("dashboard.data","get_trend_data",[this.state.from_date||false,this.state.to_date||false,'sale',this.state.trendGranularity||'day'],[],'Trend'),
                this._safeRpc("dashboard.data","get_aging_report",[],{ar:[],ap:[]},'Aging'),
                this._safeRpc("dashboard.data","get_operations_data",[],{pending_deliveries:[],mismatch:[],stock_value:0},'Operations'),
                this._safeRpc("dashboard.data","get_customer_intelligence",[this.state.from_date||false,this.state.to_date||false],{new:0,returning:0,total:0,clv:[]},'Customers'),
                this._safeRpc("dashboard.data","get_financial_controls",[this.state.from_date||false,this.state.to_date||false],{},'Financial controls'),
                this._safeRpc("dashboard.data","get_team_notes",[],this.state.teamNotes||'','Team notes'),
                this._safeRpc("dashboard.data","get_company_info",[],{name:'',id:0},'Company'),
                this._safeRpc("dashboard.data","get_management_insights",[this.state.from_date||false,this.state.to_date||false,this.state.dailyClosingDate||false],{},'Management analytics'),
                this._safeRpc("dashboard.data","get_control_center",[this.state.from_date||false,this.state.to_date||false],{},'Control center'),
            ]);

            this._orderLines={}; this._purchaseLines={};
            const strip=(map,arr)=>arr.map(r=>{map[r.id]=r.lines||[];const{lines,...rest}=r;return rest;});
            this.state.quotations   = strip(this._orderLines,   data.quotations||[]);
            this.state.orders       = strip(this._orderLines,   data.orders||[]);
            this.state.purchases    = strip(this._purchaseLines, data.purchases||[]);
            this.state.rfq          = strip(this._purchaseLines, data.rfq||[]);
            this.state.transactions = data.transactions||[];

            Object.assign(this.state, {
                overdue_count:widgets.overdue_count, overdue_amount:widgets.overdue_amount,
                due_soon_count:widgets.due_soon_count, due_soon_amount:widgets.due_soon_amount,
                top_customers:widgets.top_customers, month_sales:widgets.month_sales,
                sales_target:widgets.sales_target, low_stock:widgets.low_stock,
                trend_data: trend||[], aging: aging||{ar:[],ap:[]},
                operations: ops||{pending_deliveries:[],mismatch:[],stock_value:0},
                customers:  cust||{new:0,returning:0,total:0,clv:[]},
                financial:  fin||{},
                management:  stage23 ? (stage23.sales_performance ? {sales_performance: stage23.sales_performance, product_profitability: stage23.product_profitability||[], inventory_risk: stage23.inventory_risk||[]} : {sales_performance:{}, product_profitability:[], inventory_risk:[]}) : {sales_performance:{},product_profitability:[],inventory_risk:[]},
                warehouseComparison: stage23 ? (stage23.warehouse_comparison||[]) : [],
                dailyClosing: stage23 ? (stage23.daily_closing||this.state.dailyClosing) : this.state.dailyClosing,
                actionCenter: control && control.action_center ? control.action_center : this.state.actionCenter,
                // Stage 4 control-center payload now also contains Stage 5.
                ultimate: control && control.ultimate ? control.ultimate : this.state.ultimate,
                executive: control && control.executive ? control.executive : this.state.executive,
                role:       vis.role,
                visibility: vis.visibility||{},
                section_labels: vis.section_labels||{},
                all_defaults:   vis.all_defaults||{},
                teamNotes:      notes||'',
                companyName:    company ? company.name : '',
                companyId:      company ? company.id : 0,
            });

            const pm={};
            [...this.state.quotations,...this.state.orders,...this.state.purchases,...this.state.rfq,...this.state.transactions]
                .forEach(r=>{if(r.partner_id&&r.partner) pm[r.partner_id]=r.partner;});
            this.state.partnerOptions=Object.entries(pm).map(([id,name])=>({id:String(id),name})).sort((a,b)=>a.name.localeCompare(b.name));
            if(this.state.sortKey) this._applySort();

            // Animated counters
            this._animateValue('overdue_count', widgets.overdue_count||0);
            this._animateValue('due_soon_count', widgets.due_soon_count||0);
            this._animateValue('month_sales', Math.round(widgets.month_sales||0));

            // Push notification checks
            this._checkPushAlerts(widgets);
        } catch(e) {
            this._loadErrors = this._loadErrors || [];
            this._loadErrors.push("Dashboard core");
            console.error("Dashboard load error:",e);
        } finally {
            this.state.loadErrors = [...new Set(this._loadErrors || [])];
            this.state.lastUpdated = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
            this.state.loading = false;
        }
    }

    async retryLoad() { await this.loadAll(); }

    // ── Load the lighter "attractive pack" widgets in parallel ─────────────
    async loadAttractivePack() {
        try {
            const [nl, bw, bundles, streak, theme, online] = await Promise.all([
                this.orm.call("dashboard.data","get_nl_summary",[]),
                this.orm.call("dashboard.data","get_best_worst_day",[this.state.from_date||false,this.state.to_date||false]),
                this.orm.call("dashboard.data","get_product_bundles",[]),
                this.orm.call("dashboard.data","get_streak",[]),
                this.orm.call("dashboard.data","get_theme_color",[]),
                this.orm.call("dashboard.data","get_online_users",[]),
            ]);
            this.state.nlSummary = nl || '';
            this.state.bestWorstDay = bw || {best:null,worst:null};
            this.state.productBundles = bundles || [];
            this.state.streak = streak ? streak.streak : 0;
            this.state.dailyTarget = streak ? streak.daily_target : 0;
            this.state.themeColor = this.state.userPrefs.accent_color || theme || '#4f5bd5';
            this.state.onlineUsers = online || [];
            if (this.targetPct >= 100 && !this._confettiShown) {
                this._confettiShown = true;
                this._fireConfetti();
            }
        } catch(e) { console.error("Attractive pack load error:", e); }
    }

    // ── Partner filter (with hierarchy: parent/child) ───────────────────────
    _ok(r) {
        const q=this.state.partner_filter.trim().toLowerCase(), pid=this.state.partner_id_filter;
        let nameOk;
        if (!q) {
            nameOk = true;
        } else if (this.state.includeChildContacts) {
            nameOk = (r.partner||'').toLowerCase().includes(q) || (r.partner_parent||'').toLowerCase().includes(q);
        } else {
            nameOk = (r.partner||'').toLowerCase().includes(q);
        }
        const idOk = !pid || String(r.partner_id)===pid;
        return nameOk && idOk;
    }
    toggleIncludeChildContacts() { this.state.includeChildContacts = !this.state.includeChildContacts; }
    get filteredOrders()       { return this.state.orders.filter(r=>this._ok(r)); }
    get filteredPurchases()    { return this.state.purchases.filter(r=>this._ok(r)); }
    get filteredQuotations()   { return this.state.quotations.filter(r=>this._ok(r)); }
    get filteredRfq()          { return this.state.rfq.filter(r=>this._ok(r)); }
    get filteredTransactions() { return this.state.transactions.filter(r=>this._ok(r)); }

    formatAmount(value) { const n=parseFloat(value); return Number.isFinite(n) ? n.toFixed(2) : '0.00'; }
    getSectionLabelEntries() { return Object.entries(this.state.section_labels || {}); }
    absAmount(value) { const n=parseFloat(value); return Number.isFinite(n) ? Math.abs(n) : 0; }
    roundPercent(a,b) { const x=parseFloat(a)||0, y=parseFloat(b)||0; return y ? Math.round(x/y*100) : 0; }

    // ── Stage 4 control center ───────────────────────────────────────────
    toggleStage4(key) {
        if (Object.prototype.hasOwnProperty.call(this.state.stage4Open, key)) {
            this.state.stage4Open[key] = !this.state.stage4Open[key];
        }
    }
    toggleExecutive() { this.state.executiveOpen = !this.state.executiveOpen; }
    openExecutiveAnomalies() { this._newTab('sale.order',[['state','in',['sale','done']],['amount_total','>',0]],'Sales Anomalies Review'); }
    openExecutiveAudit() { this._newTab('dashboard.audit.event',[['company_id','=',this.state.companyId]],'Dashboard Audit Trail'); }
    openExecutiveReorder() { this._newTab('product.product',[['active','=',true],['type','in',['product','consu']]],'Inventory Reorder Review'); }
    toggleUltimateTable(key) {
        if (Object.prototype.hasOwnProperty.call(this.state.ultimateTablesOpen, key)) {
            this.state.ultimateTablesOpen[key] = !this.state.ultimateTablesOpen[key];
        }
    }
    toggleUltimate() { this.state.ultimateOpen = !this.state.ultimateOpen; }
    openUltimateProduct(id) { if (id) this._openTab('product.product', id); }
    openUltimatePartner(id) { if (id) this._openTab('res.partner', id); }
    openUltimateOrder(id) { if (id) this._openTab('sale.order', id); }
    openUltimateRefunds() { this._newTab('account.move',[['move_type','=','out_refund'],['state','=','posted']],'Customer Refunds'); }
    openUltimateReconciliation() { this._newTab('account.bank.statement.line',[['is_reconciled','=',false],['journal_id.type','in',['bank','cash']]],'Unreconciled Bank/Cash Lines'); }
    openUltimateApprovals() { this._newTab('sale.order',[['state','=','draft']],'Pending Sale Approvals'); }
    printManagementPack() {
        const u=this.state.ultimate||{};
        const tc=u.today_change||{}; const dq=u.data_quality||{}; const rec=u.reconciliation||{}; const ret=u.returns||{};
        const rows=(u.can_manage? (u.salespeople||[]).map(r=>`<tr><td>${this._esc(r.name)}</td><td style=\"text-align:right\">${r.orders}</td><td style=\"text-align:right\">BDT ${this.formatAmount(r.sales)}</td></tr>`).join('') : '<tr><td colspan=3>Restricted</td></tr>');
        const style=Array.from(document.querySelectorAll('link[rel=\"stylesheet\"]')).map(l=>`<link rel=\"stylesheet\" href=\"${l.href}\">`).join('');
        const pw=window.open('','_blank','width=1100,height=800'); if(!pw)return;
        pw.document.write(`<!doctype html><html><head><meta charset=\"utf-8\"><title>Management Pack</title>${style}<style>body{font-family:sans-serif;padding:24px;color:#111827}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin-top:22px;border-bottom:2px solid #1a1f36;padding-bottom:4px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.k{border:1px solid #e5e7eb;padding:10px;border-radius:6px}.k b{display:block;font-size:18px;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left}@media print{@page{size:A4;margin:10mm}}</style></head><body><h1>Management Control Pack</h1><div>Period: ${this._esc(u.period?.from_date||'')} — ${this._esc(u.period?.to_date||'')}</div><h2>Today vs Yesterday</h2><div class=\"grid\"><div class=\"k\">Sales Today<b>BDT ${this.formatAmount(tc.sales_today)}</b></div><div class=\"k\">Sales Change<b>${tc.sales_change_pct===null?'—':tc.sales_change_pct+'%'}</b></div><div class=\"k\">Customer Received<b>BDT ${this.formatAmount(tc.received_today)}</b></div><div class=\"k\">Vendor Paid<b>BDT ${this.formatAmount(tc.paid_today)}</b></div></div><h2>Returns</h2><div>Refunds: ${ret.count||0} · BDT ${this.formatAmount(ret.amount)}</div><h2>Reconciliation</h2><div>Unreconciled lines: ${rec.unreconciled_count||0} · In-process payments: ${rec.in_process_count||0}</div><h2>Data Quality</h2><div>Barcode: ${dq.missing_product_barcode||0} · Category: ${dq.missing_product_category||0} · Sale Price: ${dq.non_positive_sale_price||0} · Negative Stock: ${dq.negative_stock_quants||0} · Customer Email: ${dq.customer_missing_email||0}</div><h2>Salesperson Performance</h2><table><thead><tr><th>Salesperson</th><th>Orders</th><th>Sales</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
        pw.document.close(); pw.onload=()=>{try{pw.focus();pw.print();pw.close();}catch(e){}}; setTimeout(()=>{try{pw.focus();pw.print();pw.close();}catch(e){}},1200);
    }
    _esc(value) { return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch])); }
    openActionCenterCard(card) {
        if (!card || !card.model) return;
        this._newTab(card.model, card.domain || [], card.label || 'Action Center');
    }
    get actionCenterCards() { return this.state.actionCenter.cards || []; }

    // ── Stage 2 + 3 management analytics ────────────────────────────────
    toggleStageTable(key) {
        if (Object.prototype.hasOwnProperty.call(this.state.stageTablesOpen, key)) {
            this.state.stageTablesOpen[key] = !this.state.stageTablesOpen[key];
        }
    }
    async onDailyClosingDateChange(ev) {
        this.state.dailyClosingDate = ev.target.value || new Date().toISOString().split('T')[0];
        try {
            const data = await this.orm.call("dashboard.data","get_management_insights",[
                this.state.from_date||false,this.state.to_date||false,this.state.dailyClosingDate
            ]);
            this.state.dailyClosing = data ? (data.daily_closing||this.state.dailyClosing) : this.state.dailyClosing;
        } catch (e) {
            console.error("Daily closing load error:", e);
        }
    }
    openManagementProduct(id) { this._openTab('product.product', id); }

    printDailyClosing() {
        const d = this.state.dailyClosing || {};
        const pw = window.open('', '_blank', 'width=1100,height=800');
        if (!pw) return;
        const money = v => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n.toFixed(2) : '0.00';
        };
        const moves = d.journal_moves || [];
        const rows = moves.map(r => `<tr><td>${String(r.journal_name||'')}</td><td class="num">${r.balance_masked?'••••••':money(r.opening)}</td><td class="num in">${money(r.deposit)}</td><td class="num out">${money(r.withdraw)}</td><td class="num">${r.change>=0?'+':''}${money(r.change)}</td><td class="num">${r.balance_masked?'••••••':money(r.closing)}</td></tr>`).join('');
        pw.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Daily Closing ${d.date||''}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111827}h1{margin:0 0 4px}h2{margin:24px 0 8px;font-size:16px;border-bottom:2px solid #111827;padding-bottom:4px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.box{border:1px solid #d1d5db;padding:10px;border-radius:8px}.lbl{font-size:11px;color:#6b7280}.val{font-size:18px;font-weight:700;margin-top:4px}.num{text-align:right;font-variant-numeric:tabular-nums}.in{color:#059669}.out{color:#dc2626}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;border-bottom:1px solid #e5e7eb}th{background:#1a1f36;color:#fff;text-align:left}@media print{@page{size:A4 landscape;margin:12mm}body{padding:0}}</style></head><body><h1>Daily Closing</h1><div>Business Dashboard · ${d.date||''}</div><div class="grid" style="margin-top:16px"><div class="box"><div class="lbl">Sales</div><div class="val">BDT ${money(d.sales_amount)}</div><div class="lbl">${d.sales_orders||0} order(s)</div></div><div class="box"><div class="lbl">Customer Received</div><div class="val">BDT ${money(d.customer_received)}</div><div class="lbl">${d.customer_payments||0} payment(s)</div></div><div class="box"><div class="lbl">Vendor Paid</div><div class="val">BDT ${money(d.vendor_paid)}</div><div class="lbl">${d.vendor_payments||0} payment(s)</div></div><div class="box"><div class="lbl">Net Cash Movement</div><div class="val">BDT ${money(d.net_cash_movement)}</div></div></div><h2>Documents & Operations</h2><div class="grid"><div class="box"><div class="lbl">Customer Invoices</div><div class="val">${d.customer_invoices||0} · BDT ${money(d.customer_invoice_amount)}</div></div><div class="box"><div class="lbl">Vendor Bills</div><div class="val">${d.vendor_bills||0} · BDT ${money(d.vendor_bill_amount)}</div></div><div class="box"><div class="lbl">Deliveries Done</div><div class="val">${d.deliveries_done||0}</div></div><div class="box"><div class="lbl">Receipts Done</div><div class="val">${d.receipts_done||0}</div></div></div><p style="margin-top:10px">Internal Transfers Done: <b>${d.internal_transfers_done||0}</b> · Draft Payments: <b>${d.draft_payments||0}</b> · Pending Deliveries: <b>${d.pending_deliveries||0}</b> · Pending Receipts: <b>${d.pending_receipts||0}</b></p><h2>Journal Movement</h2><table><thead><tr><th>Journal</th><th>Previous</th><th>Deposit</th><th>Withdraw</th><th>Change</th><th>New Balance</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
        pw.document.close();
        setTimeout(()=>{ try { pw.focus(); pw.print(); pw.close(); } catch(e) {} }, 500);
    }

    // ── Quick search ──────────────────────────────────────────────────────
    onQuickSearch(ev) {
        this.state.quickSearch = ev.target.value;
        this.state.showSearchResults = ev.target.value.trim().length > 1;
    }
    closeSearch() { setTimeout(()=>{ this.state.showSearchResults=false; }, 200); }
    get quickSearchResults() {
        const q = this.state.quickSearch.trim().toLowerCase();
        if (!q) return {};
        const match = r => (r.name||'').toLowerCase().includes(q) || (r.partner||'').toLowerCase().includes(q);
        return {
            orders:       this.state.orders.filter(match).slice(0,5),
            purchases:    this.state.purchases.filter(match).slice(0,5),
            transactions: this.state.transactions.filter(match).slice(0,5),
        };
    }
    get quickSearchHasResults() {
        const r=this.quickSearchResults;
        return (r.orders||[]).length+(r.purchases||[]).length+(r.transactions||[]).length > 0;
    }

    // ── Sorting ───────────────────────────────────────────────────────────
    sortTransactions(key){this.state.sortOrder=this.state.sortKey===key?(this.state.sortOrder==='asc'?'desc':'asc'):'asc';this.state.sortKey=key;this._applySort();}
    _applySort(){const k=this.state.sortKey,o=this.state.sortOrder==='asc'?1:-1;this.state.transactions.sort((a,b)=>{let vA=a[k]??'',vB=b[k]??'';return(typeof vA==='number'&&typeof vB==='number')?(vA-vB)*o:vA.toString().localeCompare(vB.toString())*o;});}
    get showDateColumn(){const{from_date,to_date}=this.state;return!(from_date&&to_date&&from_date===to_date);}

    // ── Totals ────────────────────────────────────────────────────────────
    _sum(arr,f){return arr.reduce((s,r)=>s+(r[f]||0),0).toFixed(2);}
    get txTotalReceived(){return this._sum(this.filteredTransactions,'received');}
    get txTotalPaid()    {return this._sum(this.filteredTransactions,'paid');}

    // ── Animated counter display values (fallback logic kept in JS since
    //    OWL's template expression parser doesn't support '??') ──
    get animOverdueCount()  { return this.state.animCounters.overdue_count !== undefined ? this.state.animCounters.overdue_count : this.state.overdue_count; }
    get animDueSoonCount()  { return this.state.animCounters.due_soon_count !== undefined ? this.state.animCounters.due_soon_count : this.state.due_soon_count; }
    get animMonthSales()    { return this.state.animCounters.month_sales !== undefined ? this.state.animCounters.month_sales : Math.round(this.state.month_sales); }

    // ── Sales trend graph ─────────────────────────────────────────────────
    get trendPeriods() {
        return [
            {key:'day', label:'Day'},
            {key:'week', label:'Week'},
            {key:'month', label:'Month'},
            {key:'quarter', label:'Quarter'},
            {key:'year', label:'Year'},
        ];
    }
    setTrendGranularity(granularity) {
        if (!['day','week','month','quarter','year'].includes(granularity)) return;
        if (this.state.trendGranularity === granularity) return;
        this.state.trendGranularity = granularity;
        this.loadAll();
    }
    onTrendPeriodClick(ev) {
        const granularity = ev && ev.currentTarget ? ev.currentTarget.dataset.granularity : '';
        this.setTrendGranularity(granularity);
    }
    get trendChartWidth() { return 820; }
    get trendChartHeight() { return 300; }
    get trendPlotLeft() { return 58; }
    get trendPlotRight() { return 18; }
    get trendPlotTop() { return 18; }
    get trendPlotBottom() { return 48; }
    get trendPlotWidth() { return this.trendChartWidth - this.trendPlotLeft - this.trendPlotRight; }
    get trendPlotHeight() { return this.trendChartHeight - this.trendPlotTop - this.trendPlotBottom; }
    get trendAmounts() { return (this.state.trend_data || []).map(d => Number(d.amount) || 0); }
    get trendRawMax() {
        const vals = this.trendAmounts;
        return vals.length ? Math.max.apply(null, vals.concat([0])) : 0;
    }
    _niceStep(value) {
        if (value <= 0) return 1;
        const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
        const normalized = value / magnitude;
        const base = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
        return base * magnitude;
    }
    get trendYMax() {
        const raw = this.trendRawMax;
        if (!raw) return 1;
        const step = this._niceStep(raw / 5);
        return Math.max(step, Math.ceil(raw / step) * step);
    }
    get trendYTicks() {
        const max = this.trendYMax;
        const ticks = [];
        for (let i=0; i<=5; i++) {
            const value = max * (1 - i / 5);
            ticks.push({key:`y${i}`, value, y:this.trendPlotTop + (this.trendPlotHeight * i / 5)});
        }
        return ticks;
    }
    _trendDate(iso) {
        const p = String(iso || '').split('-').map(Number);
        return p.length === 3 && p[0] && p[1] && p[2] ? new Date(p[0], p[1]-1, p[2]) : null;
    }
    _isoWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const day = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }
    trendAxisLabel(iso) {
        const d = this._trendDate(iso);
        if (!d) return String(iso || '');
        const g = this.state.trendGranularity;
        const month = d.toLocaleString('default', {month:'short'});
        const year = d.getFullYear();
        if (g === 'day') return `${month} ${String(d.getDate()).padStart(2,'0')}`;
        if (g === 'week') return `W${this._isoWeekNumber(d)} · ${month} ${String(d.getDate()).padStart(2,'0')}`;
        if (g === 'month') return `${month} ${year}`;
        if (g === 'quarter') return `Q${Math.floor(d.getMonth()/3)+1} ${year}`;
        return String(year);
    }
    trendFullLabel(iso) {
        const d = this._trendDate(iso);
        if (!d) return String(iso || '');
        const month = d.toLocaleString('default', {month:'long'});
        const year = d.getFullYear();
        if (this.state.trendGranularity === 'day') return `${month} ${d.getDate()}, ${year}`;
        if (this.state.trendGranularity === 'week') return `Week ${this._isoWeekNumber(d)}, starting ${month} ${d.getDate()}, ${year}`;
        if (this.state.trendGranularity === 'month') return `${month} ${year}`;
        if (this.state.trendGranularity === 'quarter') return `Q${Math.floor(d.getMonth()/3)+1} ${year}`;
        return String(year);
    }
    formatTrendCompact(value) {
        const n = Number(value) || 0;
        const a = Math.abs(n);
        if (a >= 1000000000) return `${(n/1000000000).toFixed(1)}B`;
        if (a >= 1000000) return `${(n/1000000).toFixed(1)}M`;
        if (a >= 1000) return `${(n/1000).toFixed(a >= 10000 ? 0 : 1)}K`;
        return n.toFixed(0);
    }
    get trendChartPoints() {
        const data = this.state.trend_data || [];
        if (!data.length) return [];
        const max = this.trendYMax || 1;
        const denom = Math.max(data.length - 1, 1);
        return data.map((d, index) => {
            const amount = Number(d.amount) || 0;
            const x = this.trendPlotLeft + (index / denom) * this.trendPlotWidth;
            const y = this.trendPlotTop + this.trendPlotHeight - (amount / max) * this.trendPlotHeight;
            return {key:`${d.date}_${index}`, date:d.date, amount, x, y, label:this.trendAxisLabel(d.date), fullLabel:this.trendFullLabel(d.date)};
        });
    }
    get trendPolyline() { return this.trendChartPoints.map(p => `${p.x},${p.y}`).join(' '); }
    get trendAreaPoints() {
        const pts = this.trendChartPoints;
        if (!pts.length) return '';
        const bottom = this.trendPlotTop + this.trendPlotHeight;
        return `${pts[0].x},${bottom} ${pts.map(p => `${p.x},${p.y}`).join(' ')} ${pts[pts.length-1].x},${bottom}`;
    }
    shouldShowTrendXLabel(index) {
        const n = this.trendChartPoints.length;
        if (n <= 10) return true;
        if (n <= 20) return index % 2 === 0 || index === n-1;
        const step = Math.ceil(n / 8);
        return index % step === 0 || index === n-1;
    }
    get trendSummary() {
        const n = (this.state.trend_data || []).length;
        const total = this.trendAmounts.reduce((s, v) => s + v, 0);
        return {points:n, total};
    }

    // ── Sales target progress ─────────────────────────────────────────────
    get targetPct() {
        if (!this.state.sales_target) return 0;
        return Math.min(100, Math.round((this.state.month_sales / this.state.sales_target) * 100));
    }
    get multiPeriodVsPrev() {
        const f=this.state.financial,cur=f.current_sales||0,prv=f.previous_sales||0;
        if(!prv) return 0;
        return Math.round((cur-prv)/prv*100);
    }
    get multiPeriodPositive() { return this.multiPeriodVsPrev>=0; }

    // ── Auto-refresh ──────────────────────────────────────────────────────
    toggleAutoRefresh(){this.state.autoRefresh=!this.state.autoRefresh;this.state.autoRefresh?this._startRefresh():this._stopRefresh();}
    onRefreshMinsChange(ev){this.state.refreshMins=Number(ev.target.value);if(this.state.autoRefresh){this._stopRefresh();this._startRefresh();}}
    _startRefresh(){this._stopRefresh();this._refreshTimer=setInterval(()=>this.loadAll(),this.state.refreshMins*60000);}
    _stopRefresh(){if(this._refreshTimer){clearInterval(this._refreshTimer);this._refreshTimer=null;}}

    // ── Team notes (with @mention notifications) ───────────────────────────
    async saveNotes() {
        const res = await this.orm.call("dashboard.data","save_team_notes_with_mentions",[this.state.teamNotes]);
        this.state.notesSaved=true;
        if (res && res.notified && res.notified.length) {
            this.state.notesMentioned = res.notified;
        }
        setTimeout(()=>{this.state.notesSaved=false; this.state.notesMentioned=null;},3000);
    }

    // ── Personal customization ───────────────────────────────────────────
    openCustomize() {
        this.state.customizeDraft = JSON.parse(JSON.stringify(this.state.userPrefs || {}));
        this.state.customizeSaved = false;
        this.state.showCustomize = true;
    }
    closeCustomize() { this.state.showCustomize = false; }
    applyWorkspacePreset(name) {
        const presets = {
            executive: ['notes','clv','orders','purchases','quotations','rfq','transactions','analytics','customers'],
            finance: ['operations','customers','clv','product_profitability','inventory_risk','warehouse_comparison','sales_performance'],
            sales: ['financial','aging','journal','journal_summary','transactions','warehouse_comparison','daily_closing','reconciliation'],
            operations: ['financial','aging','journal','journal_summary','transactions','product_profitability','clv','customers'],
            minimal: ['analytics','chart','operations','customers','aging','financial','notes','journal','journal_summary','transactions','clv','sales_performance','product_profitability','inventory_risk','warehouse_comparison','daily_closing'],
            all: [],
        };
        if (!Object.prototype.hasOwnProperty.call(presets, name)) return;
        this.state.customizeDraft.hidden_sections = [...presets[name]];
        this.state.customizeDraft.workspace = name;
    }

    toggleCustomSection(key) {
        const list = this.state.customizeDraft.hidden_sections || [];
        const idx = list.indexOf(key);
        if (idx >= 0) list.splice(idx, 1); else list.push(key);
        this.state.customizeDraft.hidden_sections = list;
    }
    isCustomSectionVisible(key) { return !(this.state.customizeDraft.hidden_sections || []).includes(key); }
    async saveCustomize() {
        this.state.customizeBusy = true;
        try {
            const saved = await this.orm.call("dashboard.data", "save_user_preferences", [this.state.customizeDraft]);
            this.state.userPrefs = Object.assign({}, this.state.userPrefs, saved || this.state.customizeDraft);
            this.state.themeColor = this.state.userPrefs.accent_color || this.state.themeColor;
            this.state.darkMode = !!this.state.userPrefs.dark_mode;
            this.state.refreshMins = Number(this.state.userPrefs.refresh_mins) || 5;
            this.state.autoRefresh = !!this.state.userPrefs.auto_refresh;
            try { localStorage.setItem('eagle_dark_mode', this.state.darkMode ? '1' : '0'); } catch(e) {}
            if (this.state.autoRefresh) this._startRefresh(); else this._stopRefresh();
            this.state.customizeSaved = true;
            setTimeout(() => { this.state.customizeSaved = false; this.state.showCustomize = false; }, 600);
        } catch (e) { console.error('Save dashboard customization error:', e); }
        finally { this.state.customizeBusy = false; }
    }
    async resetCustomize() {
        const prefs = await this.orm.call("dashboard.data", "reset_user_preferences", []);
        this.state.userPrefs = Object.assign({}, this.state.userPrefs, prefs || {});
        this.state.customizeDraft = JSON.parse(JSON.stringify(this.state.userPrefs));
        this.state.themeColor = this.state.userPrefs.accent_color || '#4f5bd5';
        this.state.darkMode = !!this.state.userPrefs.dark_mode;
        this.state.refreshMins = Number(this.state.userPrefs.refresh_mins) || 5;
        this.state.autoRefresh = !!this.state.userPrefs.auto_refresh;
        if (this.state.autoRefresh) this._startRefresh(); else this._stopRefresh();
    }

    // ── Dashboard health / self diagnostics ────────────────────────────────
    async openHealth() {
        if (!this.isAdminOrManager) return;
        this.state.showHealth = true;
        this.state.healthLoading = true;
        try { this.state.health = await this.orm.call("dashboard.data", "get_dashboard_health", []); }
        catch (e) { this.state.health = {allowed:false,checks:[],generated_at:''}; console.error('Health check error:', e); }
        finally { this.state.healthLoading = false; }
    }
    closeHealth() { this.state.showHealth = false; }

    // ── Settings ─────────────────────────────────────────────────────────
    openSettings() {
        const ad = this.state.all_defaults;
        this.state.settingsDraft = JSON.parse(JSON.stringify(ad));
        try {
            const stored = this.state._storedConfig;
            if(stored) Object.keys(stored).forEach(role=>{ if(this.state.settingsDraft[role]) Object.assign(this.state.settingsDraft[role],stored[role]); });
        } catch(e){}
        this.orm.call("dashboard.approval.config","get_config",[]).then(q => {
            this.state.approvalThresholds = {sale_threshold:q.sale_threshold, purchase_threshold:q.purchase_threshold};
        }).catch(()=>{});
        this.state.showSettings=true;
    }
    closeSettings(){ this.state.showSettings=false; }
    toggleSetting(role,key){ if(this.state.settingsDraft[role]) this.state.settingsDraft[role][key]=!this.state.settingsDraft[role][key]; }
    async saveSettings(){
        await this.orm.call("dashboard.data","save_visibility",[this.state.settingsDraft]);
        await this.orm.call("dashboard.approval.config","set_config",
            [this.state.approvalThresholds.sale_threshold||0, this.state.approvalThresholds.purchase_threshold||0])
            .catch(()=>{});
        await this.saveThemeColor().catch(()=>{});
        this.state.settingsSaved=true;
        setTimeout(()=>{this.state.settingsSaved=false;this.state.showSettings=false;this.loadAll();},1200);
    }

    // ── Target modal ──────────────────────────────────────────────────────
    openTargetModal(){this.state.targetInput=String(this.state.sales_target||'');this.state.showTargetModal=true;}
    closeTargetModal(){this.state.showTargetModal=false;}
    async saveTarget(){const val=parseFloat(this.state.targetInput)||0;await this.orm.call("dashboard.data","save_sales_target",[val]);this.state.sales_target=val;this.state.showTargetModal=false;}

    // ── Export ────────────────────────────────────────────────────────────
    _writeCSV(rows,filename){if(!rows||!rows.length)return;const keys=Object.keys(rows[0]);const lines=[keys.join(','),...rows.map(r=>keys.map(k=>`"${String(r[k]??'').replace(/"/g,'""')}"`).join(','))];const blob=new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);}
    _exportPrompt(type){this.state.exportPromptType=type;this.state.showExportPrompt=true;}
    exportOrders()   {this._exportPrompt('orders');}
    exportPurchases(){this._exportPrompt('purchases');}
    exportQuotes()   {this._exportPrompt('quotations');}
    exportRfq()      {this._exportPrompt('rfq');}
    exportTx()       {this._exportPrompt('transactions');}
    closeExportPrompt(){this.state.showExportPrompt=false;}
    doExport(includeLines){
        const type=this.state.exportPromptType; this.state.showExportPrompt=false;
        const fmt=v=>{const n=parseFloat(v);return isNaN(n)?'':n.toFixed(2);};
        if(type==='transactions'){this._writeCSV(this.filteredTransactions.map(r=>({'Reference':r.name,'Partner':r.partner,'Date':r.date,'Ledger':r.ledger,'Received':fmt(r.received),'Paid':fmt(r.paid),'Status':r.state})),'transactions.csv');return;}
        const ds={orders:{records:this.filteredOrders,lineCache:this._orderLines,file:'orders.csv',extraCol:'Invoice Status',extraField:'invoice_status'},quotations:{records:this.filteredQuotations,lineCache:this._orderLines,file:'quotations.csv',extraCol:null},purchases:{records:this.filteredPurchases,lineCache:this._purchaseLines,file:'purchases.csv',extraCol:'Billing Status',extraField:'billing_status'},rfq:{records:this.filteredRfq,lineCache:this._purchaseLines,file:'rfq.csv',extraCol:null}};
        const d=ds[type]; const csvRows=[];
        for(const r of d.records){
            const row={'Row Type':'RECORD','Reference':r.name,'Partner':r.partner,'Date':r.date,'Status':r.status,'Amount':fmt(r.amount),'Product':'','Qty':'','UoM':'','Rate':'','Discount%':'','Tax':'','Line Total':''};
            if(d.extraCol) row[d.extraCol]=r[d.extraField]||'';
            csvRows.push(row);
            if(includeLines){
                const lines=d.lineCache[r.id]||[];
                for(const l of lines){
                    const lr={'Row Type':'LINE','Reference':r.name,'Partner':'','Date':'','Status':'','Amount':'','Product':l.product||'','Qty':fmt(l.qty),'UoM':l.uom||'','Rate':fmt(l.price_unit),'Discount%':fmt(l.discount),'Tax':l.tax||'','Line Total':fmt(l.subtotal)};
                    if(d.extraCol)lr[d.extraCol]='';
                    csvRows.push(lr);
                }
                if(lines.length){
                    const lt=lines.reduce((s,l)=>s+(parseFloat(l.subtotal)||0),0);
                    const sr={'Row Type':'SUBTOTAL','Reference':r.name,'Partner':'','Date':'','Status':`${lines.length} line(s)`,'Amount':fmt(r.amount),'Product':'','Qty':'','UoM':'','Rate':'','Discount%':'','Tax':'','Line Total':fmt(lt)};
                    if(d.extraCol)sr[d.extraCol]='';
                    csvRows.push(sr);
                }
            }
        }
        this._writeCSV(csvRows,d.file);
    }

    // ── Print ─────────────────────────────────────────────────────────────
    openPrintModal(){this.state.showPrintModal=true;}
    closePrintModal(){this.state.showPrintModal=false;}
    doPrint(){
        const incOrd=this.state.printOrderLines,incPur=this.state.printPurchaseLines,incTx=this.state.printTxDetails;
        const orders=this.filteredOrders.map(r=>({...r,lines:this._orderLines[r.id]||[]}));
        const purchases=this.filteredPurchases.map(r=>({...r,lines:this._purchaseLines[r.id]||[]}));
        const quotations=this.filteredQuotations.map(r=>({...r,lines:this._orderLines[r.id]||[]}));
        const rfq=this.filteredRfq.map(r=>({...r,lines:this._purchaseLines[r.id]||[]}));
        const txs=[...this.filteredTransactions];
        this.state.showPrintModal=false;
        const fmt=v=>{const n=parseFloat(v);return isNaN(n)?'0.00':n.toFixed(2);};
        const styles=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l=>`<link rel="stylesheet" href="${l.href}">`).join('');
        const buildTable=(records,cols,includeLines)=>{if(!records.length)return'<p style="color:#888;font-size:12px">No records.</p>';const ths=cols.map(c=>`<th style="background:#1a1f36;color:#fff;padding:8px 12px;font-size:11px;text-align:left">${c.label}</th>`).join('');let html=`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px"><thead><tr>${ths}</tr></thead><tbody>`;for(const r of records){const tds=cols.map(c=>`<td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${c.val(r)}</td>`).join('');html+=`<tr style="background:#fff">${tds}</tr>`;if(includeLines&&r.lines&&r.lines.length){const lh=['Product','Qty','Rate','Disc%','Tax','Total'].map(h=>`<th style="background:#f1f5f9;padding:4px 8px;font-size:10px;text-align:left">${h}</th>`).join('');const lb=r.lines.map(l=>`<tr><td style="padding:4px 8px;font-size:10px">${l.product}</td><td style="padding:4px 8px;font-size:10px;text-align:right">${fmt(l.qty)}</td><td style="padding:4px 8px;font-size:10px;text-align:right">${fmt(l.price_unit)}</td><td style="padding:4px 8px;font-size:10px;text-align:right">${fmt(l.discount)}</td><td style="padding:4px 8px;font-size:10px">${l.tax}</td><td style="padding:4px 8px;font-size:10px;text-align:right;font-weight:700">${fmt(l.subtotal)}</td></tr>`).join('');html+=`<tr><td colspan="${cols.length}" style="padding:2px 24px 10px"><table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb"><thead><tr>${lh}</tr></thead><tbody>${lb}</tbody></table></td></tr>`;}}return html+'</tbody></table>';};
        const ordCols=[{label:'Reference',val:r=>r.name},{label:'Partner',val:r=>r.partner},{label:'Date',val:r=>r.date},{label:'Status',val:r=>r.status},{label:'Inv.Status',val:r=>r.invoice_status||''},{label:'Amount',val:r=>fmt(r.amount)}];
        const purCols=[{label:'Reference',val:r=>r.name},{label:'Partner',val:r=>r.partner},{label:'Date',val:r=>r.date},{label:'Status',val:r=>r.status},{label:'Bill Status',val:r=>r.billing_status||''},{label:'Amount',val:r=>fmt(r.amount)}];
        const txCols=[{label:'Reference',val:r=>r.name},{label:'Partner',val:r=>r.partner},{label:'Date',val:r=>r.date},{label:'Ledger',val:r=>r.ledger},{label:'Received',val:r=>fmt(r.received)},{label:'Paid',val:r=>fmt(r.paid)},{label:'Status',val:r=>r.state}];
        const pw=window.open('','_blank','width=1200,height=800');
        pw.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Business Dashboard</title>${styles}<style>body{margin:0;padding:20px;font-family:sans-serif}h1{font-size:20px;color:#1a1f36;margin:0 0 4px}h2{font-size:14px;font-weight:700;color:#1a1f36;margin:20px 0 8px;padding-bottom:4px;border-bottom:2px solid #1a1f36}.period{font-size:11px;color:#6b7280;margin-bottom:16px}@media print{@page{margin:10mm;size:A4 landscape}body{font-size:10px;padding:0}}</style></head><body>
        <h1>Business Dashboard</h1><div class="period">Period: ${this.state.from_date||'All'} — ${this.state.to_date||'All'}</div>
        <h2>Orders (${orders.length})</h2>${buildTable(orders,ordCols,incOrd)}
        <h2>Purchase (${purchases.length})</h2>${buildTable(purchases,purCols,incPur)}
        <h2>Quotations (${quotations.length})</h2>${buildTable(quotations,ordCols.filter(c=>c.label!=='Inv.Status'),incOrd)}
        <h2>RFQ (${rfq.length})</h2>${buildTable(rfq,purCols.filter(c=>c.label!=='Bill Status'),incPur)}
        ${incTx?`<h2>Transactions (${txs.length})</h2>${buildTable(txs,txCols,false)}`:''}
        </body></html>`);
        pw.document.close();
        pw.onload=()=>{pw.focus();pw.print();pw.close();};
        setTimeout(()=>{try{pw.focus();pw.print();pw.close();}catch(e){}},1800);
    }

    // ── KPI card actions ──────────────────────────────────────────────────
    _today(){const d=new Date();return d.toISOString().split('T')[0];}
    _firstOfMonth(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;}
    async _newTab(model,domain,name){
        try {
            const actionId = await this.orm.call("dashboard.data","open_dynamic_action",[model,domain,name||'Dashboard List']);
            const t = window.open(`/odoo/action-${actionId}`,'_blank');
            if (t) t.focus();
        } catch(e) { console.error("Failed to open list:", e); }
    }
    openOverdueInvoices(){this._newTab('account.move',[["move_type","=","out_invoice"],["state","=","posted"],["payment_state","not in",["paid","in_payment"]],["invoice_date_due","<",this._today()]],'Overdue Invoices');}
    openDueSoonInvoices(){const d7=new Date();d7.setDate(d7.getDate()+7);this._newTab('account.move',[["move_type","=","out_invoice"],["state","=","posted"],["payment_state","not in",["paid","in_payment"]],["invoice_date_due",">=",this._today()],["invoice_date_due","<=",d7.toISOString().split('T')[0]]],'Invoices Due in 7 Days');}
    openMonthSales(){this._newTab('sale.order',[["state","=","sale"],["date_order",">=",this._firstOfMonth()],["date_order","<=",this._today()]],"This Month's Orders");}
    openLowStockList(){this._newTab('product.product',[["type","=","consu"],["qty_available","<=",5],["active","=",true]],'Low Stock Products');}
    openProduct(id){this._openTab('product.product',id);}

    // ── Create records from Business Dashboard ─────────────────────────────
    async createOrder() {
        await this.action.doAction({
            type: 'ir.actions.act_window',
            name: 'New Sales Order',
            res_model: 'sale.order',
            views: [[false, 'form']],
            target: 'current',
        });
        await this.loadAll();
    }

    async createPurchase() {
        await this.action.doAction({
            type: 'ir.actions.act_window',
            name: 'New Purchase Order',
            res_model: 'purchase.order',
            views: [[false, 'form']],
            target: 'current',
        });
        await this.loadAll();
    }

    async createPayment(type) {
        const partnerType = type === 'inbound' ? 'customer' : 'supplier';
        await this.action.doAction({
            type: 'ir.actions.act_window',
            name: type === 'inbound' ? 'Receive Money' : 'Send Money',
            res_model: 'account.payment',
            views: [[false, 'form']],
            target: 'current',
            context: {
                default_payment_type: type,
                default_partner_type: partnerType,
            },
        });
        await this.loadAll();
    }

    async validatePayment(id) {
        if (this.state.validatingPaymentId) return;
        this.state.validatingPaymentId = id;
        try {
            const result = await this.orm.call('dashboard.data', 'validate_payment', [id]);
            if (result && result.already_posted && result.message) {
                window.alert(result.message);
            }
            await this.loadAll();
        } catch (e) {
            console.error('Payment validation failed:', e);
            window.alert(e?.data?.message || e?.message || 'Unable to validate this payment.');
        } finally {
            this.state.validatingPaymentId = 0;
        }
    }

    // ── Low stock fold + snooze ──────────────────────────────────────────
    toggleLowStock() { this.state.lowStockExpanded = !this.state.lowStockExpanded; }
    openSnoozeModal(product, ev) {
        if (ev) ev.stopPropagation();
        this.state.snoozeProductId = product.id;
        this.state.snoozeProductName = product.name;
        this.state.snoozeWeeks = 1;
        this.state.showSnoozeModal = true;
    }
    closeSnoozeModal() { this.state.showSnoozeModal = false; }
    async confirmSnooze() {
        await this.orm.call("dashboard.data","snooze_low_stock_product",[this.state.snoozeProductId, this.state.snoozeWeeks]);
        this.state.showSnoozeModal = false;
        await this.loadAll();
    }

    // ══════════ BATCH 3: "MAKE IT ATTRACTIVE" PACK ══════════

    // ── Animated number counters ────────────────────────────────────────
    _animateValue(key, target, duration=700) {
        const start = this.state.animCounters[key] || 0;
        if (start === target) { this.state.animCounters[key] = target; return; }
        const startTime = performance.now();
        const step = (now) => {
            const progress = Math.min((now-startTime)/duration, 1);
            const eased = 1 - Math.pow(1-progress, 3);
            this.state.animCounters[key] = Math.round(start + (target-start)*eased);
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    // ── Confetti burst (target hit 100%) ────────────────────────────────
    _fireConfetti() {
        this.state.showConfetti = true;
        setTimeout(() => { this.state.showConfetti = false; }, 3000);
    }
    get confettiPieces() {
        const colors = ['#4f5bd5','#7c3aed','#10b981','#f59e0b','#ef4444','#3b82f6'];
        return Array.from({length: 40}, (_, i) => ({
            id: i, left: Math.random()*100, delay: Math.random()*0.6,
            color: colors[i % colors.length], duration: 2 + Math.random()*1.5,
        }));
    }

    // ── Live presence ────────────────────────────────────────────────────
    async heartbeatNow() {
        try {
            await this.orm.call("dashboard.data","heartbeat",[]);
            this.state.onlineUsers = await this.orm.call("dashboard.data","get_online_users",[]);
        } catch(e) { /* silent */ }
    }

    // ── Theme color ───────────────────────────────────────────────────────
    get themeStyle() { return `--eagle-accent:${this.state.themeColor};`; }
    onThemeColorChange(ev) { this.state.themeColor = ev.target.value; }
    async saveThemeColor() {
        await this.orm.call("dashboard.data","save_theme_color",[this.state.themeColor]);
    }

    // ── PWA manifest injection ──────────────────────────────────────────
    _injectPwaManifest() {
        try {
            if (!document.querySelector('link[rel="manifest"][data-eagle="1"]')) {
                const link = document.createElement('link');
                link.rel = 'manifest'; link.dataset.eagle = '1';
                link.href = '/eagle_business_dashboard/static/src/manifest/pwa_manifest.json';
                document.head.appendChild(link);
            }
            if (!document.querySelector('meta[name="theme-color"][data-eagle="1"]')) {
                const meta = document.createElement('meta');
                meta.name = 'theme-color'; meta.content = '#4f5bd5'; meta.dataset.eagle = '1';
                document.head.appendChild(meta);
            }
        } catch(e) { /* silent */ }
    }

    // ── Push notifications ───────────────────────────────────────────────
    async toggleNotifications() {
        if (!("Notification" in window)) return;
        if (Notification.permission === 'granted') {
            this.state.notificationsEnabled = !this.state.notificationsEnabled;
            return;
        }
        const perm = await Notification.requestPermission();
        this.state.notificationsEnabled = (perm === 'granted');
    }
    _checkPushAlerts(widgets) {
        if (!this.state.notificationsEnabled || !("Notification" in window) || Notification.permission !== 'granted') {
            this._prevOverdue = widgets.overdue_count; this._prevLowStockLen = (widgets.low_stock||[]).length;
            return;
        }
        if (this._prevOverdue !== null && widgets.overdue_count > this._prevOverdue) {
            new Notification('Dashboard Alert', { body: `Overdue invoices increased to ${widgets.overdue_count}` });
        }
        if (this._prevLowStockLen !== null && (widgets.low_stock||[]).length > this._prevLowStockLen) {
            new Notification('Dashboard Alert', { body: `A new product just hit low stock` });
        }
        this._prevOverdue = widgets.overdue_count;
        this._prevLowStockLen = (widgets.low_stock||[]).length;
    }

    // ── Comments on KPI cards ────────────────────────────────────────────
    async openKpiComments(key, label) {
        this.state.activeKpiKey = key; this.state.activeKpiLabel = label;
        this.state.newCommentText = '';
        this.state.showKpiComments = true;
        this.state.kpiComments = await this.orm.call("dashboard.data","get_kpi_comments",[key]);
    }
    closeKpiComments() { this.state.showKpiComments = false; }
    onKpiCommentKeydown(ev) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            this.addKpiComment();
        }
    }
    async addKpiComment() {
        if (!this.state.newCommentText.trim()) return;
        await this.orm.call("dashboard.data","add_kpi_comment",[this.state.activeKpiKey, this.state.newCommentText]);
        this.state.newCommentText = '';
        this.state.kpiComments = await this.orm.call("dashboard.data","get_kpi_comments",[this.state.activeKpiKey]);
    }

    // ── Shareable snapshot link ──────────────────────────────────────────
    async openShareModal() {
        const snapshot = {
            'Overdue Invoices': `${this.state.overdue_count} (BDT ${this.state.overdue_amount.toFixed(2)})`,
            'Due in 7 Days': `${this.state.due_soon_count} (BDT ${this.state.due_soon_amount.toFixed(2)})`,
            'Month Sales': `BDT ${this.state.month_sales.toFixed(2)}`,
            'Monthly Target': `${this.targetPct}%`,
        };
        const res = await this.orm.call("dashboard.data","create_snapshot_link",[snapshot, 48]);
        this.state.shareUrl = res.url;
        this.state.showShareModal = true;
    }
    closeShareModal() { this.state.showShareModal = false; }
    copyShareUrl() { try { navigator.clipboard.writeText(this.state.shareUrl); } catch(e) {} }

    // ── Command palette (Ctrl+K) ─────────────────────────────────────────
    _onKeyDown(ev) {
        if (this.state.userPrefs.keyboard_shortcuts === false) return;
        const tag = (ev.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target.isContentEditable;

        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
            ev.preventDefault();
            this.state.showCommandPalette = true;
            this.state.commandQuery = '';
            return;
        }
        if (ev.key === 'Escape' && this.state.showCommandPalette) {
            this.state.showCommandPalette = false; return;
        }
        if (typing || this.state.showCommandPalette) return;

        const k = ev.key.toLowerCase();
        if (k === 'r') this.createPayment('inbound');
        else if (k === 'p') this.createPayment('outbound');
        else if (k === 'n') this.createOrder();
        else if (k === 'f') this.goToFinanceDashboard();
        else if (k === 'o') this.goToOperationsDashboard();
        else if (k === 'd') this.toggleDarkMode();
    }
    closeCommandPalette() { this.state.showCommandPalette = false; }
    onCommandQueryChange(ev) { this.state.commandQuery = ev.target.value; }
    get commandActions() {
        const all = [
            {label:'New Order', icon:'fa-plus-circle', run:()=>this.createOrder()},
            {label:'New Purchase', icon:'fa-shopping-bag', run:()=>this.createPurchase()},
            {label:'Receive Payment', icon:'fa-arrow-down', run:()=>this.createPayment('inbound')},
            {label:'Make Payment', icon:'fa-arrow-up', run:()=>this.createPayment('outbound')},
            {label:'Go to Finance Dashboard', icon:'fa-line-chart', run:()=>this.goToFinanceDashboard()},
            {label:'Go to Operations Dashboard', icon:'fa-truck', run:()=>this.goToOperationsDashboard()},
            {label:'Toggle Dark Mode', icon:'fa-moon-o', run:()=>this.toggleDarkMode()},
            {label:'Print Dashboard', icon:'fa-print', run:()=>this.openPrintModal()},
            {label:'Share Snapshot', icon:'fa-share-alt', run:()=>this.openShareModal()},
        ];
        const q = this.state.commandQuery.trim().toLowerCase();
        return q ? all.filter(a => a.label.toLowerCase().includes(q)) : all;
    }
    runCommand(action) { this.state.showCommandPalette = false; action.run(); }

    // ── Recently viewed ──────────────────────────────────────────────────
    _pushRecentlyViewed(type, id, label) {
        let list = this.state.recentlyViewed.filter(r => !(r.type===type && r.id===id));
        list.unshift({type, id, label});
        list = list.slice(0, 5);
        this.state.recentlyViewed = list;
        try { localStorage.setItem('eagle_recent_business', JSON.stringify(list)); } catch(e) {}
    }
    openRecent(r) {
        if (r.type==='order') this.openOrder(r.id);
        else if (r.type==='purchase') this.openPurchase(r.id);
        else if (r.type==='partner') this.openPartner(r.id);
        else if (r.type==='transaction') this.openTransaction(r.id);
    }

    // ── Navigation ────────────────────────────────────────────────────────
    _openTab(model,id){const t=window.open(`/web#model=${model}&id=${id}&view_type=form`,'_blank');if(t)t.focus();}
    openOrder(id)      {this._openTab('sale.order',id); const r=this.state.orders.find(o=>o.id===id)||this.state.quotations.find(o=>o.id===id); this._pushRecentlyViewed('order',id,r?r.name:`Order #${id}`);}
    openPurchase(id)   {this._openTab('purchase.order',id); const r=this.state.purchases.find(o=>o.id===id)||this.state.rfq.find(o=>o.id===id); this._pushRecentlyViewed('purchase',id,r?r.name:`Purchase #${id}`);}
    openPartner(id)    {this._openTab('res.partner',id); this._pushRecentlyViewed('partner',id,'Partner');}
    openTransaction(id){this._openTab('account.payment',id); this._pushRecentlyViewed('transaction',id,'Transaction');}
    goToFinanceDashboard(){this._syncShared();this.action.doAction("eagle_business_dashboard.finance_dashboard_action");}
    goToOperationsDashboard(){this._syncShared();this.action.doAction("eagle_business_dashboard.operations_dashboard_action");}

    // ── Saved filter presets ──────────────────────────────────────────────
    async loadSavedFilters() {
        try { this.state.savedFilters = await this.orm.call("dashboard.data","get_saved_filters",['business']); }
        catch(e) { console.error(e); }
    }
    openSaveFilterPrompt() { this.state.filterNameInput=''; this.state.showSaveFilterPrompt=true; }
    closeSaveFilterPrompt(){ this.state.showSaveFilterPrompt=false; }
    async saveCurrentFilter() {
        if (!this.state.filterNameInput.trim()) return;
        await this.orm.call("dashboard.data","save_filter_preset",
            ['business', this.state.filterNameInput, this.state.from_date, this.state.to_date,
             this.state.partner_filter, this.state.active_preset]);
        this.state.showSaveFilterPrompt=false;
        await this.loadSavedFilters();
    }
    applySavedFilter(f) {
        this.state.from_date=f.from_date; this.state.to_date=f.to_date;
        this.state.partner_filter=f.partner_filter; this.state.active_preset=f.active_preset||'custom';
        this._syncShared(); this.loadAll();
    }
    async deleteSavedFilter(id, ev) {
        if (ev) ev.stopPropagation();
        await this.orm.call("dashboard.data","delete_filter_preset",[id]);
        await this.loadSavedFilters();
    }

    // ── Quick Sale ────────────────────────────────────────────────────────
    async openQuickSale() {
        this.state.quickSalePartner=''; this.state.quickSaleProduct='';
        this.state.quickSalePartnerSearch=''; this.state.quickSaleProductSearch='';
        this.state.quickSaleQty=1;
        this.state.quickSaleError=''; this.state.quickSaleSubmitting=false;
        this.state.showQuickSale=true;
        await this.searchQuickSaleProducts('');
    }
    closeQuickSale() {
        this.state.showQuickSale=false;
        if (this.state.quickSaleProductSearchTimer) {
            clearTimeout(this.state.quickSaleProductSearchTimer);
            this.state.quickSaleProductSearchTimer = null;
        }
    }

    async searchQuickSaleProducts(search='') {
        const seq = ++this.state.quickSaleProductSearchSeq;
        try {
            const results = await this.orm.call(
                "dashboard.data", "get_product_options", [search || '']
            );
            if (seq !== this.state.quickSaleProductSearchSeq || !this.state.showQuickSale) return;
            this.state.productOptions = results || [];
        } catch(e) {
            console.error("Failed to search products:", e);
            if (seq === this.state.quickSaleProductSearchSeq) {
                this.state.productOptions = [];
                this.state.quickSaleError = 'Could not search products. Please try again.';
            }
        }
    }

    onQuickSalePartnerInput(ev) {
        const value = (ev.target.value || '').trim();
        this.state.quickSalePartnerSearch = value;
        const match = value.match(/\[#(\d+)\]\s*$/);
        this.state.quickSalePartner = match ? match[1] : '';
        if (value === '— Walk-in customer —') this.state.quickSalePartner = '';
    }

    onQuickSaleProductInput(ev) {
        const value = (ev.target.value || '').trim();
        this.state.quickSaleProductSearch = value;
        const match = value.match(/\[#(\d+)\]\s*$/);
        this.state.quickSaleProduct = match ? match[1] : '';

        // Search the entire server-side product catalog instead of a fixed
        // browser-side list. Debouncing avoids an RPC for every keystroke.
        if (this.state.quickSaleProductSearchTimer) {
            clearTimeout(this.state.quickSaleProductSearchTimer);
        }
        this.state.quickSaleProductSearchTimer = setTimeout(() => {
            this.searchQuickSaleProducts(value);
            this.state.quickSaleProductSearchTimer = null;
        }, 250);
    }

    async submitQuickSale() {
        this.state.quickSaleError = '';
        if (!this.state.quickSaleProduct) {
            this.state.quickSaleError = 'Please select a product.';
            return;
        }
        const qty = parseFloat(this.state.quickSaleQty);
        if (!qty || qty <= 0) {
            this.state.quickSaleError = 'Quantity must be greater than 0.';
            return;
        }
        this.state.quickSaleSubmitting = true;
        try {
            const partnerId = this.state.quickSalePartner ? parseInt(this.state.quickSalePartner) : false;
            const productId = parseInt(this.state.quickSaleProduct);
            const res = await this.orm.call("dashboard.data","create_quick_sale",
                [partnerId, productId, qty, false]);
            if (res && res.error) {
                this.state.quickSaleError = res.error;
                return;
            }
            if (res && res.id) {
                this.state.showQuickSale = false;
                this.state.quickSaleLastResult = res.merged
                    ? `Added to existing draft order ${res.name}.`
                    : `Created new order ${res.name}.`;
                this._openTab('sale.order', res.id);
                await this.loadAll();
                setTimeout(()=>{ this.state.quickSaleLastResult = ''; }, 5000);
            } else {
                this.state.quickSaleError = 'Something went wrong creating the order. Please try again.';
            }
        } catch(e) {
            console.error("Quick sale failed:", e);
            this.state.quickSaleError = 'Server error while creating the order.';
        } finally {
            this.state.quickSaleSubmitting = false;
        }
    }

    // ── Dark mode ─────────────────────────────────────────────────────────
    toggleDarkMode() {
        this.state.darkMode = !this.state.darkMode;
        try { localStorage.setItem('eagle_dark_mode', this.state.darkMode ? '1' : '0'); } catch(e) {}
    }
}

Dashboard.template = "advanced_business_dashboard.dashboard";
registry.category("actions").add("advanced_dashboard_tag", Dashboard);
