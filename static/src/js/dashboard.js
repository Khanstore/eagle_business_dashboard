/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, onWillStart, onWillDestroy, useState } from "@odoo/owl";
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
            trend_data:[], aging:{ar:[],ap:[]},
            operations:{pending_deliveries:[],mismatch:[],stock_value:0},
            customers:{new:0,returning:0,total:0,clv:[]},
            financial:{tax_collected:0,tax_paid:0,tax_net:0,unreconciled_count:0,
                       current_sales:0,previous_sales:0,last_year_sales:0},
            // Visibility & access
            role:'user', visibility:{}, section_labels:{}, all_defaults:{},
            // Filters
            from_date:sharedFilterState.from_date, to_date:sharedFilterState.to_date,
            partner_filter:sharedFilterState.partner_filter,
            active_preset:sharedFilterState.active_preset,
            selected_month:sharedFilterState.selected_month,
            selected_year:sharedFilterState.selected_year,
            partner_id_filter:'', partnerOptions:[],
            sortKey:'', sortOrder:'asc',
            // Quick search
            quickSearch:'', showSearchResults:false,
            // Multi-period tab
            periodTab:'current',
            // Notes
            teamNotes:'', notesSaved:false,
            // Print/export
            showPrintModal:false, printOrderLines:false, printPurchaseLines:false, printTxDetails:true,
            showExportPrompt:false, exportPromptType:'',
            // Target modal
            showTargetModal:false, targetInput:'',
            // Settings panel
            showSettings:false, settingsDraft:{},
            settingsSaved:false, approvalThresholds:{sale_threshold:0,purchase_threshold:0},
            // Auto-refresh
            autoRefresh:false, refreshMins:5,
            // ── Batch 2 ──
            darkMode:false,
            showInsights:false, insightsLoaded:false,
            cashForecast:{current_balance:0,forecast:[]},
            reorderPredictions:[], seasonalHeatmap:[], anomalies:[],
            auditTrail:[], duplicateInvoices:[], missingTaxPartners:[],
            approvalQueue:{sales:[],purchases:[],sale_threshold:0,purchase_threshold:0},
            vendorScorecard:[],
            currencyRates:{base:'',rates:[]}, selectedCurrency:'',
            savedFilters:[], showSaveFilterPrompt:false, filterNameInput:'',
            digestEnabled:false,
            showQuickSale:false, quickSalePartner:'', quickSaleProduct:'', quickSaleQty:1,
            selectedInvoiceIds:[],
            // ── Company branding + Low Stock UX ──
            companyName:'', companyId:0,
            lowStockExpanded:false,
            showSnoozeModal:false, snoozeProductId:0, snoozeProductName:'', snoozeWeeks:1,
        });

        this._orderLines    = {};
        this._purchaseLines = {};
        this._refreshTimer  = null;

        try { this.state.darkMode = localStorage.getItem('eagle_dark_mode') === '1'; } catch(e) {}

        onWillStart(async () => { await this.loadAll(); await this.loadSavedFilters(); });
        onWillDestroy(() => this._stopRefresh());
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
    vis(key) { return this.state.visibility[key] !== false; }

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
    async loadAll() {
        try {
            const [data, widgets, vis, trend, aging, ops, cust, fin, notes, company] = await Promise.all([
                this.orm.call("dashboard.data","get_dashboard",[this.state.from_date||false,this.state.to_date||false]),
                this.orm.call("dashboard.data","get_business_widgets",[]),
                this.orm.call("dashboard.data","get_visibility",[]),
                this.orm.call("dashboard.data","get_trend_data",[this.state.from_date||false,this.state.to_date||false,'sale']),
                this.orm.call("dashboard.data","get_aging_report",[]),
                this.orm.call("dashboard.data","get_operations_data",[]),
                this.orm.call("dashboard.data","get_customer_intelligence",[this.state.from_date||false,this.state.to_date||false]),
                this.orm.call("dashboard.data","get_financial_controls",[this.state.from_date||false,this.state.to_date||false]),
                this.orm.call("dashboard.data","get_team_notes",[]),
                this.orm.call("dashboard.data","get_company_info",[]),
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
        } catch(e) { console.error("Dashboard load error:",e); }
    }

    // ── Partner filter ────────────────────────────────────────────────────
    _ok(r){const q=this.state.partner_filter.trim().toLowerCase(),pid=this.state.partner_id_filter;return(!q||(r.partner||'').toLowerCase().includes(q))&&(!pid||String(r.partner_id)===pid);}
    get filteredOrders()       {return this.state.orders.filter(r=>this._ok(r));}
    get filteredPurchases()    {return this.state.purchases.filter(r=>this._ok(r));}
    get filteredQuotations()   {return this.state.quotations.filter(r=>this._ok(r));}
    get filteredRfq()          {return this.state.rfq.filter(r=>this._ok(r));}
    get filteredTransactions() {return this.state.transactions.filter(r=>this._ok(r));}

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

    // ── Sales target ──────────────────────────────────────────────────────
    get targetPct(){if(!this.state.sales_target)return 0;return Math.min(100,Math.round(this.state.month_sales/this.state.sales_target*100));}

    // ── Trend chart SVG ───────────────────────────────────────────────────
    get chartBars() {
        const data = this.state.trend_data || [];
        if (!data.length) return [];
        const W=380, H=120, pad=4;
        const maxVal = Math.max(...data.map(d=>d.amount), 1);
        const bw = Math.max(4, (W - pad*2) / data.length - 2);
        return data.map((d,i) => {
            const h  = Math.max(2, (d.amount/maxVal)*(H-20));
            const x  = pad + i * ((W-pad*2)/data.length) + ((W-pad*2)/data.length - bw)/2;
            return { x, y:H-h, w:bw, h, label:d.date.slice(5), val:d.amount, date:d.date };
        });
    }
    get chartMaxVal() { const d=this.state.trend_data||[]; return d.length?Math.max(...d.map(r=>r.amount),1):1; }
    get chartTotal()  { return (this.state.trend_data||[]).reduce((s,r)=>s+r.amount,0).toFixed(2); }

    // ── Multi-period ──────────────────────────────────────────────────────
    get multiPeriodVal() {
        const f=this.state.financial;
        if(this.state.periodTab==='previous') return f.previous_sales||0;
        if(this.state.periodTab==='lastyear') return f.last_year_sales||0;
        return f.current_sales||0;
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

    // ── Team notes ────────────────────────────────────────────────────────
    async saveNotes() {
        await this.orm.call("dashboard.data","save_team_notes",[this.state.teamNotes]);
        this.state.notesSaved=true;
        setTimeout(()=>{this.state.notesSaved=false;},2500);
    }

    // ── Settings ─────────────────────────────────────────────────────────
    openSettings() {
        // Deep copy current visibility for each role
        const ad = this.state.all_defaults;
        this.state.settingsDraft = JSON.parse(JSON.stringify(ad));
        // Overlay stored values
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
            if(includeLines){const lines=d.lineCache[r.id]||[];for(const l of lines){const lr={'Row Type':'LINE','Reference':r.name,'Partner':'','Date':'','Status':'','Amount':'','Product':l.product||'','Qty':fmt(l.qty),'UoM':l.uom||'','Rate':fmt(l.price_unit),'Discount%':fmt(l.discount),'Tax':l.tax||'','Line Total':fmt(l.subtotal)};if(d.extraCol)lr[d.extraCol]='';csvRows.push(lr);}if(lines.length){const lt=lines.reduce((s,l)=>s+(parseFloat(l.subtotal)||0),0);const sr={'Row Type':'SUBTOTAL','Reference':r.name,'Partner':'','Date':'','Status':`${lines.length} line(s)`,'Amount':fmt(r.amount),'Product':'','Qty':'','UoM':'','Rate':'','Discount%':'','Tax':'','Line Total':fmt(lt)};if(d.extraCol)sr[d.extraCol]='';csvRows.push(sr);}}
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
        <h1>Business Dashboard – Khan Store</h1><div class="period">Period: ${this.state.from_date||'All'} — ${this.state.to_date||'All'}</div>
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
    openProduct(id){this._openTab('product.product',id);}
    openLowStockList(){this._newTab('product.product',[["type","=","consu"],["qty_available","<=",5],["active","=",true]],'Low Stock Products');}

    // ── Low stock fold/expand ──────────────────────────────────────────────
    toggleLowStock() { this.state.lowStockExpanded = !this.state.lowStockExpanded; }

    // ── Snooze (temporarily hide) low stock product ────────────────────────
    openSnoozeModal(product, ev) {
        if (ev) ev.stopPropagation();
        this.state.snoozeProductId = product.id;
        this.state.snoozeProductName = product.name;
        this.state.snoozeWeeks = 1;
        this.state.showSnoozeModal = true;
    }
    closeSnoozeModal() { this.state.showSnoozeModal = false; }
    async confirmSnooze() {
        await this.orm.call("dashboard.data","snooze_low_stock_product",
            [this.state.snoozeProductId, this.state.snoozeWeeks || 1]);
        this.state.showSnoozeModal = false;
        await this.loadAll();
    }

    // ══════════ BATCH 2 FEATURES ══════════

    // ── Dark mode ────────────────────────────────────────────────────────
    toggleDarkMode() {
        this.state.darkMode = !this.state.darkMode;
        try { localStorage.setItem('eagle_dark_mode', this.state.darkMode ? '1' : '0'); } catch(e) {}
    }

    // ── Insights panel (lazy load) ──────────────────────────────────────
    async toggleInsights() {
        this.state.showInsights = !this.state.showInsights;
        if (this.state.showInsights && !this.state.insightsLoaded) {
            await this.loadInsights();
        }
    }
    async loadInsights() {
        try {
            const [forecast, reorder, heatmap, anomalies, audit, digest, approvals, vendors] = await Promise.all([
                this.orm.call("dashboard.data","get_cash_forecast",[]),
                this.orm.call("dashboard.data","get_reorder_predictions",[]),
                this.orm.call("dashboard.data","get_seasonal_heatmap",[]),
                this.orm.call("dashboard.data","get_anomalies",[]),
                this.orm.call("dashboard.data","get_audit_trail",[15]),
                this.orm.call("dashboard.data","get_digest_status",[]),
                this.orm.call("dashboard.data","get_approval_queue",[]),
                this.orm.call("dashboard.data","get_vendor_scorecard",[]),
            ]);
            Object.assign(this.state, {
                cashForecast: forecast||{current_balance:0,forecast:[]},
                reorderPredictions: reorder||[],
                seasonalHeatmap: heatmap||[],
                anomalies: anomalies||[],
                auditTrail: audit||[],
                digestEnabled: digest ? digest.enabled : false,
                approvalQueue: approvals||{sales:[],purchases:[],sale_threshold:0,purchase_threshold:0},
                vendorScorecard: vendors||[],
                insightsLoaded: true,
            });
        } catch(e) { console.error("Insights load error:", e); }
    }
    async toggleDigest() {
        this.state.digestEnabled = !this.state.digestEnabled;
        await this.orm.call("dashboard.data","toggle_daily_digest",[this.state.digestEnabled]);
    }

    // ── Cash forecast chart points ──────────────────────────────────────
    get forecastPoints() {
        const data = this.state.cashForecast.forecast || [];
        if (!data.length) return '';
        const W=380,H=90; const vals=data.map(d=>d.balance);
        const minV=Math.min(...vals,0), maxV=Math.max(...vals,1);
        const range = (maxV-minV) || 1;
        return data.map((d,i) => {
            const x = (i/(data.length-1))*W;
            const y = H - ((d.balance-minV)/range)*H;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
    }
    get forecastZeroY() {
        const data = this.state.cashForecast.forecast || [];
        if (!data.length) return 45;
        const vals=data.map(d=>d.balance);
        const minV=Math.min(...vals,0), maxV=Math.max(...vals,1);
        const range=(maxV-minV)||1;
        return 90 - ((0-minV)/range)*90;
    }

    // ── Approval queue ────────────────────────────────────────────────────
    async loadApprovalQueue() {
        try { this.state.approvalQueue = await this.orm.call("dashboard.data","get_approval_queue",[]); }
        catch(e) { console.error(e); }
    }
    async approveSaleOrder(id) { await this.orm.call("dashboard.data","approve_sale_order",[id]); await this.loadApprovalQueue(); await this.loadAll(); }

    // ── Currency switcher ─────────────────────────────────────────────────
    async loadCurrencyRates() {
        try {
            this.state.currencyRates = await this.orm.call("dashboard.data","get_currency_rates",[]);
        } catch(e) { console.error(e); }
    }
    onCurrencyChange(ev) { this.state.selectedCurrency = ev.target.value; }
    convertAmount(amount) {
        if (!this.state.selectedCurrency) return amount;
        const r = (this.state.currencyRates.rates||[]).find(x=>x.code===this.state.selectedCurrency);
        return r ? (amount * r.rate) : amount;
    }

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

    // ── Quick Sale (barcode/POS style) ──────────────────────────────────
    openQuickSale() { this.state.quickSalePartner=''; this.state.quickSaleProduct=''; this.state.quickSaleQty=1; this.state.showQuickSale=true; }
    closeQuickSale() { this.state.showQuickSale=false; }
    async submitQuickSale() {
        if (!this.state.quickSaleProduct) return;
        const partnerId = this.state.quickSalePartner ? parseInt(this.state.quickSalePartner) : false;
        const productId = parseInt(this.state.quickSaleProduct);
        const res = await this.orm.call("dashboard.data","create_quick_sale",
            [partnerId, productId, this.state.quickSaleQty || 1, false]);
        this.state.showQuickSale=false;
        if (res && res.id) { this._openTab('sale.order', res.id); await this.loadAll(); }
    }

    // ── Vendor scorecard (lazy) ───────────────────────────────────────────
    async loadVendorScorecard() {
        try { this.state.vendorScorecard = await this.orm.call("dashboard.data","get_vendor_scorecard",[]); }
        catch(e) { console.error(e); }
    }

    // ── Navigation ────────────────────────────────────────────────────────
    _openTab(model,id){const t=window.open(`/web#model=${model}&id=${id}&view_type=form`,'_blank');if(t)t.focus();}
    openOrder(id)      {this._openTab('sale.order',id);}
    openPurchase(id)   {this._openTab('purchase.order',id);}
    openTransaction(id){this._openTab('account.payment',id);}
    openPartner(id)    {this._openTab('res.partner',id);}
    createOrder()      {const t=window.open('/web#model=sale.order&view_type=form','_blank');if(t)t.focus();}
    createPurchase()   {const t=window.open('/web#model=purchase.order&view_type=form','_blank');if(t)t.focus();}
    createPayment(type){const pt=type==='inbound'?'customer':'supplier';const t=window.open(`/web#model=account.payment&view_type=form&default_payment_type=${type}&default_partner_type=${pt}`,'_blank');if(t)t.focus();}
    goToFinanceDashboard(){this._syncShared();this.action.doAction("eagle_business_dashboard.finance_dashboard_action");}
    goToOperationsDashboard(){this._syncShared();this.action.doAction("eagle_business_dashboard.operations_dashboard_action");}
}

Dashboard.template = "advanced_business_dashboard.dashboard";
registry.category("actions").add("advanced_dashboard_tag", Dashboard);
