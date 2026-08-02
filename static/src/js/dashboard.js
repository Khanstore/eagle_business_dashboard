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
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            this.monthOptions.push({
                value: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
                label: d.toLocaleString('default',{month:'long',year:'numeric'}),
            });
        }
        this.yearOptions = [];
        for (let y = now.getFullYear(); y >= now.getFullYear()-4; y--) this.yearOptions.push(y);

        this.state = useState({
            // Data
            quotations: [], orders: [], purchases: [], rfq: [], transactions: [],
            // Widgets
            overdue_count:0, overdue_amount:0, due_soon_count:0, due_soon_amount:0,
            top_customers:[], month_sales:0, sales_target:0, low_stock:[],
            // Filters (from shared state)
            from_date:       sharedFilterState.from_date,
            to_date:         sharedFilterState.to_date,
            partner_filter:  sharedFilterState.partner_filter,
            active_preset:   sharedFilterState.active_preset,
            selected_month:  sharedFilterState.selected_month,
            selected_year:   sharedFilterState.selected_year,
            partner_id_filter: '', partnerOptions: [],
            sortKey:'', sortOrder:'asc',
            // Print modal
            showPrintModal:false, printOrderLines:false, printPurchaseLines:false, printTxDetails:true,
            // Target modal
            showTargetModal:false, targetInput:'',
            // Export prompt
            showExportPrompt:false, exportPromptType:'',
            // Auto-refresh
            autoRefresh:false, refreshMins:5,
            // Drill-down (not used in Business, kept for symmetry)
            showDrillModal:false, drillTitle:'', drillTxs:[],
        });

        this._orderLines    = {};
        this._purchaseLines = {};
        this._refreshTimer  = null;

        onWillStart(async () => { await this.loadAll(); });
        onWillDestroy(() => this._stopRefresh());
    }

    // ── Helpers ──────────────────────────────────────────────────────────
    _fmt(d) { return d.toISOString().split('T')[0]; }
    _syncShared() {
        Object.assign(sharedFilterState, {
            from_date: this.state.from_date, to_date: this.state.to_date,
            active_preset: this.state.active_preset,
            selected_month: this.state.selected_month, selected_year: this.state.selected_year,
            partner_filter: this.state.partner_filter,
        });
    }
    _setDates(from, to, preset='custom') {
        this.state.from_date = this._fmt(from); this.state.to_date = this._fmt(to);
        this.state.active_preset = preset; this._syncShared(); this.loadAll();
    }

    // ── Presets ───────────────────────────────────────────────────────────
    applyPreset(p) {
        const n=new Date(), y=n.getFullYear(), m=n.getMonth(), d=n.getDate();
        if (p==='today') { this._setDates(n,n,p); return; }
        if (p==='this_week') {
            const day=n.getDay(), mon=new Date(y,m,d-((day+6)%7)), sun=new Date(y,m,d+(7-((day+6)%7))%7);
            this._setDates(mon,sun,p); return;
        }
        if (p==='this_month') { this._setDates(new Date(y,m,1),new Date(y,m+1,0),p); return; }
        if (p==='this_year')  { this._setDates(new Date(y,0,1),new Date(y,11,31),p); return; }
        if (p==='all') { this.state.from_date=''; this.state.to_date=''; this.state.active_preset='all'; this._syncShared(); this.loadAll(); }
    }
    onMonthChange(ev) { const[y,m]=ev.target.value.split('-').map(Number); this.state.selected_month=ev.target.value; this._setDates(new Date(y,m-1,1),new Date(y,m,0),'custom'); }
    onYearChange(ev)  { const y=Number(ev.target.value); this.state.selected_year=ev.target.value; this._setDates(new Date(y,0,1),new Date(y,11,31),'custom'); }
    onDateChange()    { if(this.state.from_date&&this.state.to_date){this.state.active_preset='custom';this._syncShared();this.loadAll();} }

    // ── Data loading ──────────────────────────────────────────────────────
    async loadAll() {
        try {
            const [data, widgets] = await Promise.all([
                this.orm.call("dashboard.data","get_dashboard",[this.state.from_date||false,this.state.to_date||false]),
                this.orm.call("dashboard.data","get_business_widgets",[]),
            ]);
            this._orderLines={}; this._purchaseLines={};
            const strip = (map,arr) => arr.map(r=>{ map[r.id]=r.lines||[]; const{lines,...rest}=r; return rest; });
            this.state.quotations   = strip(this._orderLines,   data.quotations||[]);
            this.state.orders       = strip(this._orderLines,   data.orders||[]);
            this.state.purchases    = strip(this._purchaseLines, data.purchases||[]);
            this.state.rfq          = strip(this._purchaseLines, data.rfq||[]);
            this.state.transactions = data.transactions||[];
            // Widgets
            Object.assign(this.state, {
                overdue_count: widgets.overdue_count, overdue_amount: widgets.overdue_amount,
                due_soon_count: widgets.due_soon_count, due_soon_amount: widgets.due_soon_amount,
                top_customers: widgets.top_customers, month_sales: widgets.month_sales,
                sales_target: widgets.sales_target, low_stock: widgets.low_stock,
            });
            // Partner options
            const pm={};
            [...this.state.quotations,...this.state.orders,...this.state.purchases,...this.state.rfq,...this.state.transactions]
                .forEach(r=>{ if(r.partner_id&&r.partner) pm[r.partner_id]=r.partner; });
            this.state.partnerOptions = Object.entries(pm).map(([id,name])=>({id:String(id),name})).sort((a,b)=>a.name.localeCompare(b.name));
            if(this.state.sortKey) this._applySort();
        } catch(e) { console.error("Dashboard load error:",e); }
    }

    // ── Partner filter ────────────────────────────────────────────────────
    _ok(r) {
        const q=this.state.partner_filter.trim().toLowerCase(), pid=this.state.partner_id_filter;
        return (!q||(r.partner||'').toLowerCase().includes(q)) && (!pid||String(r.partner_id)===pid);
    }
    get filteredOrders()       { return this.state.orders.filter(r=>this._ok(r)); }
    get filteredPurchases()    { return this.state.purchases.filter(r=>this._ok(r)); }
    get filteredQuotations()   { return this.state.quotations.filter(r=>this._ok(r)); }
    get filteredRfq()          { return this.state.rfq.filter(r=>this._ok(r)); }
    get filteredTransactions() { return this.state.transactions.filter(r=>this._ok(r)); }

    // ── Sorting ───────────────────────────────────────────────────────────
    sortTransactions(key) {
        this.state.sortOrder = this.state.sortKey===key ? (this.state.sortOrder==='asc'?'desc':'asc') : 'asc';
        this.state.sortKey = key; this._applySort();
    }
    _applySort() {
        const k=this.state.sortKey, o=this.state.sortOrder==='asc'?1:-1;
        this.state.transactions.sort((a,b)=>{
            let vA=a[k]??'', vB=b[k]??'';
            return (typeof vA==='number'&&typeof vB==='number') ? (vA-vB)*o : vA.toString().localeCompare(vB.toString())*o;
        });
    }
    get showDateColumn() { const{from_date,to_date}=this.state; return !(from_date&&to_date&&from_date===to_date); }

    // ── Totals ────────────────────────────────────────────────────────────
    _sum(arr,f) { return arr.reduce((s,r)=>s+(r[f]||0),0).toFixed(2); }
    get txTotalReceived() { return this._sum(this.filteredTransactions,'received'); }
    get txTotalPaid()     { return this._sum(this.filteredTransactions,'paid'); }

    // ── Sales target progress ─────────────────────────────────────────────
    get targetPct() {
        if (!this.state.sales_target) return 0;
        return Math.min(100, Math.round((this.state.month_sales / this.state.sales_target) * 100));
    }
    get targetPctPositive() { return this.targetPct >= 100; }

    // ── Auto-refresh ──────────────────────────────────────────────────────
    toggleAutoRefresh() {
        this.state.autoRefresh = !this.state.autoRefresh;
        this.state.autoRefresh ? this._startRefresh() : this._stopRefresh();
    }
    onRefreshMinsChange(ev) { this.state.refreshMins = Number(ev.target.value); if(this.state.autoRefresh){this._stopRefresh();this._startRefresh();} }
    _startRefresh() { this._stopRefresh(); this._refreshTimer = setInterval(()=>this.loadAll(), this.state.refreshMins*60000); }
    _stopRefresh()  { if(this._refreshTimer){clearInterval(this._refreshTimer);this._refreshTimer=null;} }

    // ── CSV Export (with prompt for line items) ───────────────────────────
    _writeCSV(rows, filename) {
        if (!rows || !rows.length) return;
        const keys = Object.keys(rows[0]);
        const lines = [
            keys.join(','),
            ...rows.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))
        ];
        const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename; a.click();
        URL.revokeObjectURL(a.href);
    }

    _exportPrompt(type) {
        // type: 'orders' | 'purchases' | 'quotations' | 'rfq' | 'transactions'
        this.state.exportPromptType = type;
        this.state.showExportPrompt = true;
    }

    exportOrders()    { this._exportPrompt('orders'); }
    exportPurchases() { this._exportPrompt('purchases'); }
    exportQuotes()    { this._exportPrompt('quotations'); }
    exportRfq()       { this._exportPrompt('rfq'); }
    exportTx()        { this._exportPrompt('transactions'); }

    closeExportPrompt() { this.state.showExportPrompt = false; }

    doExport(includeLines) {
        const type = this.state.exportPromptType;
        this.state.showExportPrompt = false;

        const fmt = v => { const n = parseFloat(v); return isNaN(n) ? '' : n.toFixed(2); };

        if (type === 'transactions') {
            const rows = this.filteredTransactions.map(r => ({
                'Reference': r.name, 'Partner': r.partner, 'Date': r.date,
                'Ledger': r.ledger, 'Received': fmt(r.received), 'Paid': fmt(r.paid), 'Status': r.state,
            }));
            this._writeCSV(rows, 'transactions.csv');
            return;
        }

        // Sale / purchase orders with optional lines
        const datasets = {
            orders:     { records: this.filteredOrders,     lineCache: this._orderLines,    file: 'orders.csv',      extraCol: 'Invoice Status', extraField: 'invoice_status' },
            quotations: { records: this.filteredQuotations, lineCache: this._orderLines,    file: 'quotations.csv',  extraCol: null },
            purchases:  { records: this.filteredPurchases,  lineCache: this._purchaseLines, file: 'purchases.csv',   extraCol: 'Billing Status', extraField: 'billing_status' },
            rfq:        { records: this.filteredRfq,        lineCache: this._purchaseLines, file: 'rfq.csv',         extraCol: null },
        };
        const ds = datasets[type];

        const csvRows = [];
        for (const r of ds.records) {
            // Summary row
            const row = {
                'Row Type': 'RECORD',
                'Reference': r.name,
                'Partner': r.partner,
                'Date': r.date,
                'Status': r.status,
                'Amount': fmt(r.amount),
                'Product': '', 'Qty': '', 'UoM': '', 'Rate': '', 'Discount%': '', 'Tax': '', 'Line Total': '',
            };
            if (ds.extraCol) row[ds.extraCol] = r[ds.extraField] || '';
            csvRows.push(row);

            // Line rows
            if (includeLines) {
                const lines = ds.lineCache[r.id] || [];
                for (const l of lines) {
                    const lineRow = {
                        'Row Type': 'LINE',
                        'Reference': r.name,
                        'Partner': '',
                        'Date': '',
                        'Status': '',
                        'Amount': '',
                        'Product': l.product || '',
                        'Qty': fmt(l.qty),
                        'UoM': l.uom || '',
                        'Rate': fmt(l.price_unit),
                        'Discount%': fmt(l.discount),
                        'Tax': l.tax || '',
                        'Line Total': fmt(l.subtotal),
                    };
                    if (ds.extraCol) lineRow[ds.extraCol] = '';
                    csvRows.push(lineRow);
                }
                // Subtotal row after lines
                if (lines.length > 0) {
                    const lineTotal = lines.reduce((s, l) => s + (parseFloat(l.subtotal) || 0), 0);
                    const subRow = {
                        'Row Type': 'SUBTOTAL',
                        'Reference': r.name,
                        'Partner': '',
                        'Date': '',
                        'Status': `${lines.length} line(s)`,
                        'Amount': fmt(r.amount),
                        'Product': '',
                        'Qty': '',
                        'UoM': '',
                        'Rate': '',
                        'Discount%': '',
                        'Tax': '',
                        'Line Total': fmt(lineTotal),
                    };
                    if (ds.extraCol) subRow[ds.extraCol] = '';
                    csvRows.push(subRow);
                }
            }
        }
        this._writeCSV(csvRows, ds.file);
    }

    // ── Sales target modal ────────────────────────────────────────────────
    openTargetModal()  { this.state.targetInput = String(this.state.sales_target||''); this.state.showTargetModal=true; }
    closeTargetModal() { this.state.showTargetModal=false; }
    async saveTarget() {
        const val = parseFloat(this.state.targetInput)||0;
        await this.orm.call("dashboard.data","save_sales_target",[val]);
        this.state.sales_target = val; this.state.showTargetModal=false;
    }

    // ── Print modal ───────────────────────────────────────────────────────
    openPrintModal()  { this.state.showPrintModal=true; }
    closePrintModal() { this.state.showPrintModal=false; }

    doPrint() {
        const incOrd=this.state.printOrderLines, incPur=this.state.printPurchaseLines, incTx=this.state.printTxDetails;
        const orders    = this.filteredOrders.map(r=>({...r,lines:this._orderLines[r.id]||[]}));
        const purchases = this.filteredPurchases.map(r=>({...r,lines:this._purchaseLines[r.id]||[]}));
        const quotations= this.filteredQuotations.map(r=>({...r,lines:this._orderLines[r.id]||[]}));
        const rfq       = this.filteredRfq.map(r=>({...r,lines:this._purchaseLines[r.id]||[]}));
        const txs       = [...this.filteredTransactions];
        this.state.showPrintModal=false;

        const fmt  = v => { const n=parseFloat(v); return isNaN(n)?'0.00':n.toFixed(2); };
        const styles= Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l=>`<link rel="stylesheet" href="${l.href}">`).join('');

        const buildTable = (records,cols,includeLines) => {
            if(!records.length) return '<p style="color:#888;font-size:12px">No records.</p>';
            const ths = cols.map(c=>`<th style="background:#1a1f36;color:#fff;padding:8px 12px;text-align:left;font-size:11px">${c.label}</th>`).join('');
            let html = `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px"><thead><tr>${ths}</tr></thead><tbody>`;
            for(const r of records){
                const tds = cols.map(c=>`<td style="padding:7px 12px;border-bottom:1px solid #e5e7eb">${c.val(r)}</td>`).join('');
                html += `<tr style="background:#fff">${tds}</tr>`;
                if(includeLines&&r.lines&&r.lines.length){
                    const lh = ['Product','Qty','Rate','Disc%','Tax','Total'].map(h=>`<th style="background:#f1f5f9;padding:4px 8px;font-size:10px;text-align:left">${h}</th>`).join('');
                    const lb = r.lines.map(l=>`<tr><td style="padding:4px 8px;font-size:10px">${l.product}</td><td style="padding:4px 8px;font-size:10px;text-align:right">${fmt(l.qty)}</td><td style="padding:4px 8px;font-size:10px;text-align:right">${fmt(l.price_unit)}</td><td style="padding:4px 8px;font-size:10px;text-align:right">${fmt(l.discount)}</td><td style="padding:4px 8px;font-size:10px">${l.tax}</td><td style="padding:4px 8px;font-size:10px;text-align:right;font-weight:700">${fmt(l.subtotal)}</td></tr>`).join('');
                    html += `<tr><td colspan="${cols.length}" style="padding:2px 24px 10px"><table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px"><thead><tr>${lh}</tr></thead><tbody>${lb}</tbody></table></td></tr>`;
                }
            }
            return html+'</tbody></table>';
        };

        const ordCols = [
            {label:'Reference',val:r=>r.name},{label:'Partner',val:r=>r.partner},
            {label:'Date',val:r=>r.date},{label:'Status',val:r=>r.status},
            {label:'Inv. Status',val:r=>r.invoice_status||''},{label:'Amount',val:r=>fmt(r.amount)},
        ];
        const purCols = [
            {label:'Reference',val:r=>r.name},{label:'Partner',val:r=>r.partner},
            {label:'Date',val:r=>r.date},{label:'Status',val:r=>r.status},
            {label:'Bill Status',val:r=>r.billing_status||''},{label:'Amount',val:r=>fmt(r.amount)},
        ];
        const txCols = [
            {label:'Reference',val:r=>r.name},{label:'Partner',val:r=>r.partner},
            {label:'Date',val:r=>r.date},{label:'Ledger',val:r=>r.ledger},
            {label:'Received',val:r=>fmt(r.received)},{label:'Paid',val:r=>fmt(r.paid)},{label:'Status',val:r=>r.state},
        ];

        const pw = window.open('','_blank','width=1200,height=800');
        pw.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Business Dashboard</title>${styles}
        <style>body{margin:0;padding:20px;font-family:sans-serif;background:#fff}h1{font-size:20px;color:#1a1f36;margin:0 0 4px}h2{font-size:14px;font-weight:700;color:#1a1f36;margin:20px 0 8px;padding-bottom:4px;border-bottom:2px solid #1a1f36}
        .period{font-size:11px;color:#6b7280;margin-bottom:16px}.summary{border-collapse:collapse;margin:12px 0 20px;min-width:400px}
        .summary th,.summary td{padding:6px 14px;border:1px solid #d1d5db;font-size:12px}.summary thead tr{background:#f8fafc}
        @media print{@page{margin:10mm;size:A4 landscape}body{font-size:10px;padding:0}}</style></head><body>
        <h1>Business Dashboard – Khan Store</h1>
        <div class="period">Period: ${this.state.from_date||'All'} — ${this.state.to_date||'All'}</div>
        <table class="summary"><thead><tr><th>Section</th><th>Records</th><th>Total Amount</th></tr></thead><tbody>
        <tr><td>Orders</td><td>${orders.length}</td><td>${fmt(orders.reduce((s,r)=>s+(r.amount||0),0))}</td></tr>
        <tr><td>Purchase</td><td>${purchases.length}</td><td>${fmt(purchases.reduce((s,r)=>s+(r.amount||0),0))}</td></tr>
        <tr><td>Quotations</td><td>${quotations.length}</td><td>${fmt(quotations.reduce((s,r)=>s+(r.amount||0),0))}</td></tr>
        <tr><td>RFQ</td><td>${rfq.length}</td><td>${fmt(rfq.reduce((s,r)=>s+(r.amount||0),0))}</td></tr>
        </tbody></table>
        <h2>Orders (${orders.length})</h2>${buildTable(orders,ordCols,incOrd)}
        <h2>Purchase (${purchases.length})</h2>${buildTable(purchases,purCols,incPur)}
        <h2>Quotations (${quotations.length})</h2>${buildTable(quotations,ordCols.filter(c=>c.label!=='Inv. Status'),incOrd)}
        <h2>RFQ (${rfq.length})</h2>${buildTable(rfq,purCols.filter(c=>c.label!=='Bill Status'),incPur)}
        ${incTx?`<h2>Transactions (${txs.length})</h2>${buildTable(txs,txCols,false)}`:''}
        </body></html>`);
        pw.document.close();
        pw.onload = ()=>{ pw.focus(); pw.print(); pw.close(); };
        setTimeout(()=>{ try{pw.focus();pw.print();pw.close();}catch(e){} },1800);
    }

    // ── KPI card actions ──────────────────────────────────────────────────
    _today() { const d=new Date(); return d.toISOString().split('T')[0]; }
    _firstOfMonth() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }

    openOverdueInvoices() {
        this.action.doAction({
            type:"ir.actions.act_window", name:"Overdue Invoices",
            res_model:"account.move", view_mode:"list,form",
            views:[[false,"list"],[false,"form"]],
            domain:[["move_type","=","out_invoice"],["state","=","posted"],
                    ["payment_state","not in",["paid","in_payment"]],
                    ["invoice_date_due","<",this._today()]],
            context:{default_move_type:"out_invoice"},
            target:"current",
        });
    }
    openDueSoonInvoices() {
        const d7=new Date(); d7.setDate(d7.getDate()+7);
        this.action.doAction({
            type:"ir.actions.act_window", name:"Invoices Due in 7 Days",
            res_model:"account.move", view_mode:"list,form",
            views:[[false,"list"],[false,"form"]],
            domain:[["move_type","=","out_invoice"],["state","=","posted"],
                    ["payment_state","not in",["paid","in_payment"]],
                    ["invoice_date_due",">=",this._today()],
                    ["invoice_date_due","<=",d7.toISOString().split('T')[0]]],
            context:{default_move_type:"out_invoice"},
            target:"current",
        });
    }
    openMonthSales() {
        this.action.doAction({
            type:"ir.actions.act_window", name:"This Month's Orders",
            res_model:"sale.order", view_mode:"list,form",
            views:[[false,"list"],[false,"form"]],
            domain:[["state","=","sale"],
                    ["date_order",">=",this._firstOfMonth()],
                    ["date_order","<=",this._today()]],
            target:"current",
        });
    }

    // ── Navigation ────────────────────────────────────────────────────────
    _openTab(model, id) {
        const url = `/web#model=${model}&id=${id}&view_type=form`;
        const tab = window.open(url, '_blank');
        if (tab) tab.focus();
    }
    openOrder(id)       { this._openTab('sale.order', id); }
    openPurchase(id)    { this._openTab('purchase.order', id); }
    openTransaction(id) { this._openTab('account.payment', id); }
    openPartner(id)     { this._openTab('res.partner', id); }
    createOrder()    { this.action.doAction({type:"ir.actions.act_window",res_model:"sale.order",views:[[false,"form"]],target:"new"},{onClose:()=>this.loadAll()}); }
    createPurchase() { this.action.doAction({type:"ir.actions.act_window",res_model:"purchase.order",views:[[false,"form"]],target:"new"},{onClose:()=>this.loadAll()}); }
    createPayment(type) {
        this.action.doAction({type:"ir.actions.act_window",res_model:"account.payment",views:[[false,"form"]],target:"new",
            context:{default_payment_type:type,default_partner_type:type==='inbound'?'customer':'supplier'}},
            {onClose:()=>this.loadAll()});
    }
    goToFinanceDashboard() { this._syncShared(); this.action.doAction("eagle_business_dashboard.finance_dashboard_action"); }
}

Dashboard.template = "advanced_business_dashboard.dashboard";
registry.category("actions").add("advanced_dashboard_tag", Dashboard);
