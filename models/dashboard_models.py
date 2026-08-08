from odoo import models, fields, api


class DashboardSavedFilter(models.Model):
    _name = "dashboard.saved.filter"
    _description = "Dashboard Saved Filter Preset"
    _order = "create_date desc"

    name = fields.Char(required=True)
    dashboard = fields.Selection([('business', 'Business'), ('finance', 'Finance')], required=True, default='business')
    from_date = fields.Char()
    to_date = fields.Char()
    partner_filter = fields.Char()
    active_preset = fields.Char()
    user_id = fields.Many2one('res.users', default=lambda self: self.env.user, required=True)


class DashboardApprovalConfig(models.Model):
    _name = "dashboard.approval.config"
    _description = "Approval Threshold Configuration"

    sale_threshold = fields.Float(string="Sale Order Approval Threshold", default=0.0,
        help="Sale orders above this amount require manager approval before confirmation. 0 = disabled.")
    purchase_threshold = fields.Float(string="Purchase Order Approval Threshold", default=0.0,
        help="Purchase orders above this amount require manager approval before confirmation. 0 = disabled.")

    @api.model
    def get_config(self):
        cfg = self.search([], limit=1)
        if not cfg:
            cfg = self.create({})
        return {'sale_threshold': cfg.sale_threshold, 'purchase_threshold': cfg.purchase_threshold}

    @api.model
    def set_config(self, sale_threshold, purchase_threshold):
        cfg = self.search([], limit=1)
        if not cfg:
            cfg = self.create({})
        cfg.write({'sale_threshold': sale_threshold, 'purchase_threshold': purchase_threshold})
        return True


class DashboardSnoozedProduct(models.Model):
    _name = "dashboard.snoozed.product"
    _description = "Temporarily hidden low-stock product"
    _order = "hide_until desc"

    product_id = fields.Many2one('product.product', required=True, ondelete='cascade')
    hide_until = fields.Date(required=True)
    user_id = fields.Many2one('res.users', default=lambda self: self.env.user)

    _sql_constraints = [
        ('uniq_product', 'unique(product_id)', 'This product is already snoozed. Update the existing snooze instead.'),
    ]


class DashboardSnoozedProduct(models.Model):
    _name = "dashboard.snoozed.product"
    _description = "Temporarily Hidden Low-Stock Product"

    product_id = fields.Many2one('product.product', required=True, ondelete='cascade')
    hide_until = fields.Date(required=True, string="Hidden Until")

    _sql_constraints = [
        ('product_uniq', 'unique(product_id)', 'This product is already snoozed. Update the existing entry instead.')
    ]
