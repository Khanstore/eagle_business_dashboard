from odoo import models, api, fields
from datetime import timedelta


class DashboardData(models.AbstractModel):
    _name = "dashboard.data"

    # ─────────────────────────────────────────────────────────────────────────
    # Business Dashboard – main data
    # ─────────────────────────────────────────────────────────────────────────
    @api.model
    def get_dashboard(self, from_date=False, to_date=False):
        order_domain     = [('state', '=', 'sale')]
        rfq_domain       = [('state', 'not in', ['purchase', 'done'])]
        purchase_domain  = [('state', 'in',  ['purchase', 'done'])]
        quotation_domain = [('state', '!=', 'sale')]
        payment_domain   = []

        if from_date and to_date:
            date_filter      = [('create_date', '>=', from_date), ('create_date', '<=', to_date)]
            quotation_domain += date_filter
            rfq_domain       += date_filter
            purchase_domain  += date_filter
            order_domain      = [('date_order', '>=', from_date), ('date_order', '<=', to_date), ('state', '=', 'sale')]
            payment_domain    = [('date', '>=', from_date), ('date', '<=', to_date)]

        quotations  = self.env['sale.order'].search(quotation_domain)
        orders      = self.env['sale.order'].search(order_domain)
        purchases   = self.env['purchase.order'].search(purchase_domain)
        payments    = self.env['account.payment'].search(payment_domain)
        rfq         = self.env['purchase.order'].search(rfq_domain)

        def fmt(dt):
            if not dt:
                return ''
            try:
                return dt.strftime('%d/%m/%Y')
            except Exception:
                return str(dt)[:10]

        def sale_lines(order):
            return [{'product': l.product_id.name or l.name or '', 'qty': l.product_uom_qty,
                     'uom': l.product_uom.name or '', 'price_unit': l.price_unit,
                     'discount': getattr(l, 'discount', 0.0) or 0.0,
                     'tax': ', '.join(l.tax_id.mapped('name')) if hasattr(l, 'tax_id') else '',
                     'subtotal': l.price_subtotal}
                    for l in order.order_line.filtered(lambda x: not x.display_type)]

        def purchase_lines(order):
            return [{'product': l.product_id.name or l.name or '', 'qty': l.product_qty,
                     'uom': l.product_uom.name or '', 'price_unit': l.price_unit,
                     'discount': getattr(l, 'discount', 0.0) or 0.0,
                     'tax': ', '.join(l.taxes_id.mapped('name')) if hasattr(l, 'taxes_id') else '',
                     'subtotal': l.price_subtotal}
                    for l in order.order_line.filtered(lambda x: not x.display_type)]

        return {
            'quotations': [{'id': q.id, 'name': q.name, 'partner': q.partner_id.name or '',
                            'partner_id': q.partner_id.id, 'status': q.state, 'date': fmt(q.date_order),
                            'amount': q.amount_total, 'lines': sale_lines(q)} for q in quotations],
            'orders':     [{'id': o.id, 'name': o.name, 'partner': o.partner_id.name or '',
                            'partner_id': o.partner_id.id, 'status': o.state, 'date': fmt(o.date_order),
                            'invoice_status': o.invoice_status, 'amount': o.amount_total,
                            'lines': sale_lines(o)} for o in orders],
            'purchases':  [{'id': p.id, 'name': p.name, 'partner': p.partner_id.name or '',
                            'partner_id': p.partner_id.id, 'status': p.state, 'date': fmt(p.date_order),
                            'billing_status': p.invoice_status, 'amount': p.amount_total,
                            'lines': purchase_lines(p)} for p in purchases],
            'rfq':        [{'id': r.id, 'name': r.name, 'partner': r.partner_id.name or '',
                            'partner_id': r.partner_id.id, 'status': r.state, 'date': fmt(r.date_order),
                            'amount': r.amount_total, 'lines': purchase_lines(r)} for r in rfq],
            'transactions': [{'id': t.id, 'name': t.name or 'Draft', 'partner': t.partner_id.name or '',
                              'partner_id': t.partner_id.id, 'ledger': t.journal_id.name,
                              'date': fmt(t.date),
                              'received': t.amount if t.payment_type == 'inbound' else 0,
                              'paid':     t.amount if t.payment_type == 'outbound' else 0,
                              'state': t.state} for t in payments],
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Business Dashboard – widget KPIs (always unfiltered / current state)
    # ─────────────────────────────────────────────────────────────────────────
    @api.model
    def get_business_widgets(self):
        today          = fields.Date.today()
        first_of_month = today.replace(day=1)
        due_soon_date  = today + timedelta(days=7)

        # ── Overdue invoices ────────────────────────────────────────────────
        overdue_inv = self.env['account.move'].search([
            ('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']),
            ('invoice_date_due', '<', str(today)),
        ])
        # ── Invoices due in next 7 days ─────────────────────────────────────
        due_soon_inv = self.env['account.move'].search([
            ('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']),
            ('invoice_date_due', '>=', str(today)),
            ('invoice_date_due', '<=', str(due_soon_date)),
        ])
        # ── Top 5 customers by total invoiced (all time, posted) ────────────
        self.env.cr.execute("""
            SELECT rp.name, COALESCE(SUM(am.amount_total), 0) AS total
            FROM account_move am
            JOIN res_partner rp ON rp.id = am.partner_id
            WHERE am.move_type = 'out_invoice' AND am.state = 'posted'
            GROUP BY rp.id, rp.name
            ORDER BY total DESC LIMIT 5
        """)
        top_customers = [{'name': r[0] or 'Unknown', 'total': round(float(r[1]), 2)}
                         for r in self.env.cr.fetchall()]

        # ── This month confirmed sales ───────────────────────────────────────
        month_orders  = self.env['sale.order'].search([
            ('state', '=', 'sale'),
            ('date_order', '>=', str(first_of_month)),
            ('date_order', '<=', str(today)),
        ])
        month_sales = sum(month_orders.mapped('amount_total'))

        # ── Sales target (stored in ir.config_parameter) ────────────────────
        param        = self.env['ir.config_parameter'].sudo()
        sales_target = float(param.get_param('eagle_dashboard.sales_target', '0') or '0')

        # ── Low stock (products with qty_available < reorder_min) ───────────
        low_stock = []
        try:
            prods = self.env['product.product'].search([
                ('type', '=', 'consu'), ('qty_available', '<=', 5),
                ('active', '=', True),
            ], limit=10)
            low_stock = [{'name': p.name, 'qty': p.qty_available,
                          'uom': p.uom_id.name} for p in prods]
        except Exception:
            pass

        return {
            'overdue_count':  len(overdue_inv),
            'overdue_amount': round(sum(overdue_inv.mapped('amount_residual')), 2),
            'due_soon_count': len(due_soon_inv),
            'due_soon_amount': round(sum(due_soon_inv.mapped('amount_residual')), 2),
            'top_customers':  top_customers,
            'month_sales':    round(month_sales, 2),
            'sales_target':   sales_target,
            'low_stock':      low_stock,
        }

    @api.model
    def save_sales_target(self, amount):
        self.env['ir.config_parameter'].sudo().set_param(
            'eagle_dashboard.sales_target', str(float(amount)))
        return True

    # ─────────────────────────────────────────────────────────────────────────
    # Finance Dashboard – main data
    # ─────────────────────────────────────────────────────────────────────────
    @api.model
    def get_finance_dashboard(self, from_date=False, to_date=False):
        inv_domain  = [('move_type', '=', 'out_invoice'), ('state', '!=', 'cancel')]
        vend_domain = [('move_type', '=', 'in_invoice'),  ('state', '!=', 'cancel')]
        pay_domain  = []

        if from_date and to_date:
            date_filter  = [('invoice_date', '>=', from_date), ('invoice_date', '<=', to_date)]
            inv_domain  += date_filter
            vend_domain += date_filter
            pay_domain   = [('date', '>=', from_date), ('date', '<=', to_date)]

        invoices     = self.env['account.move'].search(inv_domain)
        vendor_bills = self.env['account.move'].search(vend_domain)
        payments     = self.env['account.payment'].search(pay_domain)

        def fmt(dt):
            if not dt:
                return ''
            try:
                return dt.strftime('%d/%m/%Y')
            except Exception:
                return str(dt)[:10]

        def move_row(m):
            lines = [{'product': l.product_id.name or l.name or '',
                      'qty': l.quantity, 'uom': l.product_uom_id.name or '',
                      'price_unit': l.price_unit, 'discount': l.discount,
                      'tax': ', '.join(l.tax_ids.mapped('name')),
                      'subtotal': l.price_subtotal}
                     for l in m.invoice_line_ids.filtered(
                         lambda x: x.display_type in (False, 'product'))]
            return {'id': m.id, 'name': m.name, 'partner': m.partner_id.name or '',
                    'partner_id': m.partner_id.id, 'date': fmt(m.invoice_date),
                    'due_date': fmt(m.invoice_date_due),
                    'amount': m.amount_total, 'residual': m.amount_residual,
                    'state': m.payment_state, 'lines': lines}

        return {
            'invoices':     [move_row(m) for m in invoices],
            'vendor_bills': [move_row(m) for m in vendor_bills],
            'transactions': [{'id': t.id, 'name': t.name or 'Draft',
                              'partner': t.partner_id.name or '',
                              'partner_id': t.partner_id.id, 'date': fmt(t.date),
                              'journal': t.journal_id.name, 'type': t.payment_type,
                              'received': t.amount if t.payment_type == 'inbound' else 0,
                              'paid':     t.amount if t.payment_type == 'outbound' else 0,
                              'state': t.state} for t in payments],
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Finance Dashboard – widget KPIs
    # ─────────────────────────────────────────────────────────────────────────
    @api.model
    def get_finance_widgets(self):
        today          = fields.Date.today()
        first_of_month = today.replace(day=1)
        due_soon_date  = today + timedelta(days=7)

        # ── Overdue vendor bills ────────────────────────────────────────────
        overdue_bills = self.env['account.move'].search([
            ('move_type', '=', 'in_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']),
            ('invoice_date_due', '<', str(today)),
        ])
        # ── Bills due in next 7 days ────────────────────────────────────────
        due_soon_bills = self.env['account.move'].search([
            ('move_type', '=', 'in_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']),
            ('invoice_date_due', '>=', str(today)),
            ('invoice_date_due', '<=', str(due_soon_date)),
        ])
        # ── Cash flow this month ────────────────────────────────────────────
        journals    = self.env['account.journal'].search([('type', 'in', ['bank', 'cash'])])
        account_ids = journals.mapped('default_account_id').ids or [-1]

        self.env.cr.execute("""
            SELECT COALESCE(SUM(aml.debit - aml.credit), 0.0)
            FROM account_move_line aml JOIN account_move am ON am.id = aml.move_id
            WHERE aml.account_id = ANY(%s) AND am.state = 'posted' AND am.date < %s
        """, (account_ids, str(first_of_month)))
        opening_cash = float(self.env.cr.fetchone()[0] or 0.0)

        self.env.cr.execute("""
            SELECT COALESCE(SUM(aml.debit), 0.0), COALESCE(SUM(aml.credit), 0.0)
            FROM account_move_line aml JOIN account_move am ON am.id = aml.move_id
            WHERE aml.account_id = ANY(%s) AND am.state = 'posted' AND am.date >= %s
        """, (account_ids, str(first_of_month)))
        row          = self.env.cr.fetchone()
        month_in     = float(row[0] or 0.0)
        month_out    = float(row[1] or 0.0)
        current_cash = opening_cash + month_in - month_out

        # ── Overdue customer invoices (for Finance KPI) ─────────────────────
        overdue_inv = self.env['account.move'].search([
            ('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']),
            ('invoice_date_due', '<', str(today)),
        ])

        return {
            'overdue_bills_count':  len(overdue_bills),
            'overdue_bills_amount': round(sum(overdue_bills.mapped('amount_residual')), 2),
            'due_soon_count':       len(due_soon_bills),
            'due_soon_amount':      round(sum(due_soon_bills.mapped('amount_residual')), 2),
            'opening_cash':         round(opening_cash, 2),
            'month_in':             round(month_in, 2),
            'month_out':            round(month_out, 2),
            'current_cash':         round(current_cash, 2),
            'overdue_inv_count':    len(overdue_inv),
            'overdue_inv_amount':   round(sum(overdue_inv.mapped('amount_residual')), 2),
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Journal Balance (with am.date filtering)
    # ─────────────────────────────────────────────────────────────────────────
    @api.model
    def get_journal_balance(self, from_date=False, to_date=False):
        journals = self.env['account.journal'].search(
            [('type', 'in', ['bank', 'cash'])], order='name asc')
        result = []
        for journal in journals:
            account = journal.default_account_id
            if not account:
                continue
            opening = 0.0
            if from_date:
                self.env.cr.execute("""
                    SELECT COALESCE(SUM(aml.debit - aml.credit), 0.0)
                    FROM account_move_line aml JOIN account_move am ON am.id = aml.move_id
                    WHERE aml.account_id = ANY(%s) AND am.state = 'posted' AND am.date < %s
                """, ([account.id], from_date))
                opening = float(self.env.cr.fetchone()[0] or 0.0)

            date_parts, params = [], [account.id]
            if from_date:
                date_parts.append("am.date >= %s"); params.append(from_date)
            if to_date:
                date_parts.append("am.date <= %s"); params.append(to_date)
            date_clause = ("AND " + " AND ".join(date_parts)) if date_parts else ""

            self.env.cr.execute("""
                SELECT COALESCE(SUM(aml.debit),0.0), COALESCE(SUM(aml.credit),0.0),
                       COUNT(*) FILTER (WHERE aml.debit>0), COUNT(*) FILTER (WHERE aml.credit>0)
                FROM account_move_line aml JOIN account_move am ON am.id=aml.move_id
                WHERE aml.account_id=%%s AND am.state='posted' %s
            """ % date_clause, params)
            row            = self.env.cr.fetchone()
            deposit        = float(row[0] or 0.0)
            withdraw       = float(row[1] or 0.0)
            deposit_count  = int(row[2] or 0)
            withdraw_count = int(row[3] or 0)
            change         = deposit - withdraw
            result.append({
                'journal_id':     journal.id,
                'journal_name':   journal.name,
                'opening':        round(opening, 2),
                'deposit':        round(deposit, 2),
                'deposit_count':  deposit_count,
                'withdraw':       round(withdraw, 2),
                'withdraw_count': withdraw_count,
                'change':         round(change, 2),
                'closing':        round(opening + change, 2),
            })
        return result

    # ─────────────────────────────────────────────────────────────────────────
    # Journal drill-down
    # ─────────────────────────────────────────────────────────────────────────
    @api.model
    def get_journal_transactions(self, journal_id, from_date=False, to_date=False):
        domain = [('journal_id', '=', journal_id), ('state', '=', 'posted')]
        if from_date:
            domain.append(('date', '>=', from_date))
        if to_date:
            domain.append(('date', '<=', to_date))
        payments = self.env['account.payment'].search(domain, order='date desc', limit=300)

        def fmt(dt):
            return dt.strftime('%d/%m/%Y') if dt else ''

        return [{'id': p.id, 'name': p.name or 'Draft', 'partner': p.partner_id.name or '',
                 'date': fmt(p.date), 'amount': p.amount, 'type': p.payment_type,
                 'received': p.amount if p.payment_type == 'inbound' else 0,
                 'paid':     p.amount if p.payment_type == 'outbound' else 0,
                 'state': p.state} for p in payments]
