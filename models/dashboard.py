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
                "status": o.state,
                "amount": o.amount_total
            } for o in orders],
            "purchases": [{
                "id": p.id,
                "name": p.name,
                "partner": p.partner_id.name or "Supplier",
                "status": p.state,
                "amount": p.amount_total
            } for p in purchases],
            "rfq": [{
                "id": r.id,
                "name": r.name,
                "partner": r.partner_id.name or "Supplier",
                "status": r.state,
                "amount": r.amount_total
            } for r in rfq],
            "transactions": [{
                "id": t.id,
                "name": t.name or "Draft Payment",
                "partner": t.partner_id.name or "No Partner",
                "ledger": t.journal_id.name,
                "received": t.amount if t.payment_type == 'inbound' else 0,
                "paid": t.amount if t.payment_type == 'outbound' else 0,
                "state": t.state
            } for t in payments]
        }