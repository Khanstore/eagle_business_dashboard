from odoo import models, api


class DashboardData(models.AbstractModel):
    _name = "dashboard.data"

    @api.model
    def get_dashboard(self, from_date=False, to_date=False):
        # Base domains using correct Odoo operators
        order_domain = [('state', '=', 'sale')]
        rfq_domain = [('state', 'not in', ['purchase', 'done'])]
        purchase_domain = [('state', 'in', ['purchase', 'done'])]
        quotation_domain = [('state', '!=', 'sale')]
        payment_domain = []

        if from_date and to_date:
            # Applying date filters to all models
            # Note: For sales/purchase we usually use date_order, for payments we use date
            date_filter = [('create_date', '>=', from_date), ('create_date', '<=', to_date)]

            quotation_domain += date_filter
            rfq_domain += date_filter
            purchase_domain += date_filter
            order_domain = [('date_order', '>=', from_date), ('date_order', '<=', to_date), ('state', '=', 'sale')]
            payment_domain = [('date', '>=', from_date), ('date', '<=', to_date)]

        # Executing searches
        quotations = self.env['sale.order'].search(quotation_domain)
        orders = self.env['sale.order'].search(order_domain)
        purchases = self.env['purchase.order'].search(purchase_domain)
        payments = self.env['account.payment'].search(payment_domain)
        rfq = self.env['purchase.order'].search(rfq_domain)

        # ── Line item helpers (for printable order/purchase lines) ──────
        def sale_line_rows(order):
            rows = []
            for l in order.order_line.filtered(lambda x: not x.display_type):
                rows.append({
                    "product":    l.product_id.name or l.name or "",
                    "qty":        l.product_uom_qty,
                    "uom":        l.product_uom.name or "",
                    "price_unit": l.price_unit,
                    "discount":   getattr(l, 'discount', 0.0) or 0.0,
                    "tax":        ", ".join(l.tax_id.mapped("name")) if hasattr(l, 'tax_id') else "",
                    "subtotal":   l.price_subtotal,
                })
            return rows

        def purchase_line_rows(order):
            rows = []
            for l in order.order_line.filtered(lambda x: not x.display_type):
                rows.append({
                    "product":    l.product_id.name or l.name or "",
                    "qty":        l.product_qty,
                    "uom":        l.product_uom.name or "",
                    "price_unit": l.price_unit,
                    "discount":   getattr(l, 'discount', 0.0) or 0.0,
                    "tax":        ", ".join(l.taxes_id.mapped("name")) if hasattr(l, 'taxes_id') else "",
                    "subtotal":   l.price_subtotal,
                })
            return rows

        # ── Date formatting helper ────────────────────────────────────
        def fmt_date(dt):
            if not dt:
                return ''
            try:
                return dt.strftime('%Y-%m-%d')
            except Exception:
                return str(dt)[:10]

        return {
            "quotations": [{
                "id": q.id,
                "name": q.name,
                "partner": q.partner_id.name or "Public User",
                "partner_id": q.partner_id.id,
                "status": q.state,
                "date": fmt_date(q.date_order),
                "amount": q.amount_total,
                "lines": sale_line_rows(q),
            } for q in quotations],
            "orders": [{
                "id": o.id,
                "name": o.name,
                "partner": o.partner_id.name or "Public User",
                "partner_id": o.partner_id.id,
                "status": o.state,
                "invoice_status": o.invoice_status,
                "date": fmt_date(o.date_order),
                "amount": o.amount_total,
                "lines": sale_line_rows(o),
            } for o in orders],
            "purchases": [{
                "id": p.id,
                "name": p.name,
                "partner": p.partner_id.name or "Supplier",
                "partner_id": p.partner_id.id,
                "status": p.state,
                "billing_status": p.invoice_status,
                "date": fmt_date(p.date_order),
                "amount": p.amount_total,
                "lines": purchase_line_rows(p),
            } for p in purchases],
            "rfq": [{
                "id": r.id,
                "name": r.name,
                "partner_id": r.partner_id.id,
                "partner": r.partner_id.name or "Supplier",
                "status": r.state,
                "date": fmt_date(r.date_order),
                "amount": r.amount_total,
                "lines": purchase_line_rows(r),
            } for r in rfq],
            "transactions": [{
                "id": t.id,
                "name": t.name or "Draft Payment",
                "partner_id": t.partner_id.id,
                "partner": t.partner_id.name or "No Partner",
                "ledger": t.journal_id.name,
                "date": fmt_date(t.date),
                "received": t.amount if t.payment_type == 'inbound' else 0,
                "paid": t.amount if t.payment_type == 'outbound' else 0,
                "state": t.state
            } for t in payments]
        }
    @api.model
    def get_finance_dashboard(self, from_date=False, to_date=False):
        invoice_domain = [('move_type', '=', 'out_invoice'), ('state', '!=', 'cancel')]
        vendor_domain  = [('move_type', '=', 'in_invoice'),  ('state', '!=', 'cancel')]
        payment_domain = []

        if from_date and to_date:
            date_filter = [('invoice_date', '>=', from_date), ('invoice_date', '<=', to_date)]
            invoice_domain += date_filter
            vendor_domain  += date_filter
            payment_domain  = [('date', '>=', from_date), ('date', '<=', to_date)]

        invoices     = self.env['account.move'].search(invoice_domain)
        vendor_bills = self.env['account.move'].search(vendor_domain)
        payments     = self.env['account.payment'].search(payment_domain)

        def move_row(m):
            lines = []
            for l in m.invoice_line_ids.filtered(lambda x: x.display_type in (False, 'product')):
                lines.append({
                    "product":     l.product_id.name or l.name or "",
                    "description": l.name or "",
                    "qty":         l.quantity,
                    "uom":         l.product_uom_id.name or "",
                    "price_unit":  l.price_unit,
                    "discount":    l.discount,
                    "tax":         ", ".join(l.tax_ids.mapped("name")),
                    "subtotal":    l.price_subtotal,
                })
            return {
                "id":         m.id,
                "name":       m.name,
                "partner":    m.partner_id.name or "",
                "partner_id": m.partner_id.id,
                "date":       str(m.invoice_date or ""),
                "due_date":   str(m.invoice_date_due or ""),
                "amount":     m.amount_total,
                "residual":   m.amount_residual,
                "state":      m.payment_state,
                "lines":      lines,
            }

        return {
            "invoices":     [move_row(m) for m in invoices],
            "vendor_bills": [move_row(m) for m in vendor_bills],
            "transactions": [{
                "id":       t.id,
                "name":     t.name or "Draft",
                "partner":  t.partner_id.name or "",
                "partner_id": t.partner_id.id,
                "date":     str(t.date or ""),
                "journal":  t.journal_id.name,
                "type":     t.payment_type,
                "received": t.amount if t.payment_type == 'inbound' else 0,
                "paid":     t.amount if t.payment_type == 'outbound' else 0,
                "state":    t.state,
            } for t in payments],
        }

    @api.model
    def get_journal_balance(self, from_date=False, to_date=False):
        """
        Return one row per bank/cash journal with:
          opening        – balance BEFORE from_date (the "previous balance")
          deposit        – debits  posted during the period (money IN)
          deposit_count  – number of debit  lines during the period
          withdraw       – credits posted during the period (money OUT)
          withdraw_count – number of credit lines during the period
          change         – deposit - withdraw  (the net movement, e.g. -1000)
          closing        – opening + change     (the "new balance")

        Note: for bank/cash (asset) accounts, a DEBIT increases the balance
        (money coming in / a deposit) and a CREDIT decreases it (money going
        out / a withdrawal), so balance = debit - credit.
        """
        journals = self.env['account.journal'].search(
            [('type', 'in', ['bank', 'cash'])],
            order='name asc',
        )
        result = []
        for journal in journals:
            account = journal.default_account_id
            if not account:
                continue

            # ── Opening / previous balance (all posted lines BEFORE from_date) ──
            opening = 0.0
            if from_date:
                self.env.cr.execute("""
                    SELECT COALESCE(SUM(aml.debit - aml.credit), 0.0)
                    FROM account_move_line aml
                    JOIN account_move am ON am.id = aml.move_id
                    WHERE aml.account_id = ANY(%s)
                      AND am.state = 'posted'
                      AND aml.date < %s
                """, ([account.id], from_date))
                opening = float(self.env.cr.fetchone()[0] or 0.0)

            # ── Period deposit (debit) & withdraw (credit) + counts ──────────
            date_parts = []
            params = [account.id]
            if from_date:
                date_parts.append("aml.date >= %s")
                params.append(from_date)
            if to_date:
                date_parts.append("aml.date <= %s")
                params.append(to_date)
            date_clause = ("AND " + " AND ".join(date_parts)) if date_parts else ""

            self.env.cr.execute("""
                SELECT
                    COALESCE(SUM(aml.debit),  0.0)         AS deposit,
                    COALESCE(SUM(aml.credit), 0.0)         AS withdraw,
                    COUNT(*) FILTER (WHERE aml.debit  > 0) AS deposit_count,
                    COUNT(*) FILTER (WHERE aml.credit > 0) AS withdraw_count
                FROM account_move_line aml
                JOIN account_move am ON am.id = aml.move_id
                WHERE aml.account_id = %%s
                  AND am.state = 'posted'
                  %s
            """ % date_clause, params)
            row = self.env.cr.fetchone()
            deposit        = float(row[0] or 0.0)
            withdraw       = float(row[1] or 0.0)
            deposit_count  = int(row[2] or 0)
            withdraw_count = int(row[3] or 0)
            change         = deposit - withdraw
            closing        = opening + change

            result.append({
                'journal_name':   journal.name,
                'opening':        round(opening,  2),
                'deposit':        round(deposit,  2),
                'deposit_count':  deposit_count,
                'withdraw':       round(withdraw, 2),
                'withdraw_count': withdraw_count,
                'change':         round(change,   2),
                'closing':        round(closing,  2),
            })
        return result
