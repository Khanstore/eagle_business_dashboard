/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, onWillStart, useState } from "@odoo/owl";
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
        });

        try { this.state.darkMode = localStorage.getItem('eagle_dark_mode') === '1'; } catch(e) {}

        onWillStart(async () => { await this.loadAll(); });
    }

    _fmt(d){return d.toISOString().split('T')[0];}
    _syncShared(){Object.assign(sharedFilterState,{from_date:this.state.from_date,to_date:this.state.to_date,active_preset:this.state.active_preset,selected_month:this.state.selected_month,selected_year:this.state.selected_year,partner_filter:this.state.partner_filter});}
    _setDates(from,to,preset='custom'){this.state.from_date=this._fmt(from);this.state.to_date=this._fmt(to);this.state.active_preset=preset;this._syncShared();this.loadAll();}
    toggleDarkMode(){this.state.darkMode=!this.state.darkMode;try{localStorage.setItem('eagle_dark_mode',this.state.darkMode?'1':'0');}catch(e){}}

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

    // ── Filters ───────────────────────────────────────────────────────────
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

    // ── CSV export ────────────────────────────────────────────────────────
    _writeCSV(rows,fn){if(!rows||!rows.length)return;const k=Object.keys(rows[0]);const l=[k.join(','),...rows.map(r=>k.map(key=>`"${String(r[key]??'').replace(/"/g,'""')}"`).join(','))];const b=new Blob(['\uFEFF'+l.join('\n')],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click();URL.revokeObjectURL(a.href);}
    exportDeliveries(){this._writeCSV(this.filteredDeliveries.map(r=>({'Reference':r.name,'Partner':r.partner,'Scheduled':r.scheduled_date,'Done':r.date_done,'Origin':r.origin,'Products':r.products_count,'Status':r.state})),'deliveries.csv');}
    exportReceipts(){this._writeCSV(this.filteredReceipts.map(r=>({'Reference':r.name,'Partner':r.partner,'Scheduled':r.scheduled_date,'Done':r.date_done,'Origin':r.origin,'Products':r.products_count,'Status':r.state})),'receipts.csv');}
    exportInternal(){this._writeCSV(this.filteredInternal.map(r=>({'Reference':r.name,'Partner':r.partner,'Scheduled':r.scheduled_date,'Done':r.date_done,'Origin':r.origin,'Products':r.products_count,'Status':r.state})),'internal_transfers.csv');}

    // ── Validate a picking directly from the dashboard ─────────────────────
    async validatePicking(id, ev) {
        if (ev) ev.stopPropagation();
        const ok = await this.orm.call("dashboard.data","validate_picking",[id]);
        if (ok) await this.loadAll();
    }

    // ── Navigation ────────────────────────────────────────────────────────
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
