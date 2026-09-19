/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, onWillStart, onWillDestroy, onMounted, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { sharedFilterState } from "./shared_filter_state";

class FinanceDashboard extends Component {
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
            invoices:[], vendor_bills:[], transactions:[], journal_balances:[],
            overdue_bills_count:0, overdue_bills_amount:0, due_soon_count:0, due_soon_amount:0,
            overdue_inv_count:0, overdue_inv_amount:0,
            opening_cash:0, month_in:0, month_out:0, current_cash:0, cash_balance_masked:false,
            revenue:0, costs:0, gross_profit:0, margin_pct:0,
            trend_data:[], aging:{ar:[],ap:[]},
            financial:{tax_collected:0,tax_paid:0,tax_net:0,unreconciled_count:0,
                       current_sales:0,previous_sales:0,last_year_sales:0},
            role:'user', visibility:{}, section_labels:{}, all_defaults:{},
            from_date:sharedFilterState.from_date, to_date:sharedFilterState.to_date,
            partner_filter:sharedFilterState.partner_filter,
            active_preset:sharedFilterState.active_preset,
            selected_month:sharedFilterState.selected_month,
            selected_year:sharedFilterState.selected_year,
            partner_id_filter:'', partnerOptions:[],
            includeChildContacts:false,
            sortKey:'', sortOrder:'asc',
            quickSearch:'', showSearchResults:false,
            periodTab:'current',
            teamNotes:'', notesSaved:false, notesMentioned:null,
            showPrintModal:false, printInvoiceLines:false, printVendorLines:false,
            printJournalBalance:true, printTxDetails:true,
            tableOpen:{journal:false, journalSummary:false, invoices:false, vendorBills:false, transactions:false},
            journalRowsOpen:{}, journalRowTransactions:{}, journalRowLoading:{},
            showExportPrompt:false, exportPromptType:'',
            showDrillModal:false, drillTitle:'', drillRows:[], drillJournalId:null,
            showSettings:false, settingsDraft:{}, settingsSaved:false,
            ledgerSecurityJournals:[], ledgerSecurityUsers:[], ledgerSecurityDraft:{}, ledgerSecuritySaved:false,
            validatingPaymentId:0,
            approvalThresholds:{sale_threshold:0,purchase_threshold:0},
            autoRefresh:false, refreshMins:5,
            selectedInvoiceIds:[],
            bulkMarkPaidError:'',
            companyName:'', companyId:0,
            onlineUsers:[], themeColor:'#4f5bd5',
            showCommandPalette:false, commandQuery:'',
            canManageLedgerSecurity:false,
            savedFilters:[], showSaveFilterPrompt:false, filterNameInput:'',
        });

        this._invoiceLines = {};
        this._vendorLines  = {};
        this._refreshTimer = null;
        this._heartbeatTimer = null;

        try { this.state.darkMode = localStorage.getItem('eagle_dark_mode') === '1'; } catch(e) {}

        onWillStart(async () => {
            await this.loadAll();
            await this.loadSavedFilters();
            try { this.state.themeColor = await this.orm.call("dashboard.data","get_theme_color",[]); } catch(e) {}
        });
        onMounted(() => {
            this._keydownHandler = (ev) => this._onKeyDown(ev);
            window.addEventListener('keydown', this._keydownHandler);
            this.heartbeatNow();
            this._heartbeatTimer = setInterval(() => this.heartbeatNow(), 30000);
        });
        onWillDestroy(() => {
            this._stopRefresh();
            if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
            if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
        });
    }

    _fmt(d){return d.toISOString().split('T')[0];}
    _syncShared(){Object.assign(sharedFilterState,{from_date:this.state.from_date,to_date:this.state.to_date,active_preset:this.state.active_preset,selected_month:this.state.selected_month,selected_year:this.state.selected_year,partner_filter:this.state.partner_filter});}
    _setDates(from,to,preset='custom'){this.state.from_date=this._fmt(from);this.state.to_date=this._fmt(to);this.state.active_preset=preset;this._syncShared();this.loadAll();}
    vis(key){return this.state.visibility[key]!==false;}
    toggleTable(key){if(Object.prototype.hasOwnProperty.call(this.state.tableOpen,key)) this.state.tableOpen[key]=!this.state.tableOpen[key];}
    async toggleJournalRow(journalId){
        const key=String(journalId);
        if (this.state.journalRowsOpen[key]) {
            this.state.journalRowsOpen[key]=false;
            return;
        }
        this.state.journalRowsOpen[key]=true;
        if (this.state.journalRowTransactions[key] || this.state.journalRowLoading[key]) return;
        this.state.journalRowLoading[key]=true;
        try {
            const rows=await this.orm.call("dashboard.data","get_journal_transactions",[
                journalId,this.state.from_date||false,this.state.to_date||false
            ]);
            this.state.journalRowTransactions[key]=rows||[];
        } catch(e) {
            console.error("Journal transaction load error:",e);
            this.state.journalRowTransactions[key]=[];
        } finally {
            this.state.journalRowLoading[key]=false;
        }
    }
    isJournalRowOpen(journalId){return !!this.state.journalRowsOpen[String(journalId)];}
    isJournalRowLoading(journalId){return !!this.state.journalRowLoading[String(journalId)];}
    getJournalTransactions(journalId){return this.state.journalRowTransactions[String(journalId)] || [];}
    journalTxReceived(journalId){
        return this.getJournalTransactions(journalId).reduce((s,r)=>s+(Number(r.received)||0),0).toFixed(2);
    }
    journalTxPaid(journalId){
        return this.getJournalTransactions(journalId).reduce((s,r)=>s+(Number(r.paid)||0),0).toFixed(2);
    }
    formatAmount(value){
        const n = parseFloat(value);
        return Number.isFinite(n) ? n.toFixed(2) : '0.00';
    }
    get hasMaskedJournalBalances(){return (this.state.journal_balances||[]).some(r=>r.balance_masked);}

    // ── Batch 3: presence, theme, command palette, shortcuts ─────────────
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
        if (k === 'r') this.createPayment('inbound');
        else if (k === 'p') this.createPayment('outbound');
        else if (k === 'b') this.goToBusinessDashboard();
        else if (k === 'o') this.goToOperationsDashboard();
        else if (k === 'd') this.toggleDarkMode();
    }
    closeCommandPalette() { this.state.showCommandPalette = false; }
    onCommandQueryChange(ev) { this.state.commandQuery = ev.target.value; }
    get commandActions() {
        const all = [
            {label:'Receive Payment', icon:'fa-arrow-down', run:()=>this.createPayment('inbound')},
            {label:'Make Payment', icon:'fa-arrow-up', run:()=>this.createPayment('outbound')},
            {label:'Go to Business Dashboard', icon:'fa-th-large', run:()=>this.goToBusinessDashboard()},
            {label:'Go to Operations Dashboard', icon:'fa-truck', run:()=>this.goToOperationsDashboard()},
            {label:'Toggle Dark Mode', icon:'fa-moon-o', run:()=>this.toggleDarkMode()},
            {label:'Print Dashboard', icon:'fa-print', run:()=>this.openPrintModal()},
        ];
        const q = this.state.commandQuery.trim().toLowerCase();
        return q ? all.filter(a => a.label.toLowerCase().includes(q)) : all;
    }
    runCommand(action) { this.state.showCommandPalette = false; action.run(); }
    toggleDarkMode() {
        this.state.darkMode = !this.state.darkMode;
        try { localStorage.setItem('eagle_dark_mode', this.state.darkMode ? '1' : '0'); } catch(e) {}
    }

    applyPreset(p){const n=new Date(),y=n.getFullYear(),m=n.getMonth(),d=n.getDate();if(p==='today'){this._setDates(n,n,p);return;}if(p==='this_week'){const day=n.getDay(),mon=new Date(y,m,d-((day+6)%7)),sun=new Date(y,m,d+(7-((day+6)%7))%7);this._setDates(mon,sun,p);return;}if(p==='this_month'){this._setDates(new Date(y,m,1),new Date(y,m+1,0),p);return;}if(p==='this_year'){this._setDates(new Date(y,0,1),new Date(y,11,31),p);return;}if(p==='all'){this.state.from_date='';this.state.to_date='';this.state.active_preset='all';this._syncShared();this.loadAll();}}
    onMonthChange(ev){const[y,mo]=ev.target.value.split('-').map(Number);this.state.selected_month=ev.target.value;this._setDates(new Date(y,mo-1,1),new Date(y,mo,0),'custom');}
    onYearChange(ev){const y=Number(ev.target.value);this.state.selected_year=ev.target.value;this._setDates(new Date(y,0,1),new Date(y,11,31),'custom');}
    onDateChange(){if(this.state.from_date&&this.state.to_date){this.state.active_preset='custom';this._syncShared();this.loadAll();}}

    async loadAll() {
        try {
            const [data, jb, widgets, vis, trend, aging, fin, notes, company] = await Promise.all([
                this.orm.call("dashboard.data","get_finance_dashboard",[this.state.from_date||false,this.state.to_date||false]),
                this.orm.call("dashboard.data","get_journal_balance",[this.state.from_date||false,this.state.to_date||false]),
                this.orm.call("dashboard.data","get_finance_widgets",[]),
                this.orm.call("dashboard.data","get_visibility",[]),
                this.orm.call("dashboard.data","get_trend_data",[this.state.from_date||false,this.state.to_date||false,'invoice']),
                this.orm.call("dashboard.data","get_aging_report",[]),
                this.orm.call("dashboard.data","get_financial_controls",[this.state.from_date||false,this.state.to_date||false]),
                this.orm.call("dashboard.data","get_team_notes",[]),
                this.orm.call("dashboard.data","get_company_info",[]),
            ]);
            this._invoiceLines={}; this._vendorLines={};
            const strip=(map,arr)=>arr.map(r=>{map[r.id]=r.lines||[];const{lines,...rest}=r;return rest;});
            this.state.invoices     = strip(this._invoiceLines, data.invoices||[]);
            this.state.vendor_bills = strip(this._vendorLines,  data.vendor_bills||[]);
            this.state.transactions = data.transactions||[];
            this.state.journal_balances = jb||[];
            this.state.journalRowsOpen={}; this.state.journalRowTransactions={}; this.state.journalRowLoading={};

            Object.assign(this.state, {
                overdue_bills_count:widgets.overdue_bills_count, overdue_bills_amount:widgets.overdue_bills_amount,
                due_soon_count:widgets.due_soon_count, due_soon_amount:widgets.due_soon_amount,
                overdue_inv_count:widgets.overdue_inv_count, overdue_inv_amount:widgets.overdue_inv_amount,
                opening_cash:widgets.opening_cash, month_in:widgets.month_in,
                month_out:widgets.month_out, current_cash:widgets.current_cash, cash_balance_masked:!!widgets.cash_balance_masked,
                revenue:widgets.revenue, costs:widgets.costs,
                gross_profit:widgets.gross_profit, margin_pct:widgets.margin_pct,
                trend_data:trend||[], aging:aging||{ar:[],ap:[]},
                financial:fin||{},
                role:vis.role, visibility:vis.visibility||{},
                section_labels:vis.section_labels||{}, all_defaults:vis.all_defaults||{},
                canManageLedgerSecurity: !!vis.can_manage_ledger_security,
                teamNotes:notes||'',
                companyName: company ? company.name : '',
                companyId:   company ? company.id : 0,
            });

            const pm={};
            [...this.state.invoices,...this.state.vendor_bills,...this.state.transactions]
                .forEach(r=>{if(r.partner_id&&r.partner) pm[r.partner_id]=r.partner;});
            this.state.partnerOptions=Object.entries(pm).map(([id,name])=>({id:String(id),name})).sort((a,b)=>a.name.localeCompare(b.name));
            if(this.state.sortKey) this._applySort();
        } catch(e){console.error("FinanceDashboard load error:",e);}
    }

    // ── Partner filter (with hierarchy: parent/child) ────────────────────
    _ok(r) {
        const q=this.state.partner_filter.trim().toLowerCase(), pid=this.state.partner_id_filter;
        let nameOk;
        if (!q) { nameOk = true; }
        else if (this.state.includeChildContacts) { nameOk = (r.partner||'').toLowerCase().includes(q) || (r.partner_parent||'').toLowerCase().includes(q); }
        else { nameOk = (r.partner||'').toLowerCase().includes(q); }
        return nameOk && (!pid||String(r.partner_id)===pid);
    }
    toggleIncludeChildContacts() { this.state.includeChildContacts = !this.state.includeChildContacts; }
    get filteredInvoices()    {return this.state.invoices.filter(r=>this._ok(r));}
    get filteredVendorBills() {return this.state.vendor_bills.filter(r=>this._ok(r));}
    get filteredTransactions(){return this.state.transactions.filter(r=>this._ok(r));}
    get showDateColumn()      {const{from_date,to_date}=this.state;return!(from_date&&to_date&&from_date===to_date);}

    onQuickSearch(ev){this.state.quickSearch=ev.target.value;this.state.showSearchResults=ev.target.value.trim().length>1;}
    closeSearch(){setTimeout(()=>{this.state.showSearchResults=false;},200);}
    get quickSearchResults(){
        const q=this.state.quickSearch.trim().toLowerCase();
        if(!q) return {};
        const match=r=>(r.name||'').toLowerCase().includes(q)||(r.partner||'').toLowerCase().includes(q);
        return {invoices:this.state.invoices.filter(match).slice(0,5),vendors:this.state.vendor_bills.filter(match).slice(0,5),transactions:this.state.transactions.filter(match).slice(0,5)};
    }
    get quickSearchHasResults(){const r=this.quickSearchResults;return(r.invoices||[]).length+(r.vendors||[]).length+(r.transactions||[]).length>0;}

    sortTransactions(key){this.state.sortOrder=this.state.sortKey===key?(this.state.sortOrder==='asc'?'desc':'asc'):'asc';this.state.sortKey=key;this._applySort();}
    _applySort(){const k=this.state.sortKey,o=this.state.sortOrder==='asc'?1:-1;this.state.transactions.sort((a,b)=>{let vA=a[k]??'',vB=b[k]??'';return(typeof vA==='number'&&typeof vB==='number')?(vA-vB)*o:vA.toString().localeCompare(vB.toString())*o;});}

    get groupedTransactions(){
        const rows=this.filteredTransactions;
        if(this.state.sortKey!=='journal') return rows.map(r=>({...r,_type:'data'}));
        const groups=[],seen=new Map();
        for(const tx of rows){if(!seen.has(tx.journal)){seen.set(tx.journal,{journal:tx.journal,items:[]});groups.push(seen.get(tx.journal));}seen.get(tx.journal).items.push(tx);}
        const result=[];
        for(const g of groups){for(const item of g.items) result.push({...item,_type:'data'});const sR=g.items.reduce((s,r)=>s+(parseFloat(r.received)||0),0);const sP=g.items.reduce((s,r)=>s+(parseFloat(r.paid)||0),0);result.push({_type:'subtotal',_journal:g.journal,_count:g.items.length,_received:sR.toFixed(2),_paid:sP.toFixed(2),id:'sub_'+g.journal});}
        return result;
    }

    _sum(arr,f){return arr.reduce((s,r)=>s+(r[f]||0),0).toFixed(2);}
    _cnt(arr,f){return arr.reduce((s,r)=>s+(r[f]||0),0);}
    get invoiceTotalAmount()   {return this._sum(this.filteredInvoices,'amount');}
    get invoiceTotalResidual() {return this._sum(this.filteredInvoices,'residual');}
    get vendorTotalAmount()    {return this._sum(this.filteredVendorBills,'amount');}
    get vendorTotalResidual()  {return this._sum(this.filteredVendorBills,'residual');}
    get txTotalReceived()      {return this._sum(this.filteredTransactions,'received');}
    get txTotalPaid()          {return this._sum(this.filteredTransactions,'paid');}
    get jbTotalOpening()       {return this.hasMaskedJournalBalances ? '••••••' : this._sum(this.state.journal_balances,'opening');}
    get jbTotalDeposit()       {return this._sum(this.state.journal_balances,'deposit');}
    get jbTotalDepositCount()  {return this._cnt(this.state.journal_balances,'deposit_count');}
    get jbTotalWithdraw()      {return this._sum(this.state.journal_balances,'withdraw');}
    get jbTotalWithdrawCount() {return this._cnt(this.state.journal_balances,'withdraw_count');}
    get jbTotalChange()        {return this._sum(this.state.journal_balances,'change');}
    get jbTotalChangePositive(){return parseFloat(this.jbTotalChange)>=0;}
    get jbTotalClosing()       {return this.hasMaskedJournalBalances ? '••••••' : this._sum(this.state.journal_balances,'closing');}
    get journalSummaryRows() {
        return (this.state.journal_balances || []).map(jb => ({
            journal_id: jb.journal_id,
            journal_name: jb.journal_name,
            previous: jb.opening === null ? null : Number(jb.opening || 0),
            current: jb.closing === null ? null : Number(jb.closing || 0),
            deposit: Number(jb.deposit || 0),
            deposit_count: Number(jb.deposit_count || 0),
            withdraw: Number(jb.withdraw || 0),
            withdraw_count: Number(jb.withdraw_count || 0),
            change: Number(jb.change || 0),
            balance_masked: !!jb.balance_masked,
        }));
    }
    get journalSummaryPreviousValue() {return this.journalSummaryRows.filter(r=>r.previous!==null).reduce((s,r)=>s+r.previous,0);}
    get journalSummaryCurrentValue() {return this.journalSummaryRows.filter(r=>r.current!==null).reduce((s,r)=>s+r.current,0);}
    get journalSummaryPrevious() {return this.hasMaskedJournalBalances ? '••••••' : this.journalSummaryPreviousValue.toFixed(2);}
    get journalSummaryCurrent() {return this.hasMaskedJournalBalances ? '••••••' : this.journalSummaryCurrentValue.toFixed(2);}
    get journalSummaryDepositValue() {return this.journalSummaryRows.reduce((s,r)=>s+r.deposit,0);}
    get journalSummaryDeposit() {return this.journalSummaryDepositValue.toFixed(2);}
    get journalSummaryDepositCount() {return this.journalSummaryRows.reduce((s,r)=>s+r.deposit_count,0);}
    get journalSummaryWithdrawValue() {return this.journalSummaryRows.reduce((s,r)=>s+r.withdraw,0);}
    get journalSummaryWithdraw() {return this.journalSummaryWithdrawValue.toFixed(2);}
    get journalSummaryWithdrawCount() {return this.journalSummaryRows.reduce((s,r)=>s+r.withdraw_count,0);}
    get journalSummaryChange() {return this.journalSummaryRows.reduce((s,r)=>s+r.change,0).toFixed(2);}
    get journalSummaryChangePositive() {return this.journalSummaryRows.reduce((s,r)=>s+r.change,0)>=0;}
    get currentCashPositive()  {return (this.state.current_cash===null || this.state.current_cash===undefined) ? true : this.state.current_cash>=0;}
    get grossProfitPositive()  {return this.state.gross_profit>=0;}

    toggleAutoRefresh(){this.state.autoRefresh=!this.state.autoRefresh;this.state.autoRefresh?this._startRefresh():this._stopRefresh();}
    onRefreshMinsChange(ev){this.state.refreshMins=Number(ev.target.value);if(this.state.autoRefresh){this._stopRefresh();this._startRefresh();}}
    _startRefresh(){this._stopRefresh();this._refreshTimer=setInterval(()=>this.loadAll(),this.state.refreshMins*60000);}
    _stopRefresh(){if(this._refreshTimer){clearInterval(this._refreshTimer);this._refreshTimer=null;}}

    async saveNotes(){
        const res = await this.orm.call("dashboard.data","save_team_notes_with_mentions",[this.state.teamNotes]);
        this.state.notesSaved=true;
        if (res && res.notified && res.notified.length) this.state.notesMentioned = res.notified;
        setTimeout(()=>{this.state.notesSaved=false; this.state.notesMentioned=null;},3000);
    }

    async openLedgerSecurity(){
        try {
            await this.orm.call("dashboard.ledger.security","sync_journal_rules",[]);
            await this.action.doAction("eagle_business_dashboard.action_ledger_balance_security");
        } catch (e) {
            console.error("Ledger Balance Security open error:", e);
            this.state.showSettings=true;
            await this.openSettings();
        }
    }

    async openSettings(){
        this.state.settingsDraft=JSON.parse(JSON.stringify(this.state.all_defaults));
        try {
            const q=await this.orm.call("dashboard.approval.config","get_config",[]);
            this.state.approvalThresholds={sale_threshold:q.sale_threshold,purchase_threshold:q.purchase_threshold};
        } catch(e) {}
        try {
            const sec=await this.orm.call("dashboard.ledger.security","get_config",[]);
            this.state.ledgerSecurityJournals=sec.journals||[];
            this.state.ledgerSecurityUsers=sec.users||[];
            this.state.ledgerSecurityDraft=Object.fromEntries((sec.journals||[]).map(j=>[String(j.id),{masked:!!j.masked,approved_user_ids:[...(j.approved_user_ids||[])]}]));
        } catch(e) {
            this.state.ledgerSecurityJournals=[]; this.state.ledgerSecurityUsers=[]; this.state.ledgerSecurityDraft={};
        }
        this.state.showSettings=true;
    }
    closeSettings(){this.state.showSettings=false;}
    toggleSetting(role,key){if(this.state.settingsDraft[role]) this.state.settingsDraft[role][key]=!this.state.settingsDraft[role][key];}
    toggleLedgerMask(journalId,ev){
        const key=String(journalId);
        if(!this.state.ledgerSecurityDraft[key]) this.state.ledgerSecurityDraft[key]={masked:false,approved_user_ids:[]};
        this.state.ledgerSecurityDraft[key].masked=!!ev.target.checked;
    }
    updateLedgerApprovals(journalId,ev){
        const key=String(journalId);
        if(!this.state.ledgerSecurityDraft[key]) this.state.ledgerSecurityDraft[key]={masked:false,approved_user_ids:[]};
        this.state.ledgerSecurityDraft[key].approved_user_ids=[...ev.target.selectedOptions].map(o=>Number(o.value));
    }
    async saveLedgerSecurity(){
        const config=this.state.ledgerSecurityJournals.map(j=>{
            const d=this.state.ledgerSecurityDraft[String(j.id)]||{masked:false,approved_user_ids:[]};
            return {journal_id:j.id,masked:!!d.masked,approved_user_ids:[...(d.approved_user_ids||[])]};
        });
        await this.orm.call("dashboard.ledger.security","set_config",[config]);
        this.state.ledgerSecuritySaved=true;
    }
    async saveSettings(){
        await this.orm.call("dashboard.data","save_visibility",[this.state.settingsDraft]);
        await this.orm.call("dashboard.approval.config","set_config",
            [this.state.approvalThresholds.sale_threshold||0,this.state.approvalThresholds.purchase_threshold||0]).catch(()=>{});
        await this.orm.call("dashboard.data","save_theme_color",[this.state.themeColor]).catch(()=>{});
        await this.saveLedgerSecurity().catch(()=>{});
        this.state.settingsSaved=true;
        setTimeout(()=>{this.state.settingsSaved=false;this.state.ledgerSecuritySaved=false;this.state.showSettings=false;this.loadAll();},1200);
    }

    async openDrillDown(jb){
        this.state.showDrillModal=true; this.state.drillTitle=jb.journal_name; this.state.drillRows=[];
        try{const rows=await this.orm.call("dashboard.data","get_journal_transactions",[jb.journal_id,this.state.from_date||false,this.state.to_date||false]);this.state.drillRows=rows;}catch(e){console.error("Drill-down error:",e);}
    }
    closeDrillModal(){this.state.showDrillModal=false;this.state.drillRows=[];}
    get drillTotalReceived(){return this.state.drillRows.reduce((s,r)=>s+(r.received||0),0).toFixed(2);}
    get drillTotalPaid()    {return this.state.drillRows.reduce((s,r)=>s+(r.paid||0),0).toFixed(2);}

    _writeCSV(rows,fn){if(!rows||!rows.length)return;const k=Object.keys(rows[0]);const l=[k.join(','),...rows.map(r=>k.map(key=>`"${String(r[key]??'').replace(/"/g,'""')}"`).join(','))];const b=new Blob(['\uFEFF'+l.join('\n')],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click();URL.revokeObjectURL(a.href);}
    exportInvoices(){this._exportPrompt('invoices');}
    exportVendors() {this._exportPrompt('vendor_bills');}
    exportTx()      {this._exportPrompt('transactions');}
    exportJB()      {this._writeCSV(this.state.journal_balances.map(r=>({'Journal':r.journal_name,'Previous Balance':r.opening,'Deposit':r.deposit,'Deposit Count':r.deposit_count,'Withdraw':r.withdraw,'Withdraw Count':r.withdraw_count,'Change':r.change,'New Balance':r.closing})),'journal_balance.csv');}
    _exportPrompt(type){this.state.exportPromptType=type;this.state.showExportPrompt=true;}
    closeExportPrompt(){this.state.showExportPrompt=false;}
    doExport(includeLines){
        const type=this.state.exportPromptType; this.state.showExportPrompt=false;
        const fmt=v=>{const n=parseFloat(v);return isNaN(n)?'':n.toFixed(2);};
        if(type==='transactions'){this._writeCSV(this.filteredTransactions.map(r=>({'Reference':r.name,'Partner':r.partner,'Date':r.date,'Journal':r.journal,'Type':r.type,'Received':fmt(r.received),'Paid':fmt(r.paid),'Status':r.state})),'transactions.csv');return;}
        const ds={invoices:{records:this.filteredInvoices,lineCache:this._invoiceLines,file:'invoices.csv'},vendor_bills:{records:this.filteredVendorBills,lineCache:this._vendorLines,file:'vendor_bills.csv'}};
        const d=ds[type]; const csvRows=[];
        for(const r of d.records){
            csvRows.push({'Row Type':'RECORD','Reference':r.name,'Partner':r.partner,'Date':r.date,'Due Date':r.due_date,'Amount':fmt(r.amount),'Outstanding':fmt(r.residual),'Status':r.state,'Product':'','Qty':'','UoM':'','Rate':'','Discount%':'','Tax':'','Line Total':''});
            if(includeLines){
                const lines=d.lineCache[r.id]||[];
                for(const l of lines){csvRows.push({'Row Type':'LINE','Reference':r.name,'Partner':'','Date':'','Due Date':'','Amount':'','Outstanding':'','Status':'','Product':l.product||'','Qty':fmt(l.qty),'UoM':l.uom||'','Rate':fmt(l.price_unit),'Discount%':fmt(l.discount),'Tax':l.tax||'','Line Total':fmt(l.subtotal)});}
                if(lines.length){const lt=lines.reduce((s,l)=>s+(parseFloat(l.subtotal)||0),0);csvRows.push({'Row Type':'SUBTOTAL','Reference':r.name,'Partner':'','Date':'','Due Date':'','Amount':fmt(r.amount),'Outstanding':fmt(r.residual),'Status':`${lines.length} line(s)`,'Product':'','Qty':'','UoM':'','Rate':'','Discount%':'','Tax':'','Line Total':fmt(lt)});}
            }
        }
        this._writeCSV(csvRows,d.file);
    }

    openPrintModal(){this.state.showPrintModal=true;}
    closePrintModal(){this.state.showPrintModal=false;}
    async doPrint(){
        const incInv=this.state.printInvoiceLines,incVen=this.state.printVendorLines,incJB=this.state.printJournalBalance,incTx=this.state.printTxDetails;
        const invoices=this.filteredInvoices.map(r=>({...r,lines:this._invoiceLines[r.id]||[]}));
        const vendorBills=this.filteredVendorBills.map(r=>({...r,lines:this._vendorLines[r.id]||[]}));
        const txs=[...this.groupedTransactions];
        this.state.showPrintModal=false;
        const fmt=v=>{const n=parseFloat(v);return isNaN(n)?'0.00':n.toFixed(2);};
        // Open the print window immediately to avoid browser popup blockers, then
        // refresh the journal balances through the server before rendering.
        const pw=window.open('','_blank','width=1200,height=800');
        if(!pw){return;}
        let jb=[...this.state.journal_balances];
        if(incJB){
            try {
                jb = await this.orm.call('dashboard.data','get_journal_balance',[this.state.from_date||false,this.state.to_date||false]);
            } catch(e) {
                // Fall back to the already server-sanitized dashboard data.
            }
        }
        const styles=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l=>`<link rel="stylesheet" href="${l.href}">`).join('');
        const mask='••••••';
        const buildMove=(records,inc)=>{if(!records.length)return'<p style="color:#888">No records.</p>';const hdr=['Invoice/Bill','Partner','Date','Due Date','Amount','Outstanding','Status'].map(h=>`<th style="background:#1a1f36;color:#fff;padding:8px 12px;font-size:11px;text-align:left">${h}</th>`).join('');let html=`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px"><thead><tr>${hdr}</tr></thead><tbody>`;for(const r of records){html+=`<tr style="background:#fff"><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.name}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.partner}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.date}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.due_date}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(r.amount)}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(r.residual)}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.state}</td></tr>`;if(inc&&r.lines&&r.lines.length){const lh=['Product','Qty','Rate','Disc%','Tax','Total'].map((h,i)=>`<th style="background:#f1f5f9;padding:4px 8px;font-size:10px;text-align:${i===0?'left':'right'}">${h}</th>`).join('');const lb=r.lines.map(l=>`<tr><td style="padding:4px 8px;font-size:10px">${l.product}</td><td style="padding:4px 8px;font-size:10px;text-align:right">${fmt(l.qty)}</td><td style="padding:4px 8px;font-size:10px;text-align:right">${fmt(l.price_unit)}</td><td style="padding:4px 8px;font-size:10px;text-align:right">${fmt(l.discount)}</td><td style="padding:4px 8px;font-size:10px">${l.tax}</td><td style="padding:4px 8px;font-size:10px;text-align:right;font-weight:700">${fmt(l.subtotal)}</td></tr>`).join('');html+=`<tr><td colspan="7" style="padding:2px 24px 10px"><table style="width:100%;border-collapse:collapse"><thead><tr>${lh}</tr></thead><tbody>${lb}</tbody></table></td></tr>`;}}return html+'</tbody></table>';};
        const buildJB=rows=>{if(!rows.length)return'';const hdr=['Journal','Prev Balance','Deposit','Withdraw','Change','New Balance'].map(h=>`<th style="background:#1a1f36;color:#fff;padding:8px 12px;font-size:11px">${h}</th>`).join('');const body=rows.map(r=>{const prev=r.balance_masked?mask:fmt(r.opening);const current=r.balance_masked?mask:fmt(r.closing);return`<tr><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${r.journal_name}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${prev}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#059669">${fmt(r.deposit)} (${r.deposit_count})</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#dc2626">${fmt(r.withdraw)} (${r.withdraw_count})</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:${r.change>=0?'#059669':'#dc2626'}">${r.change>=0?'+':''}${fmt(r.change)}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:${r.balance_masked?'#6b7280':(r.closing>=0?'#2563eb':'#dc2626')}">${current}</td></tr>`;}).join('');return`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px"><thead><tr>${hdr}</tr></thead><tbody>${body}</tbody></table>`;};
        const buildTx=rows=>{ const f=rows.filter(r=>r._type!=='subtotal'); if(!f.length)return''; const hdr=['Reference','Partner','Date','Journal','Received','Paid','Status'].map(h=>`<th style="background:#1a1f36;color:#fff;padding:8px 12px;font-size:11px">${h}</th>`).join(''); const body=f.map(r=>`<tr><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.name}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.partner}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.date}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.journal}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#059669">${fmt(r.received)}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#dc2626">${fmt(r.paid)}</td><td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${r.state}</td></tr>`).join(''); return`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px"><thead><tr>${hdr}</tr></thead><tbody>${body}</tbody></table>`;};
        pw.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Finance Dashboard</title>${styles}<style>body{margin:0;padding:20px;font-family:sans-serif}h1{font-size:20px;color:#1a1f36;margin:0 0 4px}h2{font-size:14px;font-weight:700;color:#1a1f36;margin:20px 0 8px;padding-bottom:4px;border-bottom:2px solid #1a1f36}.period{font-size:11px;color:#6b7280;margin-bottom:16px}.mask-note{font-size:10px;color:#6b7280;margin:-4px 0 10px}@media print{@page{margin:10mm;size:A4 landscape}body{font-size:10px;padding:0}}</style></head><body>
        <h1>Finance Dashboard</h1><div class="period">Period: ${this.state.from_date||'All'} — ${this.state.to_date||'All'}</div>
        ${incJB?`<h2>Journal Balance</h2>${jb.some(r=>r.balance_masked)?'<div class="mask-note">Some journal balances are protected for the user printing this report.</div>':''}${buildJB(jb)}`:''}
        <h2>Invoices (${invoices.length})</h2>${buildMove(invoices,incInv)}
        <h2>Vendor Bills (${vendorBills.length})</h2>${buildMove(vendorBills,incVen)}
        ${incTx?`<h2>Transactions (${this.filteredTransactions.length})</h2>${buildTx(txs)}`:''}
        </body></html>`);
        pw.document.close(); pw.onload=()=>{pw.focus();pw.print();pw.close();}; setTimeout(()=>{try{pw.focus();pw.print();pw.close();}catch(e){}},1800);
    }

    _today(){const d=new Date();return d.toISOString().split('T')[0];}
    _newTab(model,domain,name){
        this.orm.call("dashboard.data","open_dynamic_action",[model,domain,name||'Dashboard List'])
            .then(actionId=>{const t=window.open(`/odoo/action-${actionId}`,'_blank');if(t)t.focus();})
            .catch(e=>console.error(e));
    }
    openCashBalance(){if(this.state.cash_balance_masked)return;this._newTab('account.move.line',[["journal_id.type","in",["bank","cash"]],["move_id.state","=","posted"]],'Bank & Cash Journal Items');}
    openOverdueInvoices(){this._newTab('account.move',[["move_type","=","out_invoice"],["state","=","posted"],["payment_state","not in",["paid","in_payment"]],["invoice_date_due","<",this._today()]],'Overdue Invoices');}
    openOverdueBills(){this._newTab('account.move',[["move_type","=","in_invoice"],["state","=","posted"],["payment_state","not in",["paid","in_payment"]],["invoice_date_due","<",this._today()]],'Overdue Vendor Bills');}
    openDueSoonBills(){const d7=new Date();d7.setDate(d7.getDate()+7);this._newTab('account.move',[["move_type","=","in_invoice"],["state","=","posted"],["payment_state","not in",["paid","in_payment"]],["invoice_date_due",">=",this._today()],["invoice_date_due","<=",d7.toISOString().split('T')[0]]],'Bills Due in 7 Days');}

    _openTab(model,id){const t=window.open(`/web#model=${model}&id=${id}&view_type=form`,'_blank');if(t)t.focus();}
    openInvoice(id)    {this._openTab('account.move',id);}
    openTransaction(id){this._openTab('account.payment',id);}
    openPartner(id)    {this._openTab('res.partner',id);}
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
            await this.orm.call('dashboard.data', 'validate_payment', [id]);
            await this.loadAll();
        } catch (e) {
            console.error('Payment validation failed:', e);
            window.alert(e?.data?.message || e?.message || 'Unable to validate this payment.');
        } finally {
            this.state.validatingPaymentId = 0;
        }
    }
    goToBusinessDashboard(){this._syncShared();this.action.doAction("eagle_business_dashboard.advanced_dashboard_action");}
    goToOperationsDashboard(){this._syncShared();this.action.doAction("eagle_business_dashboard.operations_dashboard_action");}

    // ── Saved filter presets ──────────────────────────────────────────────
    async loadSavedFilters() {
        try { this.state.savedFilters = await this.orm.call("dashboard.data","get_saved_filters",['finance']); }
        catch(e) { console.error(e); }
    }
    openSaveFilterPrompt() { this.state.filterNameInput=''; this.state.showSaveFilterPrompt=true; }
    closeSaveFilterPrompt(){ this.state.showSaveFilterPrompt=false; }
    async saveCurrentFilter() {
        if (!this.state.filterNameInput.trim()) return;
        await this.orm.call("dashboard.data","save_filter_preset",
            ['finance', this.state.filterNameInput, this.state.from_date, this.state.to_date,
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

    // ── Bulk actions on invoices ─────────────────────────────────────────
    toggleInvoiceSelect(id) {
        const idx = this.state.selectedInvoiceIds.indexOf(id);
        if (idx === -1) this.state.selectedInvoiceIds.push(id);
        else this.state.selectedInvoiceIds.splice(idx, 1);
    }
    get allInvoicesSelected() {
        return this.filteredInvoices.length > 0 && this.filteredInvoices.every(i => this.state.selectedInvoiceIds.includes(i.id));
    }
    toggleSelectAllInvoices() {
        if (this.allInvoicesSelected) this.state.selectedInvoiceIds = [];
        else this.state.selectedInvoiceIds = this.filteredInvoices.map(i => i.id);
    }
    async bulkMarkPaid() {
        if (!this.state.selectedInvoiceIds.length) return;
        const res = await this.orm.call("dashboard.data","bulk_mark_paid",[this.state.selectedInvoiceIds]);
        this.state.selectedInvoiceIds = [];
        await this.loadAll();
        if (res && res.errors && res.errors.length) {
            this.state.bulkMarkPaidError = `${res.processed} paid successfully. ${res.errors.length} failed: ${res.errors.join('; ')}`;
            setTimeout(()=>{ this.state.bulkMarkPaidError = ''; }, 8000);
        }
    }
    bulkExportSelected() {
        const rows = this.filteredInvoices.filter(i => this.state.selectedInvoiceIds.includes(i.id))
            .map(r => ({'Reference':r.name,'Partner':r.partner,'Date':r.date,'Due Date':r.due_date,'Amount':r.amount,'Outstanding':r.residual,'Status':r.state}));
        this._writeCSV(rows, 'selected_invoices.csv');
    }
}

FinanceDashboard.template = "advanced_business_dashboard.finance_dashboard";
registry.category("actions").add("finance_dashboard_tag", FinanceDashboard);
