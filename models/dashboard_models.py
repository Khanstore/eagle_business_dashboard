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


class DashboardLedgerSecurity(models.Model):
    _name = "dashboard.ledger.security"
    _description = "Dashboard Ledger Balance Visibility Security"
    _order = "journal_id"

    journal_id = fields.Many2one(
        "account.journal", required=True, ondelete="cascade", index=True,
        domain=[("type", "in", ["bank", "cash"])],
    )
    masked = fields.Boolean(
        string="Mask balances", default=False,
        help="Mask Previous and Current balances for users who are not approved. Change remains visible to everyone.",
    )
    approved_user_ids = fields.Many2many(
        "res.users",
        "dashboard_ledger_security_user_rel",
        "security_id", "user_id",
        string="Approved Users",
        domain=[("active", "=", True), ("share", "=", False)],
        help="Users approved to see the unmasked Previous and Current balances for this journal.",
    )

    _sql_constraints = [
        ("journal_uniq", "unique(journal_id)", "Each journal can have only one dashboard balance security rule."),
    ]

    @api.model
    def _check_dashboard_admin(self):
        if not (self.env.user.has_group("eagle_business_dashboard.group_dashboard_admin") or self.env.user.has_group("base.group_system")):
            from odoo.exceptions import AccessError
            raise AccessError("Only Dashboard Admins can configure ledger balance visibility.")

    @api.model
    def sync_journal_rules(self):
        """Ensure every bank/cash journal has a configuration row.

        This keeps the standalone Ledger Balance Security menu useful even
        before the Finance Dashboard settings modal has been opened.
        """
        self._check_dashboard_admin()
        journals = self.env["account.journal"].search(
            [("type", "in", ["bank", "cash"])], order="name asc"
        )
        existing = {r.journal_id.id for r in self.search([])}
        for journal in journals:
            if journal.id not in existing:
                self.create({"journal_id": journal.id})
        return True

    @api.model
    def get_config(self):
        self._check_dashboard_admin()
        self.sync_journal_rules()
        journals = self.env["account.journal"].search(
            [("type", "in", ["bank", "cash"])], order="name asc"
        )
        users = self.env["res.users"].search(
            [("active", "=", True), ("share", "=", False)], order="name asc"
        )
        rules = {r.journal_id.id: r for r in self.search([])}
        return {
            "journals": [
                {
                    "id": j.id,
                    "name": j.name,
                    "masked": bool(rules[j.id].masked) if j.id in rules else False,
                    "approved_user_ids": rules[j.id].approved_user_ids.ids if j.id in rules else [],
                }
                for j in journals
            ],
            "users": [{"id": u.id, "name": u.name} for u in users],
        }

    @api.model
    def set_config(self, config):
        self._check_dashboard_admin()
        config = config or []
        allowed_journal_ids = set(self.env["account.journal"].search(
            [("type", "in", ["bank", "cash"])]
        ).ids)
        allowed_user_ids = set(self.env["res.users"].search(
            [("active", "=", True), ("share", "=", False)]
        ).ids)

        seen = set()
        for item in config:
            journal_id = int(item.get("journal_id") or 0)
            if journal_id not in allowed_journal_ids or journal_id in seen:
                continue
            seen.add(journal_id)
            user_ids = [
                int(uid) for uid in (item.get("approved_user_ids") or [])
                if int(uid) in allowed_user_ids
            ]
            vals = {
                "masked": bool(item.get("masked")),
                "approved_user_ids": [(6, 0, user_ids)],
            }
            rule = self.search([("journal_id", "=", journal_id)], limit=1)
            if rule:
                rule.write(vals)
            elif vals["masked"] or user_ids:
                self.create(dict(vals, journal_id=journal_id))

        self.search([("journal_id", "not in", list(seen) or [0])]).unlink()
        return True


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
