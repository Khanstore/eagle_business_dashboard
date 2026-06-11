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

        return {
            "quotations": [{
                "id": q.id,
                "name": q.name,
                "partner": q.partner_id.name or "Public User",
                "status": q.state,
                "amount": q.amount_total
            } for q in quotations],
            "orders": [{
                "id": o.id,
                "name": o.name,
                "partner": o.partner_id.name or "Public User",
                "partner_id": o.partner_id.id,
                "status": o.state,
                "invoice_status": o.invoice_status,
                "amount": o.amount_total
            } for o in orders],
            "purchases": [{
                "id": p.id,
                "name": p.name,
                "partner": p.partner_id.name or "Supplier",
                "partner_id": p.partner_id.id,
                "status": p.state,
                "billing_status": p.invoice_status,
                "amount": p.amount_total
            } for p in purchases],
            "rfq": [{
                "id": r.id,
                "name": r.name,
                "partner_id": r.partner_id.id ,
                "partner": r.partner_id.name or "Supplier",
                "status": r.state,
                "amount": r.amount_total
            } for r in rfq],
            "transactions": [{
                "id": t.id,
                "name": t.name or "Draft Payment",
                "partner_id": t.partner_id.id ,
                "partner": t.partner_id.name or "No Partner",
                "ledger": t.journal_id.name,
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
            for l in m.invoice_line_ids.filtered(lambda x: not x.display_type):
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
