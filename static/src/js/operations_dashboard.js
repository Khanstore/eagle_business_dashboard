/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, onWillStart, onMounted, onWillDestroy, onPatched, useState } from "@odoo/owl";
import { enhanceEagleTables } from "./table_tools";
import { useService } from "@web/core/utils/hooks";
import { sharedFilterState } from "./shared_filter_state";

class OperationsDashboard extends Component {
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
            deliveries: [], receipts: [], internal: [],
            pending_deliveries:0, pending_receipts:0, late:0, today_done:0,
            from_date:sharedFilterState.from_date, to_date:sharedFilterState.to_date,
            partner_filter:sharedFilterState.partner_filter,
            active_preset:sharedFilterState.active_preset,
            selected_month:sharedFilterState.selected_month,
            selected_year:sharedFilterState.selected_year,
            statusFilter:'',
            activeTab:'deliveries',
            companyName:'', companyId:0,
            darkMode:false,
            onlineUsers:[], themeColor:'#4f5bd5',
            showCommandPalette:false, commandQuery:'',
        });

        this._heartbeatTimer = null;
        try { this.state.darkMode = localStorage.getItem('eagle_dark_mode') === '1'; } catch(e) {}

        onWillStart(async () => {
            await this.loadAll();
            try { this.state.themeColor = await this.orm.call("dashboard.data","get_theme_color",[]); } catch(e) {}
        });
        onMounted(() => {
            this._keydownHandler = (ev) => this._onKeyDown(ev);
            window.addEventListener('keydown', this._keydownHandler);
            this.heartbeatNow();
            this._heartbeatTimer = setInterval(() => this.heartbeatNow(), 30000);
            enhanceEagleTables(this.el, 'operations');
        });
        onPatched(() => {
            enhanceEagleTables(this.el, 'operations');
        });
        onWillDestroy(() => {
            if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
            if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
        });
    }

    get themeStyle() { return `--eagle-accent:${this.state.themeColor};`; }
    async heartbeatNow() {
        try {
            await this.orm.call("dashboard.data","heartbeat",[]);
            this.state.onlineUsers = await this.orm.call("dashboard.data","get_online_users",[]);
        } catch(e) { /* silent */ }
    }
    _onKeyDown(ev) {
        const tag = (ev.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target.isContentEditable;
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
            ev.preventDefault(); this.state.showCommandPalette = true; this.state.commandQuery = ''; return;
        }
        if (ev.key === 'Escape' && this.state.showCommandPalette) { this.state.showCommandPalette = false; return; }
        if (typing || this.state.showCommandPalette) return;
        const k = ev.key.toLowerCase();
        if (k === 'b') this.goToBusinessDashboard();
        else if (k === 'f') this.goToFinanceDashboard();
        else if (k === 'd') this.toggleDarkMode();
    }
    closeCommandPalette() { this.state.showCommandPalette = false; }
    onCommandQueryChange(ev) { this.state.commandQuery = ev.target.value; }
    get commandActions() {
        const all = [
            {label:'Go to Business Dashboard', icon:'fa-th-large', run:()=>this.goToBusinessDashboard()},
            {label:'Go to Finance Dashboard', icon:'fa-line-chart', run:()=>this.goToFinanceDashboard()},
            {label:'Toggle Dark Mode', icon:'fa-moon-o', run:()=>this.toggleDarkMode()},
            {label:'View Delivery Orders', icon:'fa-truck', run:()=>this.setTab('deliveries')},
            {label:'View Receipts', icon:'fa-inbox', run:()=>this.setTab('receipts')},
            {label:'View Internal Transfers', icon:'fa-exchange', run:()=>this.setTab('internal')},
        ];
        const q = this.state.commandQuery.trim().toLowerCase();
        return q ? all.filter(a => a.label.toLowerCase().includes(q)) : all;
    }
    runCommand(action) { this.state.showCommandPalette = false; action.run(); }
    toggleDarkMode(){this.state.darkMode=!this.state.darkMode;try{localStorage.setItem('eagle_dark_mode',this.state.darkMode?'1':'0');}catch(e){}}

    _fmt(d){return d.toISOString().split('T')[0];}
    _syncShared(){Object.assign(sharedFilterState,{from_date:this.state.from_date,to_date:this.state.to_date,active_preset:this.state.active_preset,selected_month:this.state.selected_month,selected_year:this.state.selected_year,partner_filter:this.state.partner_filter});}
    _setDates(from,to,preset='custom'){this.state.from_date=this._fmt(from);this.state.to_date=this._fmt(to);this.state.active_preset=preset;this._syncShared();this.loadAll();}

    applyPreset(p){
        const n=new Date(),y=n.getFullYear(),m=n.getMonth(),d=n.getDate();
        if(p==='today'){this._setDates(n,n,p);return;}
        if(p==='this_week'){const day=n.getDay(),mon=new Date(y,m,d-((day+6)%7)),sun=new Date(y,m,d+(7-((day+6)%7))%7);this._setDates(mon,sun,p);return;}
        if(p==='this_month'){this._setDates(new Date(y,m,1),new Date(y,m+1,0),p);return;}
        if(p==='this_year'){this._setDates(new Date(y,0,1),new Date(y,11,31),p);return;}
        if(p==='all'){this.state.from_date='';this.state.to_date='';this.state.active_preset='all';this._syncShared();this.loadAll();}
    }
    onMonthChange(ev){const[y,mo]=ev.target.value.split('-').map(Number);this.state.selected_month=ev.target.value;this._setDates(new Date(y,mo-1,1),new Date(y,mo,0),'custom');}
    onYearChange(ev){const y=Number(ev.target.value);this.state.selected_year=ev.target.value;this._setDates(new Date(y,0,1),new Date(y,11,31),'custom');}
    onDateChange(){if(this.state.from_date&&this.state.to_date){this.state.active_preset='custom';this._syncShared();this.loadAll();}}

    async loadAll() {
        try {
            const [data, widgets, company] = await Promise.all([
                this.orm.call("dashboard.data","get_operations_dashboard",[this.state.from_date||false,this.state.to_date||false]),
                this.orm.call("dashboard.data","get_operations_widgets",[]),
                this.orm.call("dashboard.data","get_company_info",[]),
            ]);
            this.state.deliveries = data.deliveries||[];
            this.state.receipts   = data.receipts||[];
            this.state.internal   = data.internal||[];
            Object.assign(this.state, {
                pending_deliveries: widgets.pending_deliveries, pending_receipts: widgets.pending_receipts,
                late: widgets.late, today_done: widgets.today_done,
                companyName: company ? company.name : '', companyId: company ? company.id : 0,
            });
        } catch(e) { console.error("Operations dashboard load error:", e); }
    }

    _ok(r) {
        const q=this.state.partner_filter.trim().toLowerCase();
        const nameOk = !q || (r.partner||'').toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q);
        const stateOk = !this.state.statusFilter || r.state === this.state.statusFilter;
        return nameOk && stateOk;
    }
    get filteredDeliveries(){ return this.state.deliveries.filter(r=>this._ok(r)); }
    get filteredReceipts()  { return this.state.receipts.filter(r=>this._ok(r)); }
    get filteredInternal()  { return this.state.internal.filter(r=>this._ok(r)); }

    setTab(tab){ this.state.activeTab = tab; }
    onStatusFilterChange(ev){ this.state.statusFilter = ev.target.value; }

    _writeCSV(rows,fn){if(!rows||!rows.length)return;const k=Object.keys(rows[0]);const l=[k.join(','),...rows.map(r=>k.map(key=>`"${String(r[key]??'').replace(/"/g,'""')}"`).join(','))];const b=new Blob(['\uFEFF'+l.join('\n')],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click();URL.revokeObjectURL(a.href);}
    exportDeliveries(){this._writeCSV(this.filteredDeliveries.map(r=>({'Reference':r.name,'Partner':r.partner,'Scheduled':r.scheduled_date,'Done':r.date_done,'Origin':r.origin,'Products':r.products_count,'Status':r.state})),'deliveries.csv');}
    exportReceipts(){this._writeCSV(this.filteredReceipts.map(r=>({'Reference':r.name,'Partner':r.partner,'Scheduled':r.scheduled_date,'Done':r.date_done,'Origin':r.origin,'Products':r.products_count,'Status':r.state})),'receipts.csv');}
    exportInternal(){this._writeCSV(this.filteredInternal.map(r=>({'Reference':r.name,'Partner':r.partner,'Scheduled':r.scheduled_date,'Done':r.date_done,'Origin':r.origin,'Products':r.products_count,'Status':r.state})),'internal_transfers.csv');}

    async validatePicking(id, ev) {
        if (ev) ev.stopPropagation();
        const ok = await this.orm.call("dashboard.data","validate_picking",[id]);
        if (ok) await this.loadAll();
    }

    _openTab(model,id){const t=window.open(`/web#model=${model}&id=${id}&view_type=form`,'_blank');if(t)t.focus();}
    openPicking(id){this._openTab('stock.picking',id);}
    openPartner(id){this._openTab('res.partner',id);}
    async _newTab(model,domain,name){
        try {
            const actionId = await this.orm.call("dashboard.data","open_dynamic_action",[model,domain,name||'Dashboard List']);
            const t = window.open(`/odoo/action-${actionId}`,'_blank');
            if (t) t.focus();
        } catch(e) { console.error("Failed to open list:", e); }
    }
    openPendingDeliveries(){this._newTab('stock.picking',[["picking_type_id.code","=","outgoing"],["state","not in",["done","cancel"]]],'Pending Deliveries');}
    openPendingReceipts(){this._newTab('stock.picking',[["picking_type_id.code","=","incoming"],["state","not in",["done","cancel"]]],'Pending Receipts');}
    openLateTransfers(){this._newTab('stock.picking',[["state","not in",["done","cancel"]],["scheduled_date","<",new Date().toISOString().split('T')[0]]],'Late Transfers');}

    goToBusinessDashboard(){this._syncShared();this.action.doAction("eagle_business_dashboard.advanced_dashboard_action");}
    goToFinanceDashboard(){this._syncShared();this.action.doAction("eagle_business_dashboard.finance_dashboard_action");}
}

OperationsDashboard.template = "advanced_business_dashboard.operations_dashboard";
registry.category("actions").add("operations_dashboard_tag", OperationsDashboard);
