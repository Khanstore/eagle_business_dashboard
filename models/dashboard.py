from odoo import models, api, fields
from datetime import timedelta
import json


# ─── Default visibility per group ────────────────────────────────────────────
_DEFAULT_VISIBILITY = {
    "admin": {
        "kpi":True,"analytics":True,"chart":True,"operations":True,
        "customers":True,"aging":True,"financial":True,"notes":True,
        "journal":True,"transactions":True,"clv":True,"quick_search":True,
        "multi_period":True,"settings":True,
    },
    "manager": {
        "kpi":True,"analytics":True,"chart":True,"operations":True,
        "customers":True,"aging":True,"financial":False,"notes":True,
        "journal":True,"transactions":True,"clv":True,"quick_search":True,
        "multi_period":True,"settings":False,
    },
    "user": {
        "kpi":True,"analytics":False,"chart":False,"operations":False,
        "customers":False,"aging":False,"financial":False,"notes":True,
        "journal":False,"transactions":True,"clv":False,"quick_search":True,
        "multi_period":False,"settings":False,
    },
}

SECTION_LABELS = {
    "kpi":          "KPI Cards",
    "analytics":    "Analytics widgets (P&L, AOV, tax)",
    "chart":        "Sales / Finance trend chart",
    "operations":   "Operations (deliveries, stock, mismatches)",
    "customers":    "Customer intelligence (new vs returning)",
    "aging":        "AR / AP Aging report",
    "financial":    "Financial controls (tax, unreconciled)",
    "notes":        "Team notes panel",
    "journal":      "Journal Balance table",
    "transactions": "Transaction table",
    "clv":          "Customer Lifetime Value table",
    "quick_search": "Quick search bar",
    "multi_period": "Multi-period comparison toggle",
    "settings":     "Settings panel (admin only)",
}


class DashboardData(models.AbstractModel):
    _name = "dashboard.data"

    # ─── Helpers ─────────────────────────────────────────────────────────────
    def _fmt(self, dt):
        if not dt:
            return ''
        try:
            return dt.strftime('%d/%m/%Y')
        except Exception:
            return str(dt)[:10]

    def _get_user_role(self):
        user = self.env.user
        if user.has_group('eagle_business_dashboard.group_dashboard_admin'):
            return 'admin'
        if user.has_group('eagle_business_dashboard.group_dashboard_manager'):
            return 'manager'
        return 'user'

    # ─── Access / Visibility ─────────────────────────────────────────────────
    @api.model
    def get_visibility(self):
        param = self.env['ir.config_parameter'].sudo()
        stored = param.get_param('eagle_dashboard.visibility', False)
        try:
            cfg = json.loads(stored) if stored else {}
        except Exception:
            cfg = {}
        role = self._get_user_role()
        default = dict(_DEFAULT_VISIBILITY.get(role, _DEFAULT_VISIBILITY['user']))
        default.update(cfg.get(role, {}))
        return {
            'role': role,
            'visibility': default,
            'section_labels': SECTION_LABELS,
            'all_defaults': _DEFAULT_VISIBILITY,
        }

    @api.model
    def save_visibility(self, config):
        """config = {'admin': {...}, 'manager': {...}, 'user': {...}}"""
        if not self.env.user.has_group('eagle_business_dashboard.group_dashboard_admin'):
            return False
        self.env['ir.config_parameter'].sudo().set_param(
            'eagle_dashboard.visibility', json.dumps(config))
        return True

    # ─── Team Notes ──────────────────────────────────────────────────────────
    @api.model
    def get_team_notes(self):
        return self.env['ir.config_parameter'].sudo().get_param(
            'eagle_dashboard.team_notes', '')

    @api.model
    def save_team_notes(self, notes):
        self.env['ir.config_parameter'].sudo().set_param(
            'eagle_dashboard.team_notes', notes)
        return True

    # ─── Sales Target ─────────────────────────────────────────────────────────
    @api.model
    def save_sales_target(self, amount):
        self.env['ir.config_parameter'].sudo().set_param(
            'eagle_dashboard.sales_target', str(float(amount)))
        return True

    # ─── Business Dashboard – main data ──────────────────────────────────────
    @api.model
    def get_dashboard(self, from_date=False, to_date=False):
        order_domain     = [('state', '=', 'sale')]
        rfq_domain       = [('state', 'not in', ['purchase', 'done'])]
        purchase_domain  = [('state', 'in',  ['purchase', 'done'])]
        quotation_domain = [('state', '!=', 'sale')]
        payment_domain   = []

        if from_date and to_date:
            df = [('create_date', '>=', from_date), ('create_date', '<=', to_date)]
            quotation_domain += df; rfq_domain += df; purchase_domain += df
            order_domain = [('date_order','>=',from_date),('date_order','<=',to_date),('state','=','sale')]
            payment_domain = [('date','>=',from_date),('date','<=',to_date)]

        quotations = self.env['sale.order'].search(quotation_domain)
        orders     = self.env['sale.order'].search(order_domain)
        purchases  = self.env['purchase.order'].search(purchase_domain)
        payments   = self.env['account.payment'].search(payment_domain)
        rfq        = self.env['purchase.order'].search(rfq_domain)

        def sale_lines(o):
            return [{'product':l.product_id.name or l.name or '','qty':l.product_uom_qty,
                     'uom':l.product_uom.name or '','price_unit':l.price_unit,
                     'discount':getattr(l,'discount',0.0) or 0.0,
                     'tax':', '.join(l.tax_id.mapped('name')) if hasattr(l,'tax_id') else '',
                     'subtotal':l.price_subtotal}
                    for l in o.order_line.filtered(lambda x: not x.display_type)]

        def pur_lines(o):
            return [{'product':l.product_id.name or l.name or '','qty':l.product_qty,
                     'uom':l.product_uom.name or '','price_unit':l.price_unit,
                     'discount':getattr(l,'discount',0.0) or 0.0,
                     'tax':', '.join(l.taxes_id.mapped('name')) if hasattr(l,'taxes_id') else '',
                     'subtotal':l.price_subtotal}
                    for l in o.order_line.filtered(lambda x: not x.display_type)]

        f = self._fmt
        return {
            'quotations':[{'id':q.id,'name':q.name,'partner':q.partner_id.name or '','partner_id':q.partner_id.id,
                           'status':q.state,'date':f(q.date_order),'amount':q.amount_total,'lines':sale_lines(q)} for q in quotations],
            'orders':    [{'id':o.id,'name':o.name,'partner':o.partner_id.name or '','partner_id':o.partner_id.id,
                           'status':o.state,'date':f(o.date_order),'invoice_status':o.invoice_status,
                           'amount':o.amount_total,'lines':sale_lines(o)} for o in orders],
            'purchases': [{'id':p.id,'name':p.name,'partner':p.partner_id.name or '','partner_id':p.partner_id.id,
                           'status':p.state,'date':f(p.date_order),'billing_status':p.invoice_status,
                           'amount':p.amount_total,'lines':pur_lines(p)} for p in purchases],
            'rfq':       [{'id':r.id,'name':r.name,'partner':r.partner_id.name or '','partner_id':r.partner_id.id,
                           'status':r.state,'date':f(r.date_order),'amount':r.amount_total,'lines':pur_lines(r)} for r in rfq],
            'transactions':[{'id':t.id,'name':t.name or 'Draft','partner':t.partner_id.name or '','partner_id':t.partner_id.id,
                             'ledger':t.journal_id.name,'date':f(t.date),
                             'received':t.amount if t.payment_type=='inbound' else 0,
                             'paid':t.amount if t.payment_type=='outbound' else 0,'state':t.state} for t in payments],
        }

    # ─── Business Widgets (KPI) ───────────────────────────────────────────────
    @api.model
    def get_business_widgets(self):
        today = fields.Date.today()
        fom   = today.replace(day=1)
        d7    = today + timedelta(days=7)
        param = self.env['ir.config_parameter'].sudo()

        overdue = self.env['account.move'].search([('move_type','=','out_invoice'),('state','=','posted'),
            ('payment_state','not in',['paid','in_payment']),('invoice_date_due','<',str(today))])
        due_soon = self.env['account.move'].search([('move_type','=','out_invoice'),('state','=','posted'),
            ('payment_state','not in',['paid','in_payment']),
            ('invoice_date_due','>=',str(today)),('invoice_date_due','<=',str(d7))])
        month_orders = self.env['sale.order'].search([('state','=','sale'),
            ('date_order','>=',str(fom)),('date_order','<=',str(today))])
        month_sales  = sum(month_orders.mapped('amount_total'))
        sales_target = float(param.get_param('eagle_dashboard.sales_target','0') or '0')

        self.env.cr.execute("""
            SELECT rp.name, COALESCE(SUM(am.amount_total),0) as total
            FROM account_move am JOIN res_partner rp ON rp.id=am.partner_id
            WHERE am.move_type='out_invoice' AND am.state='posted'
            GROUP BY rp.id,rp.name ORDER BY total DESC LIMIT 5""")
        top_customers = [{'name':r[0] or 'Unknown','total':round(float(r[1]),2)} for r in self.env.cr.fetchall()]

        low_stock = []
        try:
            snoozed_ids = self.env['dashboard.snoozed.product'].sudo().search(
                [('hide_until', '>=', str(today))]).mapped('product_id').ids
            prods = self.env['product.product'].search([
                ('type', '=', 'consu'), ('qty_available', '<=', 5), ('active', '=', True),
                ('id', 'not in', snoozed_ids),
            ], limit=20)
            low_stock = [{'id': p.id, 'name': p.name, 'qty': p.qty_available, 'uom': p.uom_id.name} for p in prods]
        except Exception:
            pass

        return {
            'overdue_count':len(overdue),'overdue_amount':round(sum(overdue.mapped('amount_residual')),2),
            'due_soon_count':len(due_soon),'due_soon_amount':round(sum(due_soon.mapped('amount_residual')),2),
            'top_customers':top_customers,'month_sales':round(month_sales,2),
            'sales_target':sales_target,'low_stock':low_stock,
        }

    # ─── Trend Chart Data ─────────────────────────────────────────────────────
    @api.model
    def get_trend_data(self, from_date=False, to_date=False, model='sale'):
        """
        Returns daily aggregated amounts for the selected period.
        model: 'sale' (sale orders) or 'invoice' (posted customer invoices)
        """
        if not from_date:
            today = fields.Date.today()
            from_date = str(today.replace(day=1))
            to_date   = str(today)

        if model == 'sale':
            self.env.cr.execute("""
                SELECT DATE(date_order) as d, COALESCE(SUM(amount_total),0)
                FROM sale_order
                WHERE state IN ('sale','done')
                  AND DATE(date_order) >= %s AND DATE(date_order) <= %s
                GROUP BY d ORDER BY d
            """, (from_date, to_date))
        else:
            self.env.cr.execute("""
                SELECT invoice_date as d, COALESCE(SUM(amount_total),0)
                FROM account_move
                WHERE move_type='out_invoice' AND state='posted'
                  AND invoice_date >= %s AND invoice_date <= %s
                GROUP BY d ORDER BY d
            """, (from_date, to_date))

        rows = self.env.cr.fetchall()
        return [{'date': str(r[0]), 'amount': round(float(r[1]), 2)} for r in rows]

    # ─── Aging Report ────────────────────────────────────────────────────────
    @api.model
    def get_aging_report(self):
        result = {'ar': [], 'ap': []}
        for move_type, key in [('out_invoice','ar'), ('in_invoice','ap')]:
            self.env.cr.execute("""
                SELECT
                    CASE
                        WHEN CURRENT_DATE - invoice_date_due BETWEEN 1  AND 30 THEN '1-30'
                        WHEN CURRENT_DATE - invoice_date_due BETWEEN 31 AND 60 THEN '31-60'
                        WHEN CURRENT_DATE - invoice_date_due BETWEEN 61 AND 90 THEN '61-90'
                        ELSE '90+'
                    END as bucket,
                    COUNT(*) as cnt,
                    COALESCE(SUM(amount_residual),0) as total
                FROM account_move
                WHERE move_type=%s AND state='posted'
                  AND payment_state NOT IN ('paid','in_payment')
                  AND invoice_date_due < CURRENT_DATE
                GROUP BY bucket
                ORDER BY bucket
            """, (move_type,))
            result[key] = [{'bucket':r[0],'count':int(r[1]),'total':round(float(r[2]),2)}
                           for r in self.env.cr.fetchall()]
        return result

    # ─── Operations Data ─────────────────────────────────────────────────────
    @api.model
    def get_operations_data(self):
        pending_deliveries, mismatch, stock_value = [], [], 0.0

        try:
            pickings = self.env['stock.picking'].search([
                ('picking_type_code','=','outgoing'),
                ('state','not in',['done','cancel']),
            ], limit=20)
            for p in pickings:
                late = p.scheduled_date and p.scheduled_date.date() < fields.Date.today()
                pending_deliveries.append({
                    'name':p.name,'partner':p.partner_id.name or '',
                    'date':self._fmt(p.scheduled_date.date() if p.scheduled_date else None),
                    'state':p.state,'late':late,
                })
        except Exception:
            pass

        try:
            # Purchase orders with qty_received != product_qty
            pos = self.env['purchase.order'].search([('state','in',['purchase','done'])], limit=100)
            for p in pos:
                for l in p.order_line:
                    if abs(l.qty_received - l.product_qty) > 0.01:
                        mismatch.append({
                            'po':p.name,'partner':p.partner_id.name or '',
                            'product':l.product_id.name or '',
                            'ordered':round(l.product_qty,2),
                            'received':round(l.qty_received,2),
                            'diff':round(l.product_qty - l.qty_received,2),
                        })
                        if len(mismatch) >= 15:
                            break
                if len(mismatch) >= 15:
                    break
        except Exception:
            pass

        try:
            self.env.cr.execute("""
                SELECT COALESCE(SUM(svl.value),0) FROM stock_valuation_layer svl""")
            row = self.env.cr.fetchone()
            stock_value = round(float(row[0] or 0), 2)
        except Exception:
            pass

        return {'pending_deliveries':pending_deliveries,'mismatch':mismatch,'stock_value':stock_value}

    # ─── Customer Intelligence ────────────────────────────────────────────────
    @api.model
    def get_customer_intelligence(self, from_date=False, to_date=False):
        today = str(fields.Date.today())
        fd = from_date or today[:8] + '01'
        td = to_date   or today

        # Partners with orders in period
        self.env.cr.execute("""
            SELECT DISTINCT partner_id FROM sale_order
            WHERE state IN ('sale','done') AND DATE(date_order) >= %s AND DATE(date_order) <= %s
        """, (fd, td))
        period_partners = {r[0] for r in self.env.cr.fetchall()}

        # Partners with orders BEFORE period
        self.env.cr.execute("""
            SELECT DISTINCT partner_id FROM sale_order
            WHERE state IN ('sale','done') AND DATE(date_order) < %s
        """, (fd,))
        before_partners = {r[0] for r in self.env.cr.fetchall()}

        new_count       = len(period_partners - before_partners)
        returning_count = len(period_partners & before_partners)

        # CLV top 10
        self.env.cr.execute("""
            SELECT rp.id, rp.name,
                   COUNT(DISTINCT so.id)        as orders,
                   COALESCE(SUM(so.amount_total),0) as total,
                   COALESCE(AVG(so.amount_total),0) as avg_val,
                   MAX(so.date_order)            as last_order
            FROM sale_order so
            JOIN res_partner rp ON rp.id=so.partner_id
            WHERE so.state IN ('sale','done')
            GROUP BY rp.id,rp.name
            ORDER BY total DESC LIMIT 10
        """)
        clv = [{'id':r[0],'name':r[1] or 'Unknown','orders':int(r[2]),
                'total':round(float(r[3]),2),'avg':round(float(r[4]),2),
                'last_order':str(r[5])[:10] if r[5] else ''} for r in self.env.cr.fetchall()]

        return {'new':new_count,'returning':returning_count,'total':new_count+returning_count,'clv':clv}

    # ─── Financial Controls ───────────────────────────────────────────────────
    @api.model
    def get_financial_controls(self, from_date=False, to_date=False):
        today = str(fields.Date.today())
        fd = from_date or today[:8] + '01'
        td = to_date   or today

        # Tax collected (on customer invoices)
        self.env.cr.execute("""
            SELECT COALESCE(SUM(aml.credit-aml.debit),0)
            FROM account_move_line aml
            JOIN account_move am    ON am.id  = aml.move_id
            JOIN account_account aa ON aa.id  = aml.account_id
            WHERE am.move_type='out_invoice' AND am.state='posted'
              AND aa.account_type='liability_tax'
              AND DATE(am.invoice_date) >= %s AND DATE(am.invoice_date) <= %s
        """, (fd, td))
        tax_collected = round(float(self.env.cr.fetchone()[0] or 0), 2)

        # Tax paid (on vendor bills)
        self.env.cr.execute("""
            SELECT COALESCE(SUM(aml.debit-aml.credit),0)
            FROM account_move_line aml
            JOIN account_move am    ON am.id  = aml.move_id
            JOIN account_account aa ON aa.id  = aml.account_id
            WHERE am.move_type='in_invoice' AND am.state='posted'
              AND aa.account_type='asset_receivable'
              AND DATE(am.invoice_date) >= %s AND DATE(am.invoice_date) <= %s
        """, (fd, td))
        tax_paid = round(float(self.env.cr.fetchone()[0] or 0), 2)

        # Unreconciled bank lines
        unreconciled_count = 0
        try:
            self.env.cr.execute("""
                SELECT COUNT(*) FROM account_bank_statement_line
                WHERE is_reconciled=false AND journal_id IN (
                    SELECT id FROM account_journal WHERE type IN ('bank','cash'))
            """)
            unreconciled_count = int(self.env.cr.fetchone()[0] or 0)
        except Exception:
            pass

        # Multi-period comparison: current, previous same length, same period last year
        try:
            from datetime import date as ddate
            fd_dt = ddate.fromisoformat(fd)
            td_dt = ddate.fromisoformat(td)
            span  = (td_dt - fd_dt).days + 1
            prev_from = str(fd_dt - timedelta(days=span))
            prev_to   = str(td_dt - timedelta(days=span))
            ly_from   = str(fd_dt.replace(year=fd_dt.year-1))
            ly_to     = str(td_dt.replace(year=td_dt.year-1))

            def period_sales(f, t):
                self.env.cr.execute("""
                    SELECT COALESCE(SUM(amount_total),0) FROM sale_order
                    WHERE state IN ('sale','done') AND DATE(date_order) >= %s AND DATE(date_order) <= %s
                """, (f, t))
                return round(float(self.env.cr.fetchone()[0] or 0), 2)

            current_sales  = period_sales(fd, td)
            previous_sales = period_sales(prev_from, prev_to)
            last_year_sales= period_sales(ly_from, ly_to)
        except Exception:
            current_sales = previous_sales = last_year_sales = 0.0

        return {
            'tax_collected': tax_collected, 'tax_paid': tax_paid,
            'tax_net': round(tax_collected - tax_paid, 2),
            'unreconciled_count': unreconciled_count,
            'current_sales': current_sales,
            'previous_sales': previous_sales,
            'last_year_sales': last_year_sales,
        }

    # ─── Finance Dashboard – main data ───────────────────────────────────────
    @api.model
    def get_finance_dashboard(self, from_date=False, to_date=False):
        inv_dom  = [('move_type','=','out_invoice'),('state','!=','cancel')]
        vend_dom = [('move_type','=','in_invoice'), ('state','!=','cancel')]
        pay_dom  = []
        if from_date and to_date:
            df = [('invoice_date','>=',from_date),('invoice_date','<=',to_date)]
            inv_dom  += df; vend_dom += df
            pay_dom   = [('date','>=',from_date),('date','<=',to_date)]

        invoices     = self.env['account.move'].search(inv_dom)
        vendor_bills = self.env['account.move'].search(vend_dom)
        payments     = self.env['account.payment'].search(pay_dom)
        f = self._fmt

        def move_row(m):
            lines = [{'product':l.product_id.name or l.name or '','qty':l.quantity,
                      'uom':l.product_uom_id.name or '','price_unit':l.price_unit,
                      'discount':l.discount,'tax':', '.join(l.tax_ids.mapped('name')),
                      'subtotal':l.price_subtotal}
                     for l in m.invoice_line_ids.filtered(lambda x: x.display_type in (False,'product'))]
            return {'id':m.id,'name':m.name,'partner':m.partner_id.name or '',
                    'partner_id':m.partner_id.id,'date':f(m.invoice_date),
                    'due_date':f(m.invoice_date_due),'amount':m.amount_total,
                    'residual':m.amount_residual,'state':m.payment_state,'lines':lines}

        return {
            'invoices':     [move_row(m) for m in invoices],
            'vendor_bills': [move_row(m) for m in vendor_bills],
            'transactions': [{'id':t.id,'name':t.name or 'Draft','partner':t.partner_id.name or '',
                              'partner_id':t.partner_id.id,'date':f(t.date),'journal':t.journal_id.name,
                              'type':t.payment_type,
                              'received':t.amount if t.payment_type=='inbound' else 0,
                              'paid':    t.amount if t.payment_type=='outbound' else 0,
                              'state':t.state} for t in payments],
        }

    # ─── Finance Widgets (KPI) ────────────────────────────────────────────────
    @api.model
    def get_finance_widgets(self):
        today = fields.Date.today()
        fom   = today.replace(day=1)
        d7    = today + timedelta(days=7)

        overdue_bills = self.env['account.move'].search([('move_type','=','in_invoice'),('state','=','posted'),
            ('payment_state','not in',['paid','in_payment']),('invoice_date_due','<',str(today))])
        due_soon_bills= self.env['account.move'].search([('move_type','=','in_invoice'),('state','=','posted'),
            ('payment_state','not in',['paid','in_payment']),
            ('invoice_date_due','>=',str(today)),('invoice_date_due','<=',str(d7))])
        overdue_inv   = self.env['account.move'].search([('move_type','=','out_invoice'),('state','=','posted'),
            ('payment_state','not in',['paid','in_payment']),('invoice_date_due','<',str(today))])

        journals    = self.env['account.journal'].search([('type','in',['bank','cash'])])
        account_ids = journals.mapped('default_account_id').ids or [-1]
        self.env.cr.execute("SELECT COALESCE(SUM(aml.debit-aml.credit),0) FROM account_move_line aml JOIN account_move am ON am.id=aml.move_id WHERE aml.account_id=ANY(%s) AND am.state='posted' AND am.date<%s",
            (account_ids, str(fom)))
        opening_cash = float(self.env.cr.fetchone()[0] or 0)
        self.env.cr.execute("SELECT COALESCE(SUM(aml.debit),0),COALESCE(SUM(aml.credit),0) FROM account_move_line aml JOIN account_move am ON am.id=aml.move_id WHERE aml.account_id=ANY(%s) AND am.state='posted' AND am.date>=%s",
            (account_ids, str(fom)))
        row=self.env.cr.fetchone(); month_in=float(row[0] or 0); month_out=float(row[1] or 0)

        # P&L for the month
        self.env.cr.execute("SELECT COALESCE(SUM(amount_total),0) FROM account_move WHERE move_type='out_invoice' AND state='posted' AND invoice_date>=%s", (str(fom),))
        revenue = float(self.env.cr.fetchone()[0] or 0)
        self.env.cr.execute("SELECT COALESCE(SUM(amount_total),0) FROM account_move WHERE move_type='in_invoice' AND state='posted' AND invoice_date>=%s", (str(fom),))
        costs   = float(self.env.cr.fetchone()[0] or 0)

        return {
            'overdue_bills_count':len(overdue_bills),'overdue_bills_amount':round(sum(overdue_bills.mapped('amount_residual')),2),
            'due_soon_count':len(due_soon_bills),'due_soon_amount':round(sum(due_soon_bills.mapped('amount_residual')),2),
            'overdue_inv_count':len(overdue_inv),'overdue_inv_amount':round(sum(overdue_inv.mapped('amount_residual')),2),
            'opening_cash':round(opening_cash,2),'month_in':round(month_in,2),
            'month_out':round(month_out,2),'current_cash':round(opening_cash+month_in-month_out,2),
            'revenue':round(revenue,2),'costs':round(costs,2),
            'gross_profit':round(revenue-costs,2),
            'margin_pct':round((revenue-costs)/revenue*100,1) if revenue else 0,
        }

    # ─── Journal Balance ─────────────────────────────────────────────────────
    @api.model
    def get_journal_balance(self, from_date=False, to_date=False):
        journals = self.env['account.journal'].search([('type','in',['bank','cash'])], order='name asc')
        result   = []
        for journal in journals:
            account = journal.default_account_id
            if not account: continue
            opening = 0.0
            if from_date:
                self.env.cr.execute("SELECT COALESCE(SUM(aml.debit-aml.credit),0) FROM account_move_line aml JOIN account_move am ON am.id=aml.move_id WHERE aml.account_id=ANY(%s) AND am.state='posted' AND am.date<%s", ([account.id], from_date))
                opening = float(self.env.cr.fetchone()[0] or 0)
            parts=[]; params=[account.id]
            if from_date: parts.append("am.date>=%s"); params.append(from_date)
            if to_date:   parts.append("am.date<=%s"); params.append(to_date)
            dc = ("AND "+" AND ".join(parts)) if parts else ""
            self.env.cr.execute("""SELECT COALESCE(SUM(aml.debit),0),COALESCE(SUM(aml.credit),0),
                COUNT(*) FILTER(WHERE aml.debit>0),COUNT(*) FILTER(WHERE aml.credit>0)
                FROM account_move_line aml JOIN account_move am ON am.id=aml.move_id
                WHERE aml.account_id=%%s AND am.state='posted' %s""" % dc, params)
            row=self.env.cr.fetchone()
            deposit=float(row[0] or 0); withdraw=float(row[1] or 0)
            change=deposit-withdraw
            result.append({'journal_id':journal.id,'journal_name':journal.name,
                'opening':round(opening,2),'deposit':round(deposit,2),'deposit_count':int(row[2] or 0),
                'withdraw':round(withdraw,2),'withdraw_count':int(row[3] or 0),
                'change':round(change,2),'closing':round(opening+change,2)})
        return result

    # ─── Company Info (name + logo for header) ────────────────────────────
    @api.model
    def get_company_info(self):
        c = self.env.company
        return {'id': c.id, 'name': c.name}

    # ─── Snooze / Hide Low Stock Product Temporarily ──────────────────────
    @api.model
    def snooze_low_stock_product(self, product_id, weeks):
        until = fields.Date.today() + timedelta(weeks=int(weeks or 1))
        rec = self.env['dashboard.snoozed.product'].sudo().search([('product_id', '=', product_id)], limit=1)
        if rec:
            rec.write({'hide_until': until})
        else:
            self.env['dashboard.snoozed.product'].sudo().create({'product_id': product_id, 'hide_until': until})
        return {'hide_until': str(until)}

    @api.model
    def unsnooze_low_stock_product(self, product_id):
        self.env['dashboard.snoozed.product'].sudo().search([('product_id', '=', product_id)]).unlink()
        return True

    # ─── Dynamic List Action (for KPI card "view details" links) ─────────
    @api.model
    def open_dynamic_action(self, model, domain, name='Dashboard List'):
        """
        Creates a real ir.actions.act_window record so that KPI card
        drill-down links can open a proper Odoo 18 client action URL
        (/odoo/action-<id>) in a new tab, instead of relying on the legacy
        '/web#model=...&view_type=list' hash format which the Odoo 18
        client no longer resolves reliably (it falls back to the home menu).
        """
        action = self.env['ir.actions.act_window'].sudo().create({
            'name': name,
            'res_model': model,
            'view_mode': 'list,form',
            'domain': domain,
            'target': 'current',
        })
        return action.id

    # ═════════════════════════════════════════════════════════════════════
    # OPERATIONS DASHBOARD (Delivery Orders / Receipts / Internal Transfers)
    # ═════════════════════════════════════════════════════════════════════
    @api.model
    def get_operations_dashboard(self, from_date=False, to_date=False):
        domain = []
        if from_date and to_date:
            domain = [('scheduled_date', '>=', from_date), ('scheduled_date', '<=', to_date + ' 23:59:59')]

        def row(p):
            today = fields.Date.today()
            sched = p.scheduled_date.date() if p.scheduled_date else None
            return {
                'id': p.id,
                'name': p.name,
                'partner': p.partner_id.name or '',
                'partner_id': p.partner_id.id,
                'scheduled_date': self._fmt(sched) if sched else '',
                'date_done': self._fmt(p.date_done.date()) if p.date_done else '',
                'state': p.state,
                'origin': p.origin or '',
                'products_count': len(p.move_ids),
                'late': bool(sched and sched < today and p.state not in ('done', 'cancel')),
            }

        deliveries = self.env['stock.picking'].search(
            domain + [('picking_type_id.code', '=', 'outgoing')], order='scheduled_date desc', limit=200)
        receipts = self.env['stock.picking'].search(
            domain + [('picking_type_id.code', '=', 'incoming')], order='scheduled_date desc', limit=200)
        internal = self.env['stock.picking'].search(
            domain + [('picking_type_id.code', '=', 'internal')], order='scheduled_date desc', limit=200)

        return {
            'deliveries': [row(p) for p in deliveries],
            'receipts':   [row(p) for p in receipts],
            'internal':   [row(p) for p in internal],
        }

    @api.model
    def get_operations_widgets(self):
        today = fields.Date.today()
        pending_deliveries = self.env['stock.picking'].search_count([
            ('picking_type_id.code', '=', 'outgoing'), ('state', 'not in', ('done', 'cancel'))])
        pending_receipts = self.env['stock.picking'].search_count([
            ('picking_type_id.code', '=', 'incoming'), ('state', 'not in', ('done', 'cancel'))])
        late = self.env['stock.picking'].search_count([
            ('state', 'not in', ('done', 'cancel')), ('scheduled_date', '<', str(today))])
        today_done = self.env['stock.picking'].search_count([
            ('state', '=', 'done'), ('date_done', '>=', str(today))])
        return {
            'pending_deliveries': pending_deliveries,
            'pending_receipts': pending_receipts,
            'late': late,
            'today_done': today_done,
        }

    @api.model
    def validate_picking(self, picking_id):
        picking = self.env['stock.picking'].browse(picking_id)
        if picking.exists() and picking.state not in ('done', 'cancel'):
            try:
                picking.button_validate()
                return True
            except Exception:
                return False
        return False


    @api.model
    def get_journal_transactions(self, journal_id, from_date=False, to_date=False):
        domain = [('journal_id','=',journal_id),('state','=','posted')]
        if from_date: domain.append(('date','>=',from_date))
        if to_date:   domain.append(('date','<=',to_date))
        payments = self.env['account.payment'].search(domain, order='date desc', limit=300)
        f = self._fmt
        return [{'id':p.id,'name':p.name or 'Draft','partner':p.partner_id.name or '',
                 'date':f(p.date),'amount':p.amount,'type':p.payment_type,
                 'received':p.amount if p.payment_type=='inbound' else 0,
                 'paid':    p.amount if p.payment_type=='outbound' else 0,
                 'state':p.state} for p in payments]

    # ═════════════════════════════════════════════════════════════════════
    # NEW FEATURES BATCH 2
    # ═════════════════════════════════════════════════════════════════════

    # ─── 1. Cash Flow Forecast (next 30 days) ─────────────────────────────
    @api.model
    def get_cash_forecast(self):
        today = fields.Date.today()
        journals = self.env['account.journal'].search([('type', 'in', ['bank', 'cash'])])
        account_ids = journals.mapped('default_account_id').ids or [-1]
        self.env.cr.execute("""
            SELECT COALESCE(SUM(aml.debit - aml.credit), 0.0)
            FROM account_move_line aml JOIN account_move am ON am.id = aml.move_id
            WHERE aml.account_id = ANY(%s) AND am.state = 'posted' AND am.date <= %s
        """, (account_ids, str(today)))
        current_balance = float(self.env.cr.fetchone()[0] or 0)

        expected_in = self.env['account.move'].search([
            ('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']),
            ('invoice_date_due', '>=', str(today)),
        ])
        expected_out = self.env['account.move'].search([
            ('move_type', '=', 'in_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']),
            ('invoice_date_due', '>=', str(today)),
        ])

        daily = {}
        for m in expected_in:
            d = str(m.invoice_date_due)
            daily.setdefault(d, {'in': 0.0, 'out': 0.0})
            daily[d]['in'] += m.amount_residual
        for m in expected_out:
            d = str(m.invoice_date_due)
            daily.setdefault(d, {'in': 0.0, 'out': 0.0})
            daily[d]['out'] += m.amount_residual

        result, running = [], current_balance
        for i in range(31):
            d = today + timedelta(days=i)
            ds = str(d)
            day = daily.get(ds, {'in': 0.0, 'out': 0.0})
            running += day['in'] - day['out']
            result.append({'date': ds, 'in': round(day['in'], 2), 'out': round(day['out'], 2), 'balance': round(running, 2)})
        return {'current_balance': round(current_balance, 2), 'forecast': result}

    # ─── 2. Reorder Point Predictor ───────────────────────────────────────
    @api.model
    def get_reorder_predictions(self):
        result = []
        try:
            today = fields.Date.today()
            month_ago = today - timedelta(days=30)
            prods = self.env['product.product'].search([('type', '=', 'consu'), ('active', '=', True)], limit=200)
            for p in prods:
                self.env.cr.execute("""
                    SELECT COALESCE(SUM(sol.product_uom_qty), 0)
                    FROM sale_order_line sol JOIN sale_order so ON so.id = sol.order_id
                    WHERE sol.product_id = %s AND so.state IN ('sale','done')
                      AND so.date_order >= %s
                """, (p.id, str(month_ago)))
                sold_30d = float(self.env.cr.fetchone()[0] or 0)
                if sold_30d <= 0:
                    continue
                daily_rate = sold_30d / 30.0
                days_left = round(p.qty_available / daily_rate, 1) if daily_rate > 0 else 999
                if days_left <= 14:
                    result.append({
                        'name': p.name, 'qty': round(p.qty_available, 1),
                        'daily_rate': round(daily_rate, 2), 'days_left': days_left,
                        'uom': p.uom_id.name,
                    })
            result.sort(key=lambda x: x['days_left'])
        except Exception:
            pass
        return result[:10]

    # ─── 3. Seasonal Heatmap (sales by day-of-week × week-of-month) ──────
    @api.model
    def get_seasonal_heatmap(self):
        self.env.cr.execute("""
            SELECT EXTRACT(DOW FROM date_order)::int as dow,
                   COALESCE(AVG(amount_total), 0) as avg_amt,
                   COUNT(*) as cnt
            FROM sale_order
            WHERE state IN ('sale','done') AND date_order >= CURRENT_DATE - INTERVAL '180 days'
            GROUP BY dow ORDER BY dow
        """)
        rows = self.env.cr.fetchall()
        days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
        return [{'day': days[int(r[0])], 'avg_amount': round(float(r[1]), 2), 'count': int(r[2])} for r in rows]

    # ─── 4. Anomaly Detection ─────────────────────────────────────────────
    @api.model
    def get_anomalies(self):
        result = []
        self.env.cr.execute("""
            SELECT COALESCE(AVG(amount_total),0), COALESCE(STDDEV(amount_total),0)
            FROM sale_order WHERE state IN ('sale','done')
              AND date_order >= CURRENT_DATE - INTERVAL '90 days'
        """)
        row = self.env.cr.fetchone()
        avg_amt, std_amt = float(row[0] or 0), float(row[1] or 0)
        threshold = avg_amt + 3 * std_amt if std_amt else avg_amt * 5
        if threshold > 0:
            orders = self.env['sale.order'].search([
                ('state', 'in', ['sale', 'done']),
                ('amount_total', '>', threshold),
                ('date_order', '>=', str(fields.Date.today() - timedelta(days=30))),
            ], limit=10)
            for o in orders:
                result.append({
                    'type': 'Sale Order', 'name': o.name, 'partner': o.partner_id.name or '',
                    'amount': o.amount_total, 'avg': round(avg_amt, 2),
                    'multiple': round(o.amount_total / avg_amt, 1) if avg_amt else 0,
                    'id': o.id,
                })
        return result

    # ─── 5. Audit Trail Widget ─────────────────────────────────────────────
    @api.model
    def get_audit_trail(self, limit=15):
        result = []
        try:
            logs = self.env['mail.message'].search([
                ('model', 'in', ['sale.order', 'purchase.order', 'account.move', 'account.payment']),
                ('message_type', '=', 'notification'),
            ], order='date desc', limit=limit)
            for l in logs:
                result.append({
                    'model': l.model, 'res_id': l.res_id,
                    'author': l.author_id.name or 'System',
                    'date': l.date.strftime('%d/%m/%Y %H:%M') if l.date else '',
                    'summary': (l.subject or l.preview or 'Record updated')[:80],
                })
        except Exception:
            pass
        return result

    # ─── 6. Duplicate Invoice/Payment Detector ────────────────────────────
    @api.model
    def get_duplicate_invoices(self):
        self.env.cr.execute("""
            SELECT array_agg(id) as ids, partner_id, amount_total, invoice_date
            FROM account_move
            WHERE move_type = 'in_invoice' AND state = 'posted'
              AND invoice_date >= CURRENT_DATE - INTERVAL '90 days'
            GROUP BY partner_id, amount_total, invoice_date
            HAVING COUNT(*) > 1
            LIMIT 10
        """)
        rows = self.env.cr.fetchall()
        result = []
        for r in rows:
            ids = r[0]
            partner = self.env['res.partner'].browse(r[1]).name if r[1] else 'Unknown'
            moves = self.env['account.move'].browse(ids)
            result.append({
                'partner': partner, 'amount': round(float(r[2] or 0), 2),
                'date': str(r[3]) if r[3] else '',
                'refs': moves.mapped('name'), 'ids': ids,
            })
        return result

    # ─── 7. Missing Tax ID Warning ─────────────────────────────────────────
    @api.model
    def get_missing_tax_id_partners(self):
        self.env.cr.execute("""
            SELECT DISTINCT rp.id, rp.name
            FROM res_partner rp
            JOIN account_move am ON am.partner_id = rp.id
            WHERE am.state = 'posted' AND (rp.vat IS NULL OR rp.vat = '')
              AND am.move_type IN ('out_invoice','in_invoice')
            LIMIT 15
        """)
        return [{'id': r[0], 'name': r[1] or 'Unknown'} for r in self.env.cr.fetchall()]

    # ─── 8. Approval Queue ──────────────────────────────────────────────────
    @api.model
    def get_approval_queue(self):
        cfg = self.env['dashboard.approval.config'].get_config()
        result = {'sales': [], 'purchases': [], 'sale_threshold': cfg['sale_threshold'], 'purchase_threshold': cfg['purchase_threshold']}
        if cfg['sale_threshold'] > 0:
            orders = self.env['sale.order'].search([
                ('state', '=', 'draft'), ('amount_total', '>=', cfg['sale_threshold']),
            ], limit=15)
            result['sales'] = [{'id': o.id, 'name': o.name, 'partner': o.partner_id.name or '',
                                 'amount': o.amount_total} for o in orders]
        if cfg['purchase_threshold'] > 0:
            pos = self.env['purchase.order'].search([
                ('state', '=', 'draft'), ('amount_total', '>=', cfg['purchase_threshold']),
            ], limit=15)
            result['purchases'] = [{'id': p.id, 'name': p.name, 'partner': p.partner_id.name or '',
                                     'amount': p.amount_total} for p in pos]
        return result

    @api.model
    def approve_sale_order(self, order_id):
        order = self.env['sale.order'].browse(order_id)
        if order.exists() and order.state == 'draft':
            order.action_confirm()
            return True
        return False

    @api.model
    def approve_purchase_order(self, order_id):
        order = self.env['purchase.order'].browse(order_id)
        if order.exists() and order.state == 'draft':
            order.button_confirm()
            return True
        return False

    # ─── 10. Daily Digest Email ────────────────────────────────────────────
    def send_daily_digest(self):
        today = fields.Date.today()
        widgets = self.get_business_widgets()
        finw = self.get_finance_widgets()
        self.env.cr.execute("""
            SELECT COALESCE(SUM(amount_total),0) FROM sale_order
            WHERE state IN ('sale','done') AND DATE(date_order) = %s
        """, (str(today),))
        today_sales = float(self.env.cr.fetchone()[0] or 0)

        template = self.env.ref('eagle_business_dashboard.mail_template_daily_digest', raise_if_not_found=False)
        if not template:
            return
        admins = self.env['res.users'].search([('groups_id', '=', self.env.ref('eagle_business_dashboard.group_dashboard_admin').id)])
        for user in admins:
            if not user.email:
                continue
            ctx = {
                'digest_date': str(today),
                'today_sales': f"{today_sales:.2f}",
                'overdue_count': widgets['overdue_count'],
                'overdue_amount': f"{widgets['overdue_amount']:.2f}",
                'cash_balance': f"{finw['current_cash']:.2f}",
                'low_stock_count': len(widgets['low_stock']),
            }
            template.with_context(**ctx).send_mail(user.id, force_send=True)

    @api.model
    def toggle_daily_digest(self, enabled):
        cron = self.env.ref('eagle_business_dashboard.cron_daily_digest', raise_if_not_found=False)
        if cron:
            cron.sudo().write({'active': bool(enabled)})
        return True

    @api.model
    def get_digest_status(self):
        cron = self.env.ref('eagle_business_dashboard.cron_daily_digest', raise_if_not_found=False)
        return {'enabled': bool(cron and cron.active)}

    # ─── 11. Per-user Layout ───────────────────────────────────────────────
    @api.model
    def get_user_layout(self, dashboard='business'):
        key = f'eagle_dashboard.layout.{dashboard}.{self.env.uid}'
        stored = self.env['ir.config_parameter'].sudo().get_param(key, '')
        try:
            return json.loads(stored) if stored else {}
        except Exception:
            return {}

    @api.model
    def save_user_layout(self, dashboard, layout):
        key = f'eagle_dashboard.layout.{dashboard}.{self.env.uid}'
        self.env['ir.config_parameter'].sudo().set_param(key, json.dumps(layout))
        return True

    # ─── 13. Currency Rates ────────────────────────────────────────────────
    @api.model
    def get_currency_rates(self):
        company_currency = self.env.company.currency_id
        currencies = self.env['res.currency'].search([('active', '=', True)], limit=15)
        result = []
        for c in currencies:
            if c.id == company_currency.id:
                continue
            try:
                rate = c._get_conversion_rate(company_currency, c, self.env.company, fields.Date.today())
                result.append({'code': c.name, 'symbol': c.symbol, 'rate': round(rate, 4)})
            except Exception:
                continue
        return {'base': company_currency.name, 'rates': result}

    # ─── 14. Bulk Actions ──────────────────────────────────────────────────
    @api.model
    def bulk_mark_paid(self, move_ids):
        moves = self.env['account.move'].browse(move_ids).filtered(lambda m: m.state == 'posted')
        count = 0
        for m in moves:
            try:
                m.js_assign_outstanding_line(m.id)
                count += 1
            except Exception:
                continue
        return {'processed': count}

    # ─── 15. Saved Filter Presets ──────────────────────────────────────────
    @api.model
    def get_saved_filters(self, dashboard='business'):
        filters = self.env['dashboard.saved.filter'].search([
            ('dashboard', '=', dashboard), ('user_id', '=', self.env.uid)
        ], order='create_date desc')
        return [{'id': f.id, 'name': f.name, 'from_date': f.from_date, 'to_date': f.to_date,
                 'partner_filter': f.partner_filter, 'active_preset': f.active_preset} for f in filters]

    @api.model
    def save_filter_preset(self, dashboard, name, from_date, to_date, partner_filter, active_preset):
        self.env['dashboard.saved.filter'].create({
            'dashboard': dashboard, 'name': name, 'from_date': from_date or '',
            'to_date': to_date or '', 'partner_filter': partner_filter or '',
            'active_preset': active_preset or '',
        })
        return True

    @api.model
    def delete_filter_preset(self, filter_id):
        f = self.env['dashboard.saved.filter'].browse(filter_id)
        if f.exists() and f.user_id.id == self.env.uid:
            f.unlink()
        return True

    # ─── 16. Quick Sale (barcode/POS style) ────────────────────────────────
    @api.model
    def create_quick_sale(self, partner_id, product_id, qty, price_unit=False):
        partner = self.env['res.partner'].browse(partner_id) if partner_id else self.env.ref('base.public_partner', raise_if_not_found=False)
        product = self.env['product.product'].browse(product_id)
        if not product.exists():
            return {'error': 'Product not found'}
        vals = {
            'partner_id': partner.id if partner else self.env.user.partner_id.id,
            'order_line': [(0, 0, {
                'product_id': product.id, 'product_uom_qty': qty,
                'price_unit': price_unit if price_unit else product.list_price,
            })],
        }
        order = self.env['sale.order'].create(vals)
        return {'id': order.id, 'name': order.name}

    # ─── 17. Vendor Scorecard ───────────────────────────────────────────────
    @api.model
    def get_vendor_scorecard(self):
        self.env.cr.execute("""
            SELECT rp.id, rp.name, COUNT(po.id) as po_count,
                   COALESCE(SUM(po.amount_total), 0) as total_spent
            FROM purchase_order po
            JOIN res_partner rp ON rp.id = po.partner_id
            WHERE po.state IN ('purchase','done')
            GROUP BY rp.id, rp.name
            ORDER BY total_spent DESC LIMIT 10
        """)
        vendors = self.env.cr.fetchall()
        result = []
        for v_id, v_name, po_count, total_spent in vendors:
            pos = self.env['purchase.order'].search([('partner_id', '=', v_id), ('state', 'in', ['purchase', 'done'])])
            on_time, late, mismatch_count = 0, 0, 0
            for po in pos:
                pickings = po.picking_ids.filtered(lambda p: p.state == 'done')
                for pick in pickings:
                    if pick.date_done and pick.scheduled_date:
                        if pick.date_done.date() <= pick.scheduled_date.date():
                            on_time += 1
                        else:
                            late += 1
                for line in po.order_line:
                    if abs(line.qty_received - line.product_qty) > 0.01:
                        mismatch_count += 1
            total_deliveries = on_time + late
            on_time_pct = round(on_time / total_deliveries * 100, 1) if total_deliveries else None
            result.append({
                'id': v_id, 'name': v_name or 'Unknown', 'po_count': po_count,
                'total_spent': round(float(total_spent), 2),
                'on_time_pct': on_time_pct, 'mismatch_count': mismatch_count,
            })
        return result
