import uuid
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
    _description = "Temporarily Hidden Low-Stock Product"
    _order = "hide_until desc"

    product_id = fields.Many2one('product.product', required=True, ondelete='cascade')
    hide_until = fields.Date(required=True, string="Hidden Until")
    user_id = fields.Many2one('res.users', default=lambda self: self.env.user)

    _sql_constraints = [
        ('product_uniq', 'unique(product_id)', 'This product is already snoozed. Update the existing entry instead.')
    ]


# ─── Feature batch 3: presence, comments, snapshot links ──────────────────

class DashboardPresence(models.Model):
    _name = "dashboard.presence"
    _description = "Dashboard Live Presence (who currently has it open)"
    _rec_name = "user_id"

    user_id = fields.Many2one('res.users', required=True, ondelete='cascade')
    last_seen = fields.Datetime(required=True)

    _sql_constraints = [
        ('user_uniq', 'unique(user_id)', 'User already has a presence row.')
    ]


class DashboardKpiComment(models.Model):
    _name = "dashboard.kpi.comment"
    _description = "Comment thread on a dashboard KPI card"
    _order = "create_date desc"

    kpi_key = fields.Char(required=True, index=True)
    text = fields.Char(required=True)
    user_id = fields.Many2one('res.users', default=lambda self: self.env.user, required=True)
    create_date = fields.Datetime(readonly=True)


class DashboardSnapshotLink(models.Model):
    _name = "dashboard.snapshot.link"
    _description = "Shareable read-only dashboard snapshot link"

    token = fields.Char(required=True, index=True, default=lambda self: uuid.uuid4().hex)
    created_by = fields.Many2one('res.users', default=lambda self: self.env.user)
    expires_at = fields.Datetime(required=True)
    snapshot_data = fields.Text()  # JSON blob captured at creation time

    _sql_constraints = [
        ('token_uniq', 'unique(token)', 'Token collision, try again.')
    ]
