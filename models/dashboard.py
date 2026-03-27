from odoo import models, api

class DashboardData(models.AbstractModel):
    _name = "dashboard.data"

    @api.model
    def get_dashboard(self, from_date=False, to_date=False):
        order_domain = [('state', '==', 'sale')]
        rfq_domain = [('state', 'not in', ['purchase','done'])]
        purchase_domain =  [('state', 'in', ['purchase','done'])]
        payment_domain = []

        quotation_domain = [('state', '!=', 'sale')]

        if from_date and to_date:
            quotation_domain .append(('date_order', '>=', from_date))
            quotation_domain .append(('date_order', '<=', to_date))

            rfq_domain.append(('write_date', '<=', to_date))
            rfq_domain.append(('write_date', '>=', from_date))


            purchase_domain.append(('write_date', '<=', to_date))
            purchase_domain.append(('write_date', '>=', from_date))


            order_domain = [
                ('date_order', '>=', from_date),
                ('state', '=', 'sale'),
                ('date_order', '<=', to_date)
            ]


            payment_domain = [
                ('write_date', '>=', from_date),
                ('write_date', '<=', to_date)
            ]

        quotations = self.env['sale.order'].search(quotation_domain)
        orders = self.env['sale.order'].search(order_domain)
        purchases = self.env['purchase.order'].search(purchase_domain)
        payments = self.env['account.payment'].search(payment_domain)
        rfq = self.env['purchase.order'].search(rfq_domain)

        data= {
            "quotations": [{
                "id": q.id,
                "name": q.name,
                "partner": q.partner_id.name,
                "status": q.state,
                "amount": q.amount_total
            } for q in quotations],
            "orders": [{
                "id": o.id,
                "name": o.name,
                "partner": o.partner_id.name,
                "status": o.state,
                "amount": o.amount_total
            } for o in orders],

            "purchases": [{
                "id": p.id,
                "name": p.name,
                "partner": p.partner_id.name,
                "status": p.state,
                "amount": p.amount_total
            } for p in purchases],
            "rfq": [{
                "id": r.id,
                "name": r.name,
                "partner": r.partner_id.name,
                "status": r.state,
                "amount": r.amount_total
            } for r in rfq],

            "transactions": [{
                "id": t.id,
                "name": t.name,
                "partner": t.partner_id.name,
                "ledger": t.journal_id.name,
                "amount": t.amount,
                "state": t.state
            } for t in payments]
        }
        return data