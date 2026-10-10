import json
import math
import re
from datetime import timedelta
from odoo import models, api, fields


# ─── Default visibility per role ─────────────────────────────────────────────
_DEFAULT_VISIBILITY = {
    "admin": {
        "kpi": True, "analytics": True, "chart": True, "operations": True,
        "customers": True, "aging": True, "financial": True, "notes": True,
        "journal": True, "journal_summary": True, "transactions": True, "clv": True, "quick_search": True,
        "multi_period": True, "settings": True,
        "action_center": True, "transfer_monitor": True, "cash_flow_forecast": True, "ultimate_control": True,
        "sales_performance": True, "product_profitability": True, "inventory_risk": True, "warehouse_comparison": True, "daily_closing": True,
    },
    "manager": {
        "kpi": True, "analytics": True, "chart": True, "operations": True,
        "customers": True, "aging": True, "financial": False, "notes": True,
        "journal": True, "journal_summary": True, "transactions": True, "clv": True, "quick_search": True,
        "multi_period": True, "settings": False,
        "action_center": True, "transfer_monitor": True, "cash_flow_forecast": True, "ultimate_control": True,
        "sales_performance": True, "product_profitability": True, "inventory_risk": True, "warehouse_comparison": True, "daily_closing": True,
    },
    "user": {
        "kpi": True, "analytics": False, "chart": False, "operations": False,
        "customers": False, "aging": False, "financial": False, "notes": True,
        "journal": False, "journal_summary": True, "transactions": True, "clv": False, "quick_search": True,
        "multi_period": False, "settings": False,
        "action_center": True, "transfer_monitor": True, "cash_flow_forecast": False, "ultimate_control": True,
        "sales_performance": True, "product_profitability": False, "inventory_risk": True, "warehouse_comparison": False, "daily_closing": False,
    },
}

SECTION_LABELS = {
    "kpi": "KPI Cards",
    "analytics": "Analytics widgets (P&L, AOV, tax)",
    "chart": "Sales / Finance trend chart",
    "operations": "Operations (deliveries, stock, mismatches)",
    "customers": "Customer intelligence (new vs returning)",
    "aging": "AR / AP Aging report",
    "financial": "Financial controls (tax, unreconciled)",
    "notes": "Team notes panel",
    "journal": "Journal Balance table",
    "journal_summary": "Journal Balance Summary (Previous / Current / Change)",
    "transactions": "Transaction table",
    "clv": "Customer Lifetime Value table",
    "quick_search": "Quick search bar",
    "multi_period": "Multi-period comparison toggle",
    "settings": "Settings panel (admin only)",
    "action_center": "Stage 4 — Action Center",
    "transfer_monitor": "Stage 4 — Transfer Monitor",
    "cash_flow_forecast": "Stage 4 — 30-Day Cash Flow Forecast",
    "ultimate_control": "Stage 5 — Control & Intelligence Center",
    "sales_performance": "Stage 2 — Sales Performance",
    "product_profitability": "Stage 2 — Product Profitability",
    "inventory_risk": "Stage 2 — Inventory Risk",
    "warehouse_comparison": "Stage 3 — Store / Warehouse Comparison",
    "daily_closing": "Stage 3 — Daily Closing",
}


class DashboardData(models.AbstractModel):
    _name = "dashboard.data"
    _description = "Eagle Business Dashboard Data Provider"

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
        if user.has_group('eagle_business_dashboard.group_dashboard_admin') or user.has_group('base.group_system'):
            return 'admin'
        if user.has_group('eagle_business_dashboard.group_dashboard_manager'):
            return 'manager'
        return 'user'

    def _audit(self, action, model_name=False, record_id=False, reference=False, details=False):
        try:
            self.env['dashboard.audit.event'].log_event(action, model_name, record_id, reference, details)
        except Exception:
            # Auditing must never break the business operation being audited.
            pass

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
            'can_manage_ledger_security': bool(self.env.user.has_group('eagle_business_dashboard.group_dashboard_admin') or self.env.user.has_group('base.group_system')),
            'visibility': default,
            'section_labels': SECTION_LABELS,
            'all_defaults': _DEFAULT_VISIBILITY,
        }

    @api.model
    def save_visibility(self, config):
        if not (self.env.user.has_group('eagle_business_dashboard.group_dashboard_admin') or self.env.user.has_group('base.group_system')):
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

    @api.model
    def save_team_notes_with_mentions(self, notes):
        self.env['ir.config_parameter'].sudo().set_param('eagle_dashboard.team_notes', notes)
        mentioned = set(re.findall(r'@(\w[\w\s]{1,30}?)(?=[,.\s@]|$)', notes or ''))
        notified = []
        for name in mentioned:
            user = self.env['res.users'].search([('name', 'ilike', name.strip())], limit=1)
            if user and user.id != self.env.uid:
                try:
                    self.env['mail.activity'].sudo().create({
                        'res_model_id': self.env['ir.model']._get_id('res.users'),
                        'res_id': user.id,
                        'activity_type_id': self.env.ref('mail.mail_activity_data_todo').id,
                        'summary': f'Mentioned in Dashboard Team Notes by {self.env.user.name}',
                        'note': notes[:300],
                        'user_id': user.id,
                    })
                    notified.append(user.name)
                except Exception:
                    continue
        return {'notified': notified}

    # ─── Sales Target ─────────────────────────────────────────────────────────
    @api.model
    def save_sales_target(self, amount):
        self.env['ir.config_parameter'].sudo().set_param(
            'eagle_dashboard.sales_target', str(float(amount)))
        return True

    # ─── Company info (used by all three dashboards for branding) ─────────
    @api.model
    def get_company_info(self):
        company = self.env.company
        return {'id': company.id, 'name': company.name}

    # ─── Business Dashboard – main data ──────────────────────────────────────
    @api.model
    def get_dashboard(self, from_date=False, to_date=False):
        order_domain = [('state', '=', 'sale')]
        rfq_domain = [('state', 'not in', ['purchase', 'done'])]
        purchase_domain = [('state', 'in', ['purchase', 'done'])]
        quotation_domain = [('state', '!=', 'sale')]
        payment_domain = []

        if from_date and to_date:
            df = [('create_date', '>=', from_date), ('create_date', '<=', to_date)]
            quotation_domain += df
            rfq_domain += df
            purchase_domain += df
            order_domain = [('date_order', '>=', from_date), ('date_order', '<=', to_date), ('state', '=', 'sale')]
            payment_domain = [('date', '>=', from_date), ('date', '<=', to_date)]

        quotations = self.env['sale.order'].search(quotation_domain)
        orders = self.env['sale.order'].search(order_domain)
        purchases = self.env['purchase.order'].search(purchase_domain)
        payments = self.env['account.payment'].search(payment_domain)
        rfq = self.env['purchase.order'].search(rfq_domain)

        def sale_lines(o):
            return [{'product': l.product_id.name or l.name or '', 'qty': l.product_uom_qty,
                     'uom': l.product_uom.name or '', 'price_unit': l.price_unit,
                     'discount': getattr(l, 'discount', 0.0) or 0.0,
                     'tax': ', '.join(l.tax_id.mapped('name')) if hasattr(l, 'tax_id') else '',
                     'subtotal': l.price_subtotal}
                    for l in o.order_line.filtered(lambda x: not x.display_type)]

        def pur_lines(o):
            return [{'product': l.product_id.name or l.name or '', 'qty': l.product_qty,
                     'uom': l.product_uom.name or '', 'price_unit': l.price_unit,
                     'discount': getattr(l, 'discount', 0.0) or 0.0,
                     'tax': ', '.join(l.taxes_id.mapped('name')) if hasattr(l, 'taxes_id') else '',
                     'subtotal': l.price_subtotal}
                    for l in o.order_line.filtered(lambda x: not x.display_type)]

        f = self._fmt

        def parent_name(partner):
            cp = partner.commercial_partner_id
            return cp.name if (cp and cp.id != partner.id) else ''

        return {
            'quotations': [{'id': q.id, 'name': q.name, 'partner': q.partner_id.name or '', 'partner_id': q.partner_id.id,
                            'partner_parent': parent_name(q.partner_id),
                            'status': q.state, 'date': f(q.date_order), 'amount': q.amount_total, 'lines': sale_lines(q)} for q in quotations],
            'orders': [{'id': o.id, 'name': o.name, 'partner': o.partner_id.name or '', 'partner_id': o.partner_id.id,
                        'partner_parent': parent_name(o.partner_id),
                        'status': o.state, 'date': f(o.date_order), 'invoice_status': o.invoice_status,
                        'amount': o.amount_total, 'lines': sale_lines(o)} for o in orders],
            'purchases': [{'id': p.id, 'name': p.name, 'partner': p.partner_id.name or '', 'partner_id': p.partner_id.id,
                           'partner_parent': parent_name(p.partner_id),
                           'status': p.state, 'date': f(p.date_order), 'billing_status': p.invoice_status,
                           'amount': p.amount_total, 'lines': pur_lines(p)} for p in purchases],
            'rfq': [{'id': r.id, 'name': r.name, 'partner': r.partner_id.name or '', 'partner_id': r.partner_id.id,
                     'partner_parent': parent_name(r.partner_id),
                     'status': r.state, 'date': f(r.date_order), 'amount': r.amount_total, 'lines': pur_lines(r)} for r in rfq],
            'transactions': [{'id': t.id, 'name': t.name or 'Draft', 'partner': t.partner_id.name or '', 'partner_id': t.partner_id.id,
                              'partner_parent': parent_name(t.partner_id),
                              'ledger': t.journal_id.name, 'journal_id': t.journal_id.id, 'date': f(t.date),
                              'received': t.amount if t.payment_type == 'inbound' else 0,
                              'paid': t.amount if t.payment_type == 'outbound' else 0, 'state': t.state} for t in payments],
        }

    # ─── Business Widgets (KPI) ───────────────────────────────────────────────
    @api.model
    def get_business_widgets(self):
        today = fields.Date.today()
        fom = today.replace(day=1)
        d7 = today + timedelta(days=7)
        param = self.env['ir.config_parameter'].sudo()

        overdue = self.env['account.move'].search([('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']), ('invoice_date_due', '<', str(today))])
        due_soon = self.env['account.move'].search([('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']),
            ('invoice_date_due', '>=', str(today)), ('invoice_date_due', '<=', str(d7))])
        month_orders = self.env['sale.order'].search([('state', '=', 'sale'),
            ('date_order', '>=', str(fom)), ('date_order', '<=', str(today))])
        month_sales = sum(month_orders.mapped('amount_total'))
        sales_target = float(param.get_param('eagle_dashboard.sales_target', '0') or '0')

        self.env.cr.execute("""
            SELECT rp.name, COALESCE(SUM(am.amount_total),0) as total
            FROM account_move am JOIN res_partner rp ON rp.id=am.partner_id
            WHERE am.move_type='out_invoice' AND am.state='posted'
            GROUP BY rp.id,rp.name ORDER BY total DESC LIMIT 5""")
        top_customers = [{'name': r[0] or 'Unknown', 'total': round(float(r[1]), 2)} for r in self.env.cr.fetchall()]

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
            'overdue_count': len(overdue), 'overdue_amount': round(sum(overdue.mapped('amount_residual')), 2),
            'due_soon_count': len(due_soon), 'due_soon_amount': round(sum(due_soon.mapped('amount_residual')), 2),
            'top_customers': top_customers, 'month_sales': round(month_sales, 2),
            'sales_target': sales_target, 'low_stock': low_stock,
        }


    # ─── Stage 4 control center helpers ─────────────────────────────────────
    @api.model
    def get_action_center(self, from_date=False, to_date=False):
        """Return bounded, actionable exception counts for the current user.

        These are live open-work queues, not historical KPI calculations. The
        returned domains can be passed back to Odoo's normal list views.
        """
        today = fields.Date.context_today(self)
        def card(key, label, icon, count, amount=None, severity='info', model=None, domain=None, help_text=''):
            return {
                'key': key, 'label': label, 'icon': icon, 'count': int(count or 0),
                'amount': round(float(amount or 0.0), 2) if amount is not None else None,
                'severity': severity, 'model': model, 'domain': domain or [],
                'help': help_text,
            }

        cards = []
        try:
            dom = [('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
                   ('payment_state', 'not in', ['paid', 'in_payment']),
                   ('invoice_date_due', '<', str(today))]
            recs = self.env['account.move'].search(dom, limit=100)
            cards.append(card('overdue_invoices', 'Overdue Customer Invoices', 'fa-exclamation-circle',
                              self.env['account.move'].search_count(dom), sum(recs.mapped('amount_residual')),
                              'danger', 'account.move', dom, 'Posted customer invoices past due date.'))
        except Exception:
            cards.append(card('overdue_invoices', 'Overdue Customer Invoices', 'fa-exclamation-circle', 0, 0, 'danger'))

        try:
            dom = [('move_type', '=', 'in_invoice'), ('state', '=', 'posted'),
                   ('payment_state', 'not in', ['paid', 'in_payment']),
                   ('invoice_date_due', '<', str(today))]
            recs = self.env['account.move'].search(dom, limit=100)
            cards.append(card('overdue_bills', 'Overdue Vendor Bills', 'fa-warning',
                              self.env['account.move'].search_count(dom), sum(recs.mapped('amount_residual')),
                              'danger', 'account.move', dom, 'Posted vendor bills past due date.'))
        except Exception:
            cards.append(card('overdue_bills', 'Overdue Vendor Bills', 'fa-warning', 0, 0, 'danger'))

        try:
            dom = [('picking_type_id.code', '=', 'outgoing'), ('state', 'not in', ['done', 'cancel']),
                   ('scheduled_date', '<', str(today))]
            cards.append(card('late_deliveries', 'Late Deliveries', 'fa-truck',
                              self.env['stock.picking'].search_count(dom), severity='danger',
                              model='stock.picking', domain=dom, help_text='Outgoing transfers scheduled before today and not completed.'))
        except Exception:
            cards.append(card('late_deliveries', 'Late Deliveries', 'fa-truck', 0, severity='danger'))

        try:
            dom = [('picking_type_id.code', '=', 'incoming'), ('state', 'not in', ['done', 'cancel']),
                   ('scheduled_date', '<', str(today))]
            cards.append(card('late_receipts', 'Late Receipts', 'fa-download',
                              self.env['stock.picking'].search_count(dom), severity='warning',
                              model='stock.picking', domain=dom, help_text='Incoming transfers scheduled before today and not completed.'))
        except Exception:
            cards.append(card('late_receipts', 'Late Receipts', 'fa-download', 0, severity='warning'))

        try:
            dom = [('state', '=', 'draft')]
            cards.append(card('draft_payments', 'Draft Payments', 'fa-pencil-square-o',
                              self.env['account.payment'].search_count(dom), severity='warning',
                              model='account.payment', domain=dom, help_text='Payments not yet posted.'))
        except Exception:
            cards.append(card('draft_payments', 'Draft Payments', 'fa-pencil-square-o', 0, severity='warning'))

        try:
            dom = [('state', '=', 'in_process')]
            cards.append(card('in_process_payments', 'In-Process Payments', 'fa-hourglass-half',
                              self.env['account.payment'].search_count(dom), severity='warning',
                              model='account.payment', domain=dom, help_text='Posted payments awaiting bank matching/reconciliation.'))
        except Exception:
            cards.append(card('in_process_payments', 'In-Process Payments', 'fa-hourglass-half', 0, severity='warning'))

        try:
            dom = [('is_reconciled', '=', False), ('journal_id.type', 'in', ['bank', 'cash'])]
            count = self.env['account.bank.statement.line'].search_count(dom)
            cards.append(card('unreconciled_bank', 'Unreconciled Bank Lines', 'fa-university', count, severity='warning',
                              model='account.bank.statement.line', domain=dom, help_text='Bank/cash statement lines not yet reconciled.'))
        except Exception:
            # Some configurations may not expose statement lines; preserve the card.
            cards.append(card('unreconciled_bank', 'Unreconciled Bank Lines', 'fa-university', 0, severity='warning'))

        try:
            dom = [('state', '=', 'draft')]
            cards.append(card('quotations', 'Open Quotations', 'fa-file-text-o',
                              self.env['sale.order'].search_count(dom), severity='info',
                              model='sale.order', domain=dom, help_text='Sales quotations not yet confirmed.'))
        except Exception:
            cards.append(card('quotations', 'Open Quotations', 'fa-file-text-o', 0, severity='info'))

        try:
            dom = [('state', '=', 'draft')]
            cards.append(card('rfq', 'Open RFQs', 'fa-shopping-cart',
                              self.env['purchase.order'].search_count(dom), severity='info',
                              model='purchase.order', domain=dom, help_text='Requests for quotation not yet confirmed.'))
        except Exception:
            cards.append(card('rfq', 'Open RFQs', 'fa-shopping-cart', 0, severity='info'))

        try:
            dom = [('active', '=', True), ('type', 'in', ['product', 'consu']), ('qty_available', '<=', 5)]
            cards.append(card('low_stock', 'Low / Out-of-Stock Products', 'fa-cubes',
                              self.env['product.product'].search_count(dom), severity='warning',
                              model='product.product', domain=dom, help_text='Active storable/consumable products at or below the low-stock threshold of 5 units.'))
        except Exception:
            cards.append(card('low_stock', 'Low / Out-of-Stock Products', 'fa-cubes', 0, severity='warning'))

        total_open = sum(c['count'] for c in cards)
        critical = sum(c['count'] for c in cards if c['severity'] == 'danger')
        return {'cards': cards, 'total_open': total_open, 'critical': critical, 'as_of': str(today)}

    @api.model
    def get_transfer_monitor(self, from_date=False, to_date=False):
        """Show internal-transfer payment pairs as one source→destination row.

        Odoo 18 records an internal transfer across the corresponding bank/cash
        journals. The dashboard consolidates the payment pair so managers can
        verify the same movement without double-counting it.
        """
        result = {'available': True, 'rows': [], 'total_amount': 0.0, 'needs_review': 0}
        try:
            pay = self.env['account.payment']
            flds = pay._fields
            pair_field = 'paired_internal_transfer_payment_id' if 'paired_internal_transfer_payment_id' in flds else None
            internal_flag = 'is_internal_transfer' if 'is_internal_transfer' in flds else None
            if not pair_field and not internal_flag:
                result['available'] = False
                result['message'] = 'This Odoo 18 build does not expose the internal-transfer payment linkage field.'
                return result

            # Odoo 18 links the two sides of an internal transfer through
            # paired_internal_transfer_payment_id. If an optional boolean
            # internal-transfer flag is present, accept either signal.
            if pair_field and internal_flag:
                domain = ['|', (internal_flag, '=', True), (pair_field, '!=', False)]
            elif pair_field:
                domain = [(pair_field, '!=', False)]
            else:
                domain = [(internal_flag, '=', True)]
            if 'payment_type' in flds:
                domain.append(('payment_type', '=', 'outbound'))
            if from_date and to_date:
                domain += [('date', '>=', from_date), ('date', '<=', to_date)]
            payments = pay.search(domain, order='date desc, id desc', limit=100)
            pair_field = 'paired_internal_transfer_payment_id' if 'paired_internal_transfer_payment_id' in flds else None
            destination_field = 'destination_journal_id' if 'destination_journal_id' in flds else None
            matched_field = 'is_matched' if 'is_matched' in flds else None

            for pmt in payments:
                pair = getattr(pmt, pair_field) if pair_field else self.env['account.payment']
                destination = getattr(pmt, destination_field) if destination_field else self.env['account.journal']
                if not destination and pair:
                    destination = pair.journal_id
                if not destination:
                    destination_name = 'Unknown / not linked'
                else:
                    destination_name = destination.name

                pair_exists = bool(pair and pair.exists())
                amount_ok = bool(pair_exists and abs(float(pair.amount or 0.0) - float(pmt.amount or 0.0)) < 0.01)
                matched = bool(getattr(pmt, matched_field)) if matched_field else False
                status = 'Paired' if pair_exists and amount_ok else 'Needs Review'
                if pmt.state == 'draft':
                    status = 'Draft'
                elif pmt.state == 'in_process' and status == 'Paired':
                    status = 'In Process'

                result['rows'].append({
                    'id': pmt.id,
                    'name': pmt.name or f'Payment {pmt.id}',
                    'date': self._fmt(pmt.date),
                    'from_journal': pmt.journal_id.name or '',
                    'to_journal': destination_name,
                    'amount': round(float(pmt.amount or 0.0), 2),
                    'state': pmt.state,
                    'status': status,
                    'paired_id': pair.id if pair_exists else 0,
                    'matched': matched,
                })
                result['total_amount'] += float(pmt.amount or 0.0)
                if status == 'Needs Review':
                    result['needs_review'] += 1
            result['total_amount'] = round(result['total_amount'], 2)
            return result
        except Exception as exc:
            result['available'] = False
            result['message'] = f'Unable to read internal transfers: {exc}'
            return result

    @api.model
    def get_cash_forecast_secure(self, days=30):
        """Return a due-date cash forecast while respecting ledger masking."""
        today = fields.Date.context_today(self)
        days = min(max(int(days or 30), 7), 60)
        journals = self.env['account.journal'].search([('type', 'in', ['bank', 'cash'])], order='name asc')
        security = self._ledger_security_rules_for_journals(journals)
        visible_all = not any(info.get('masked') for info in security.values())

        account_ids = journals.mapped('default_account_id').ids or [-1]
        try:
            self.env.cr.execute("""
                SELECT COALESCE(SUM(aml.debit - aml.credit), 0.0)
                FROM account_move_line aml
                JOIN account_move am ON am.id = aml.move_id
                WHERE aml.account_id = ANY(%s) AND am.state='posted' AND am.date <= %s
            """, (account_ids, str(today)))
            current_balance = float(self.env.cr.fetchone()[0] or 0.0)
        except Exception:
            current_balance = 0.0

        end_day = today + timedelta(days=days)
        daily = {}
        try:
            due_moves = self.env['account.move'].search([
                ('state', '=', 'posted'),
                ('payment_state', 'not in', ['paid', 'in_payment']),
                ('invoice_date_due', '>=', str(today)),
                ('invoice_date_due', '<=', str(end_day)),
                ('move_type', 'in', ['out_invoice', 'out_refund', 'in_invoice', 'in_refund']),
            ])
            for move in due_moves:
                due = move.invoice_date_due or move.invoice_date
                ds = str(due)
                daily.setdefault(ds, {'in': 0.0, 'out': 0.0})
                amt = float(move.amount_residual or 0.0)
                if move.move_type in ('out_invoice', 'in_refund'):
                    daily[ds]['in'] += amt
                else:
                    daily[ds]['out'] += amt
        except Exception:
            pass

        forecast = []
        running = current_balance
        min_balance = current_balance
        min_date = str(today)
        for i in range(days + 1):
            d = today + timedelta(days=i)
            ds = str(d)
            flows = daily.get(ds, {'in': 0.0, 'out': 0.0})
            running += flows['in'] - flows['out']
            if running < min_balance:
                min_balance = running
                min_date = ds
            forecast.append({
                'date': ds,
                'in': round(flows['in'], 2),
                'out': round(flows['out'], 2),
                'net': round(flows['in'] - flows['out'], 2),
                'balance': None if not visible_all else round(running, 2),
            })

        total_in = round(sum(x['in'] for x in forecast), 2)
        total_out = round(sum(x['out'] for x in forecast), 2)
        return {
            'days': days,
            'from_date': str(today),
            'to_date': str(end_day),
            'balance_masked': not visible_all,
            'current_balance': None if not visible_all else round(current_balance, 2),
            'expected_in': total_in,
            'expected_out': total_out,
            'expected_net': round(total_in - total_out, 2),
            'minimum_balance': None if not visible_all else round(min_balance, 2),
            'minimum_balance_date': min_date if visible_all else '',
            'forecast': forecast,
        }

    @api.model
    def get_ultimate_controls(self, from_date=False, to_date=False):
        """Production-oriented management control data for Stage 5.

        The method is deliberately bounded and server-side. Regular users get
        operational counts and non-sensitive summaries; managers/admins receive
        financial detail. All monetary detail is omitted from the regular-user
        payload rather than merely masked in the browser.
        """
        role = self._get_user_role()
        can_manage = role in ('admin', 'manager')
        today = fields.Date.context_today(self)

        if from_date and to_date:
            fd = fields.Date.from_string(from_date)
            td = fields.Date.from_string(to_date)
        else:
            fd = today.replace(day=1)
            td = today
        next_day = td + timedelta(days=1)

        result = {
            'can_manage': can_manage,
            'period': {'from_date': str(fd), 'to_date': str(td)},
            'today_change': {'sales_today': 0.0, 'sales_yesterday': 0.0, 'sales_change_pct': None,
                             'received_today': 0.0, 'received_yesterday': 0.0,
                             'paid_today': 0.0, 'paid_yesterday': 0.0},
            'salespeople': [],
            'margin_watch': [],
            'returns': {'count': 0, 'amount': 0.0, 'rate_pct': None, 'top_products': []},
            'customer_risk': [],
            'reconciliation': {'unreconciled_count': 0, 'unreconciled_amount': 0.0,
                               'in_process_count': 0, 'in_process_amount': 0.0},
            'data_quality': {'missing_product_barcode': 0, 'missing_product_category': 0,
                             'non_positive_sale_price': 0, 'negative_stock_quants': 0,
                             'customer_missing_email': 0},
            'approval_queue': {'sales': [], 'purchases': [], 'sale_threshold': 0.0, 'purchase_threshold': 0.0},
        }

        try:
            # -------- What changed today --------
            self.env.cr.execute("""
                SELECT COALESCE(SUM(CASE WHEN DATE(date_order)=%s THEN amount_total ELSE 0 END),0),
                       COALESCE(SUM(CASE WHEN DATE(date_order)=%s THEN amount_total ELSE 0 END),0)
                FROM sale_order
                WHERE state IN ('sale','done') AND DATE(date_order) IN (%s,%s)
            """, (str(today), str(today - timedelta(days=1)), str(today), str(today - timedelta(days=1))))
            r=self.env.cr.fetchone()
            result['today_change']['sales_today']=round(float(r[0] or 0),2)
            result['today_change']['sales_yesterday']=round(float(r[1] or 0),2)
            if result['today_change']['sales_yesterday']:
                result['today_change']['sales_change_pct']=round((result['today_change']['sales_today']-result['today_change']['sales_yesterday'])/result['today_change']['sales_yesterday']*100,1)

            self.env.cr.execute("""
                SELECT
                  COALESCE(SUM(CASE WHEN date=%s AND payment_type='inbound' AND state IN ('in_process','paid') THEN amount ELSE 0 END),0),
                  COALESCE(SUM(CASE WHEN date=%s AND payment_type='inbound' AND state IN ('in_process','paid') THEN amount ELSE 0 END),0),
                  COALESCE(SUM(CASE WHEN date=%s AND payment_type='outbound' AND state IN ('in_process','paid') THEN amount ELSE 0 END),0),
                  COALESCE(SUM(CASE WHEN date=%s AND payment_type='outbound' AND state IN ('in_process','paid') THEN amount ELSE 0 END),0)
                FROM account_payment WHERE date IN (%s,%s)
            """, (str(today),str(today-timedelta(days=1)),str(today),str(today-timedelta(days=1)),str(today),str(today-timedelta(days=1))))
            r=self.env.cr.fetchone()
            result['today_change']['received_today']=round(float(r[0] or 0),2)
            result['today_change']['received_yesterday']=round(float(r[1] or 0),2)
            result['today_change']['paid_today']=round(float(r[2] or 0),2)
            result['today_change']['paid_yesterday']=round(float(r[3] or 0),2)
        except Exception:
            pass

        # -------- Salesperson performance --------
        if can_manage:
            try:
                dom=[('state','in',['sale','done']),('date_order','>=',str(fd)),('date_order','<',str(next_day))]
                groups=self.env['sale.order'].read_group(dom,['amount_total:sum'],['user_id'])
                for g in groups:
                    uid=g.get('user_id')
                    name=uid[1] if isinstance(uid,(list,tuple)) else 'Unassigned'
                    result['salespeople'].append({
                        'id': uid[0] if isinstance(uid,(list,tuple)) else 0,
                        'name': name,
                        'orders': int(g.get('__count',0) or 0),
                        'sales': round(float(g.get('amount_total',0) or 0),2),
                    })
                result['salespeople'].sort(key=lambda x:(x['sales'],x['orders']), reverse=True)
                result['salespeople']=result['salespeople'][:10]
            except Exception:
                pass

            # -------- Margin watch (current standard-cost estimate) --------
            try:
                where=["so.state IN ('sale','done')","sol.display_type IS NULL","sol.product_id IS NOT NULL", "so.date_order >= %s", "so.date_order < %s"]
                self.env.cr.execute(f"""
                    SELECT sol.order_id, so.name, so.partner_id, rp.name, sol.product_id,
                           sol.product_uom_qty, sol.price_subtotal, COALESCE(pt.standard_price,0)
                    FROM sale_order_line sol
                    JOIN sale_order so ON so.id=sol.order_id
                    LEFT JOIN res_partner rp ON rp.id=so.partner_id
                    JOIN product_product pp ON pp.id=sol.product_id
                    JOIN product_template pt ON pt.id=pp.product_tmpl_id
                    WHERE {' AND '.join(where)}
                    ORDER BY (sol.price_subtotal - sol.product_uom_qty*COALESCE(pt.standard_price,0)) ASC, sol.id ASC
                    LIMIT 20
                """, (str(fd),str(next_day)))
                rows=self.env.cr.fetchall()
                pids=[int(r[4]) for r in rows]
                products=self.env['product.product'].browse(pids).exists()
                names={p.id:p.display_name for p in products}
                for order_id,order_name,partner_id,partner_name,pid,qty,sales,cost_unit in rows:
                    qty=float(qty or 0); sales=float(sales or 0); cost=qty*float(cost_unit or 0); gross=sales-cost
                    result['margin_watch'].append({
                        'order_id':order_id,'order':order_name or '', 'partner_id':partner_id or 0,
                        'partner':partner_name or 'Unknown','product_id':int(pid),'product':names.get(int(pid),'Unknown product'),
                        'sales':round(sales,2),'estimated_cost':round(cost,2),'gross_profit':round(gross,2),
                        'margin_pct':round(gross/sales*100,1) if sales else None,
                    })
            except Exception:
                pass

            # -------- Returns / refunds --------
            try:
                ref_dom=[('move_type','=','out_refund'),('state','=','posted'),('invoice_date','>=',str(fd)),('invoice_date','<',str(next_day))]
                refg=self.env['account.move'].read_group(ref_dom,['amount_total:sum'],[])
                result['returns']['count']=self.env['account.move'].search_count(ref_dom)
                result['returns']['amount']=round(sum(float(g.get('amount_total',0) or 0) for g in refg),2)
                sold_dom=[('move_type','=','out_invoice'),('state','=','posted'),('invoice_date','>=',str(fd)),('invoice_date','<',str(next_day))]
                sold_g=self.env['account.move'].read_group(sold_dom,['amount_total:sum'],[])
                sold_amount=sum(float(g.get('amount_total',0) or 0) for g in sold_g)
                result['returns']['rate_pct']=round(result['returns']['amount']/sold_amount*100,1) if sold_amount else None
                self.env.cr.execute("""
                    SELECT aml.product_id, COALESCE(SUM(ABS(aml.quantity)),0) qty, COALESCE(SUM(ABS(aml.price_subtotal)),0) amount
                    FROM account_move_line aml JOIN account_move am ON am.id=aml.move_id
                    WHERE am.move_type='out_refund' AND am.state='posted' AND am.invoice_date >= %s AND am.invoice_date < %s
                      AND aml.display_type='product' AND aml.product_id IS NOT NULL
                    GROUP BY aml.product_id ORDER BY amount DESC LIMIT 10
                """, (str(fd),str(next_day)))
                rrows=self.env.cr.fetchall(); pids=[int(r[0]) for r in rrows]
                names={p.id:p.display_name for p in self.env['product.product'].browse(pids).exists()}
                result['returns']['top_products']=[{'product_id':int(pid),'product':names.get(int(pid),'Unknown product'),'qty':round(float(qty or 0),2),'amount':round(float(amount or 0),2)} for pid,qty,amount in rrows]
            except Exception:
                pass

            # -------- Customer risk --------
            try:
                self.env.cr.execute("""
                    SELECT rp.id,rp.name,COALESCE(SUM(am.amount_residual),0) overdue,MAX(am.invoice_date) last_invoice
                    FROM account_move am JOIN res_partner rp ON rp.id=am.partner_id
                    WHERE am.move_type='out_invoice' AND am.state='posted'
                      AND am.amount_residual > 0 AND am.invoice_date_due < CURRENT_DATE
                    GROUP BY rp.id,rp.name ORDER BY overdue DESC LIMIT 15
                """)
                for rid,name,overdue,last_invoice in self.env.cr.fetchall():
                    result['customer_risk'].append({'id':rid,'name':name or 'Unknown','overdue':round(float(overdue or 0),2),'last_invoice':str(last_invoice) if last_invoice else ''})
            except Exception:
                pass

            # -------- Reconciliation --------
            try:
                bl=self.env['account.bank.statement.line']
                if 'is_reconciled' in bl._fields:
                    recs=bl.search([('is_reconciled','=',False),('journal_id.type','in',['bank','cash'])], limit=500)
                    result['reconciliation']['unreconciled_count']=bl.search_count([('is_reconciled','=',False),('journal_id.type','in',['bank','cash'])])
                    result['reconciliation']['unreconciled_amount']=round(sum(float(getattr(x,'amount',0) or 0) for x in recs),2)
                p=self.env['account.payment']
                ip=p.search([('state','=','in_process')], limit=500)
                result['reconciliation']['in_process_count']=p.search_count([('state','=','in_process')])
                result['reconciliation']['in_process_amount']=round(sum(float(x.amount or 0) for x in ip),2)
            except Exception:
                pass

            # -------- Data quality --------
            try:
                product_model=self.env['product.product']
                result['data_quality']['missing_product_barcode']=product_model.search_count([('active','=',True),('type','in',['product','consu']),('barcode','=',False)])
                result['data_quality']['missing_product_category']=product_model.search_count([('active','=',True),('type','in',['product','consu']),('categ_id','=',False)])
                result['data_quality']['non_positive_sale_price']=product_model.search_count([('active','=',True),('type','in',['product','consu']),('list_price','<=',0)])
                result['data_quality']['negative_stock_quants']=self.env['stock.quant'].search_count([('quantity','<',0),('location_id.usage','=','internal')])
                result['data_quality']['customer_missing_email']=self.env['res.partner'].search_count([('customer_rank','>',0),('active','=',True),('email','=',False)])
            except Exception:
                pass

            try:
                result['approval_queue']=self.get_approval_queue()
            except Exception:
                pass
        else:
            # Keep only low-sensitivity counts for basic dashboard users.
            try:
                result['salespeople']=[{'id':0,'name':'Restricted','orders':sum(x.get('orders',0) for x in result['salespeople']),'sales':None}]
            except Exception:
                result['salespeople']=[]
        return result

    @api.model
    def get_executive_cockpit(self, from_date=False, to_date=False, action_center=None, ultimate=None):
        """Compact executive snapshot for the top of the Business Dashboard.

        This is intentionally bounded and safe for the browser. Financial detail
        is returned only to dashboard managers/admins; basic users receive counts
        and status indicators. The method also exposes the dashboard's own audit
        events, exception signals and data-quality totals in one RPC.
        """
        today = fields.Date.context_today(self)
        yesterday = today - timedelta(days=1)
        role = self._get_user_role()
        can_manage = role in ('admin', 'manager')

        result = {
            'role': role,
            'company': self.env.company.name,
            'generated_at': fields.Datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
            'what_changed': {
                'sales_today': 0.0 if can_manage else None,
                'sales_yesterday': 0.0 if can_manage else None,
                'sales_change_pct': None,
                'orders_today': 0,
                'orders_yesterday': 0,
                'received_today': 0.0 if can_manage else None,
                'received_yesterday': 0.0 if can_manage else None,
                'paid_today': 0.0 if can_manage else None,
                'paid_yesterday': 0.0 if can_manage else None,
            },
            'exceptions': {'open': 0, 'critical': 0},
            'data_quality': {'total_flags': 0, 'checks': []},
            'anomalies': [],
            'audit': [],
            'reorder': [],
        }

        # What changed today: ORM domains keep normal company/record rules in force.
        try:
            for day, key in ((today, 'today'), (yesterday, 'yesterday')):
                sale_dom = [('state', 'in', ['sale','done']), ('date_order', '>=', str(day)), ('date_order', '<', str(day + timedelta(days=1)))]
                result['what_changed'][f'orders_{key}'] = self.env['sale.order'].search_count(sale_dom)
                if can_manage:
                    sale_groups = self.env['sale.order'].read_group(sale_dom, ['amount_total:sum'], [])
                    result['what_changed'][f'sales_{key}'] = round(sum(float(g.get('amount_total', 0.0) or 0.0) for g in sale_groups), 2)
                pay_in_dom=[('date','=',str(day)),('payment_type','=','inbound'),('state','in',['in_process','paid'])]
                pay_out_dom=[('date','=',str(day)),('payment_type','=','outbound'),('state','in',['in_process','paid'])]
                if can_manage:
                    in_groups=self.env['account.payment'].read_group(pay_in_dom,['amount:sum'],[])
                    out_groups=self.env['account.payment'].read_group(pay_out_dom,['amount:sum'],[])
                    result['what_changed'][f'received_{key}']=round(sum(float(g.get('amount',0.0) or 0.0) for g in in_groups),2)
                    result['what_changed'][f'paid_{key}']=round(sum(float(g.get('amount',0.0) or 0.0) for g in out_groups),2)
            if can_manage and result['what_changed']['sales_yesterday']:
                result['what_changed']['sales_change_pct'] = round((result['what_changed']['sales_today'] - result['what_changed']['sales_yesterday']) / result['what_changed']['sales_yesterday'] * 100, 1)
        except Exception:
            pass

        try:
            ac = action_center if action_center is not None else self.get_action_center(from_date, to_date)
            result['exceptions'] = {'open': int(ac.get('total_open', 0) or 0), 'critical': int(ac.get('critical', 0) or 0)}
        except Exception:
            pass

        # Data-quality totals from the same server-side source used by Stage 5.
        try:
            u = ultimate if ultimate is not None else self.get_ultimate_controls(from_date, to_date)
            dq = u.get('data_quality') or {}
            checks = [
                ('Missing product barcode', 'missing_product_barcode'),
                ('Missing product category', 'missing_product_category'),
                ('Non-positive sale price', 'non_positive_sale_price'),
                ('Negative stock', 'negative_stock_quants'),
                ('Customers without email', 'customer_missing_email'),
            ]
            result['data_quality']['checks'] = [{'label': label, 'count': int(dq.get(key, 0) or 0)} for label, key in checks]
            result['data_quality']['total_flags'] = sum(x['count'] for x in result['data_quality']['checks'])
        except Exception:
            pass

        # Bounded management-only signals.
        if can_manage:
            try:
                result['anomalies'] = self.get_anomalies()[:10]
            except Exception:
                pass
            try:
                result['reorder'] = self.get_reorder_predictions()[:10]
            except Exception:
                pass
            try:
                logs = self.env['dashboard.audit.event'].search([('company_id','=',self.env.company.id)], limit=15)
                result['audit'] = [{
                    'id': x.id, 'user': x.user_id.name or 'Unknown', 'action': x.action,
                    'model': x.model_name or '', 'reference': x.reference or '',
                    'date': x.create_date.strftime('%d/%m %H:%M') if x.create_date else '',
                    'details': x.details or '', 'record_id': x.record_id or 0,
                } for x in logs]
            except Exception:
                pass
        return result

    @api.model
    def get_control_center(self, from_date=False, to_date=False):
        """Combined Stage 4 RPC to keep Business/Finance startup efficient."""
        try:
            action_center = self.get_action_center(from_date, to_date)
        except Exception:
            action_center = {'cards': [], 'total_open': 0, 'critical': 0, 'as_of': str(fields.Date.context_today(self))}
        try:
            transfer_monitor = self.get_transfer_monitor(from_date, to_date)
        except Exception:
            transfer_monitor = {'available': False, 'rows': [], 'total_amount': 0.0, 'needs_review': 0}
        try:
            cash_forecast = self.get_cash_forecast_secure(30)
        except Exception:
            cash_forecast = {'balance_masked': True, 'current_balance': None, 'expected_in': 0.0, 'expected_out': 0.0, 'expected_net': 0.0, 'forecast': []}
        try:
            ultimate = self.get_ultimate_controls(from_date, to_date)
        except Exception:
            ultimate = {'can_manage': False, 'period': {'from_date': str(fields.Date.context_today(self)), 'to_date': str(fields.Date.context_today(self))}, 'today_change': {}, 'salespeople': [], 'margin_watch': [], 'returns': {'count':0,'amount':0.0,'rate_pct':None,'top_products':[]}, 'customer_risk': [], 'reconciliation': {'unreconciled_count':0,'unreconciled_amount':0.0,'in_process_count':0,'in_process_amount':0.0}, 'data_quality': {'missing_product_barcode':0,'missing_product_category':0,'non_positive_sale_price':0,'negative_stock_quants':0,'customer_missing_email':0}, 'approval_queue': {'sales':[],'purchases':[],'sale_threshold':0,'purchase_threshold':0}}
        try:
            executive = self.get_executive_cockpit(from_date, to_date, action_center=action_center, ultimate=ultimate)
        except Exception:
            executive = {'role': self._get_user_role(), 'company': self.env.company.name, 'generated_at': fields.Datetime.now().strftime('%d/%m/%Y %H:%M:%S'), 'what_changed': {}, 'exceptions': {'open': 0, 'critical': 0}, 'data_quality': {'total_flags': 0, 'checks': []}, 'anomalies': [], 'audit': [], 'reorder': []}
        return {'action_center': action_center, 'transfer_monitor': transfer_monitor, 'cash_flow_forecast': cash_forecast, 'ultimate': ultimate, 'executive': executive}

    # ─── Low stock snooze ────────────────────────────────────────────────────
    @api.model
    def snooze_low_stock_product(self, product_id, weeks):
        today = fields.Date.today()
        until = today + timedelta(weeks=int(weeks))
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

    # ─── Stage 2 + 3 Management Insights ─────────────────────────────────────
    @api.model
    def get_management_insights(self, from_date=False, to_date=False, daily_date=False):
        """Management analytics for the Business Dashboard.

        Stage 2:
          * Sales performance with period comparisons and estimated margin.
          * Product profitability using posted customer invoices and current
            product standard cost (explicitly an estimate, not stock valuation).
          * Inventory risk based on current on-hand quantity and recent sales velocity.

        Stage 3:
          * Store/warehouse comparison for the selected period.
          * Daily closing snapshot for a selected calendar date.

        Financially sensitive Stage 2/3 detail is restricted to Dashboard
        Admins and Managers. The server does not send those details to regular
        dashboard users even if a client-side template were modified.
        """
        today = fields.Date.today()
        role = self._get_user_role()
        can_manage = role in ('admin', 'manager')

        def date_bounds(fd, td):
            if not (fd and td):
                return None, None
            fd_d = fields.Date.from_string(fd)
            td_d = fields.Date.from_string(td)
            return fd_d, td_d

        def safe_year_back(d):
            try:
                return d.replace(year=d.year - 1)
            except ValueError:
                return d.replace(year=d.year - 1, month=2, day=28)

        fd_d, td_d = date_bounds(from_date, to_date)

        # ---------------- Sales performance ----------------
        sales_domain = [('state', 'in', ['sale', 'done'])]
        if from_date and to_date:
            next_day = td_d + timedelta(days=1)
            sales_domain += [
                ('date_order', '>=', str(fd_d)),
                ('date_order', '<', str(next_day)),
            ]
        sales_groups = self.env['sale.order'].read_group(sales_domain, ['amount_total:sum'], [])
        sales_total = round(sum(float(g.get('amount_total', 0.0) or 0.0) for g in sales_groups), 2)
        order_count = self.env['sale.order'].search_count(sales_domain)
        aov = round(sales_total / order_count, 2) if order_count else 0.0

        previous_sales = 0.0
        last_year_sales = 0.0
        previous_orders = 0
        last_year_orders = 0
        comparison_available = bool(from_date and to_date)
        if comparison_available:
            span = (td_d - fd_d).days + 1
            prev_to = fd_d - timedelta(days=1)
            prev_from = prev_to - timedelta(days=span - 1)
            ly_from = safe_year_back(fd_d)
            ly_to = safe_year_back(td_d)

            prev_domain = [('state', 'in', ['sale', 'done']), ('date_order', '>=', str(prev_from)), ('date_order', '<', str(prev_to + timedelta(days=1)))]
            prev_groups = self.env['sale.order'].read_group(prev_domain, ['amount_total:sum'], [])
            previous_sales = round(sum(float(g.get('amount_total', 0.0) or 0.0) for g in prev_groups), 2)
            previous_orders = self.env['sale.order'].search_count(prev_domain)

            ly_domain = [('state', 'in', ['sale', 'done']), ('date_order', '>=', str(ly_from)), ('date_order', '<', str(ly_to + timedelta(days=1)))]
            ly_groups = self.env['sale.order'].read_group(ly_domain, ['amount_total:sum'], [])
            last_year_sales = round(sum(float(g.get('amount_total', 0.0) or 0.0) for g in ly_groups), 2)
            last_year_orders = self.env['sale.order'].search_count(ly_domain)

        prev_change_pct = round((sales_total - previous_sales) / previous_sales * 100, 1) if previous_sales else None
        ly_change_pct = round((sales_total - last_year_sales) / last_year_sales * 100, 1) if last_year_sales else None

        estimated_revenue = 0.0
        estimated_cost = 0.0
        product_profitability = []

        # Use posted customer invoices for profitability because they carry the
        # real invoiced subtotal. Cost uses the CURRENT standard cost and is
        # therefore explicitly labelled as estimated.
        inv_line_where = ["am.move_type IN ('out_invoice','out_refund')", "am.state='posted'", "aml.display_type='product'", "aml.product_id IS NOT NULL"]
        params = []
        if from_date and to_date:
            inv_line_where += ["am.invoice_date >= %s", "am.invoice_date <= %s"]
            params += [from_date, to_date]
        where_sql = ' AND '.join(inv_line_where)
        self.env.cr.execute(f"""
            SELECT aml.product_id,
                   COALESCE(SUM(CASE WHEN am.move_type='out_refund' THEN -aml.quantity ELSE aml.quantity END),0),
                   COALESCE(SUM(CASE WHEN am.move_type='out_refund' THEN -aml.price_subtotal ELSE aml.price_subtotal END),0)
            FROM account_move_line aml
            JOIN account_move am ON am.id=aml.move_id
            WHERE {where_sql}
            GROUP BY aml.product_id
        """, params)
        product_rows = self.env.cr.fetchall()
        product_ids = [int(r[0]) for r in product_rows]
        products = self.env['product.product'].browse(product_ids).exists()
        product_map = {p.id: p for p in products}
        for pid, qty, revenue in product_rows:
            pdt = product_map.get(int(pid))
            if not pdt:
                continue
            qty = float(qty or 0.0)
            revenue = float(revenue or 0.0)
            cost = qty * float(pdt.standard_price or 0.0)
            gross = revenue - cost
            margin = (gross / revenue * 100.0) if revenue else 0.0
            estimated_revenue += revenue
            estimated_cost += cost
            product_profitability.append({
                'product_id': pdt.id,
                'product': pdt.display_name,
                'qty_sold': round(qty, 2),
                'sales': round(revenue, 2),
                'estimated_cost': round(cost, 2),
                'gross_profit': round(gross, 2),
                'margin_pct': round(margin, 1),
            })
        product_profitability.sort(key=lambda r: (r['gross_profit'], r['sales']), reverse=True)
        product_profitability = product_profitability[:20] if can_manage else []

        estimated_gross_profit = round(estimated_revenue - estimated_cost, 2) if can_manage else None
        estimated_margin_pct = round(estimated_gross_profit / estimated_revenue * 100.0, 1) if can_manage and estimated_revenue else None

        # ---------------- Inventory risk ----------------
        # Fixed recent-velocity window; it is independent from the dashboard
        # finance filter so "days cover" stays comparable.
        inv_start_30 = today - timedelta(days=29)
        inv_start_90 = today - timedelta(days=89)
        self.env.cr.execute("""
            SELECT aml.product_id,
                   COALESCE(SUM(CASE WHEN am.invoice_date >= %s THEN GREATEST(aml.quantity,0) ELSE 0 END),0),
                   COALESCE(SUM(CASE WHEN am.invoice_date >= %s THEN GREATEST(aml.quantity,0) ELSE 0 END),0)
            FROM account_move_line aml
            JOIN account_move am ON am.id=aml.move_id
            WHERE am.move_type='out_invoice' AND am.state='posted'
              AND aml.display_type='product' AND aml.product_id IS NOT NULL
              AND am.invoice_date >= %s
            GROUP BY aml.product_id
            ORDER BY SUM(GREATEST(aml.quantity,0)) DESC
            LIMIT 300
        """, (str(inv_start_30), str(inv_start_90), str(inv_start_90)))
        velocity_rows = self.env.cr.fetchall()
        velocity = {int(r[0]): (float(r[1] or 0.0), float(r[2] or 0.0)) for r in velocity_rows}

        low_stock_products = self.env['product.product'].search([
            ('active', '=', True), ('type', 'in', ['product', 'consu']), ('qty_available', '<=', 5)
        ], limit=200)
        candidate_ids = set(velocity.keys()) | set(low_stock_products.ids)
        candidates = self.env['product.product'].browse(list(candidate_ids)).exists()
        inventory_risk = []
        for pdt in candidates:
            qty_on_hand = float(pdt.qty_available or 0.0)
            sold_30, sold_90 = velocity.get(pdt.id, (0.0, 0.0))
            days_cover = None
            if sold_30 > 0:
                days_cover = qty_on_hand / (sold_30 / 30.0)
            if qty_on_hand <= 0:
                status = 'out_of_stock'
                priority = 0
            elif sold_30 > 0 and days_cover < 7:
                status = 'critical'
                priority = 1
            elif sold_30 > 0 and days_cover < 14:
                status = 'low'
                priority = 2
            elif sold_90 <= 0:
                status = 'dead_stock_90d'
                priority = 3
            elif sold_30 <= 0:
                status = 'no_sales_30d'
                priority = 4
            else:
                status = 'healthy'
                priority = 5
            inventory_risk.append({
                'product_id': pdt.id,
                'product': pdt.display_name,
                'qty_on_hand': round(qty_on_hand, 2),
                'sold_30d': round(sold_30, 2),
                'sold_90d': round(sold_90, 2),
                'days_cover': round(days_cover, 1) if days_cover is not None else None,
                'status': status,
                '_priority': priority,
                'uom': pdt.uom_id.name or '',
            })
        inventory_risk.sort(key=lambda r: (r['_priority'], r.get('days_cover') if r.get('days_cover') is not None else 999999, -r['sold_30d']))
        for row in inventory_risk:
            row.pop('_priority', None)
        inventory_risk = inventory_risk[:40]

        # ---------------- Warehouse comparison ----------------
        warehouse_comparison = []
        if can_manage:
            warehouses = self.env['stock.warehouse'].search([], order='name asc')
            sales_by_wh = {}
            sale_groups = self.env['sale.order'].read_group(sales_domain, ['amount_total:sum'], ['warehouse_id'])
            for g in sale_groups:
                wid = g.get('warehouse_id')
                if isinstance(wid, (list, tuple)) and wid:
                    sales_by_wh[wid[0]] = {'name': wid[1], 'sales': float(g.get('amount_total', 0.0) or 0.0), 'orders': int(g.get('__count', 0) or 0)}
                elif wid is False:
                    sales_by_wh[0] = {'name': 'Unassigned', 'sales': float(g.get('amount_total', 0.0) or 0.0), 'orders': int(g.get('__count', 0) or 0)}

            po_domain = [('state', 'in', ['purchase', 'done'])]
            if from_date and to_date:
                po_domain += [('date_order', '>=', str(fd_d)), ('date_order', '<', str(td_d + timedelta(days=1)))]
            po_groups = self.env['purchase.order'].read_group(po_domain, ['amount_total:sum'], ['picking_type_id'])
            picking_ids = [g['picking_type_id'][0] for g in po_groups if isinstance(g.get('picking_type_id'), (list, tuple)) and g.get('picking_type_id')]
            picking_map = {p.id: p.warehouse_id.id for p in self.env['stock.picking.type'].browse(picking_ids)}
            purchases_by_wh = {}
            for g in po_groups:
                pt = g.get('picking_type_id')
                wid = picking_map.get(pt[0]) if isinstance(pt, (list, tuple)) and pt else 0
                rec = purchases_by_wh.setdefault(wid, {'purchases': 0.0})
                rec['purchases'] += float(g.get('amount_total', 0.0) or 0.0)

            # Current warehouse stock at current standard cost. This is an
            # operational stock-value estimate, not an accounting valuation.
            stock_by_wh = {}
            for wh in warehouses:
                try:
                    locations = self.env['stock.location'].search([
                        ('id', 'child_of', wh.view_location_id.id), ('usage', '=', 'internal')
                    ])
                    quants = self.env['stock.quant'].search([('location_id', 'in', locations.ids), ('quantity', '!=', 0)])
                    stock_by_wh[wh.id] = round(sum(float(q.quantity or 0.0) * float(q.product_id.standard_price or 0.0) for q in quants), 2)
                except Exception:
                    stock_by_wh[wh.id] = 0.0

            for wh in warehouses:
                sr = sales_by_wh.get(wh.id, {'sales': 0.0, 'orders': 0})
                pr = purchases_by_wh.get(wh.id, {'purchases': 0.0})
                warehouse_comparison.append({
                    'warehouse_id': wh.id,
                    'warehouse': wh.name,
                    'sales': round(sr['sales'], 2),
                    'orders': sr['orders'],
                    'purchases': round(pr['purchases'], 2),
                    'stock_value': round(stock_by_wh.get(wh.id, 0.0), 2),
                    'sales_minus_purchases': round(sr['sales'] - pr['purchases'], 2),
                })
            if 0 in sales_by_wh:
                sr = sales_by_wh[0]
                warehouse_comparison.append({
                    'warehouse_id': 0, 'warehouse': 'Unassigned', 'sales': round(sr['sales'], 2),
                    'orders': sr['orders'], 'purchases': round(purchases_by_wh.get(0, {'purchases': 0.0})['purchases'], 2),
                    'stock_value': 0.0,
                    'sales_minus_purchases': round(sr['sales'] - purchases_by_wh.get(0, {'purchases': 0.0})['purchases'], 2),
                })

        # ---------------- Daily closing ----------------
        closing = {
            'date': str(fields.Date.from_string(daily_date)) if daily_date else str(today),
            'sales_orders': 0, 'sales_amount': 0.0, 'customer_payments': 0,
            'customer_received': 0.0, 'vendor_payments': 0, 'vendor_paid': 0.0,
            'customer_invoices': 0, 'customer_invoice_amount': 0.0,
            'vendor_bills': 0, 'vendor_bill_amount': 0.0,
            'deliveries_done': 0, 'receipts_done': 0, 'internal_transfers_done': 0,
            'draft_payments': 0, 'pending_deliveries': 0, 'pending_receipts': 0,
            'net_cash_movement': 0.0, 'journal_moves': [],
        }
        if can_manage:
            day = fields.Date.from_string(daily_date) if daily_date else today
            next_day = day + timedelta(days=1)
            so_domain = [('state', 'in', ['sale', 'done']), ('date_order', '>=', str(day)), ('date_order', '<', str(next_day))]
            so_groups = self.env['sale.order'].read_group(so_domain, ['amount_total:sum'], [])
            closing['sales_orders'] = self.env['sale.order'].search_count(so_domain)
            closing['sales_amount'] = round(sum(float(g.get('amount_total', 0.0) or 0.0) for g in so_groups), 2)

            pay_base = [('date', '=', str(day))]
            in_domain = pay_base + [('payment_type', '=', 'inbound'), ('state', 'in', ['in_process', 'paid'])]
            out_domain = pay_base + [('payment_type', '=', 'outbound'), ('state', 'in', ['in_process', 'paid'])]
            in_groups = self.env['account.payment'].read_group(in_domain, ['amount:sum'], [])
            out_groups = self.env['account.payment'].read_group(out_domain, ['amount:sum'], [])
            drafts = self.env['account.payment'].search_count(pay_base + [('state', '=', 'draft')])
            closing['customer_payments'] = self.env['account.payment'].search_count(in_domain)
            closing['customer_received'] = round(sum(float(g.get('amount', 0.0) or 0.0) for g in in_groups), 2)
            closing['vendor_payments'] = self.env['account.payment'].search_count(out_domain)
            closing['vendor_paid'] = round(sum(float(g.get('amount', 0.0) or 0.0) for g in out_groups), 2)
            closing['draft_payments'] = int(drafts)
            closing['net_cash_movement'] = round(closing['customer_received'] - closing['vendor_paid'], 2)

            inv_domain = [('move_type', '=', 'out_invoice'), ('state', '=', 'posted'), ('invoice_date', '=', str(day))]
            bill_domain = [('move_type', '=', 'in_invoice'), ('state', '=', 'posted'), ('invoice_date', '=', str(day))]
            inv_groups = self.env['account.move'].read_group(inv_domain, ['amount_total:sum'], [])
            bill_groups = self.env['account.move'].read_group(bill_domain, ['amount_total:sum'], [])
            closing['customer_invoices'] = self.env['account.move'].search_count(inv_domain)
            closing['customer_invoice_amount'] = round(sum(float(g.get('amount_total', 0.0) or 0.0) for g in inv_groups), 2)
            closing['vendor_bills'] = self.env['account.move'].search_count(bill_domain)
            closing['vendor_bill_amount'] = round(sum(float(g.get('amount_total', 0.0) or 0.0) for g in bill_groups), 2)

            done_domain = [('state', '=', 'done'), ('date_done', '>=', str(day)), ('date_done', '<', str(next_day))]
            closing['deliveries_done'] = self.env['stock.picking'].search_count(done_domain + [('picking_type_id.code', '=', 'outgoing')])
            closing['receipts_done'] = self.env['stock.picking'].search_count(done_domain + [('picking_type_id.code', '=', 'incoming')])
            closing['internal_transfers_done'] = self.env['stock.picking'].search_count(done_domain + [('picking_type_id.code', '=', 'internal')])
            closing['pending_deliveries'] = self.env['stock.picking'].search_count([('picking_type_id.code', '=', 'outgoing'), ('state', 'not in', ['done','cancel']), ('scheduled_date', '>=', str(day)), ('scheduled_date', '<', str(next_day))])
            closing['pending_receipts'] = self.env['stock.picking'].search_count([('picking_type_id.code', '=', 'incoming'), ('state', 'not in', ['done','cancel']), ('scheduled_date', '>=', str(day)), ('scheduled_date', '<', str(next_day))])
            closing['journal_moves'] = self.get_journal_balance(str(day), str(day))

        return {
            'sales_performance': {
                'sales': sales_total,
                'orders': order_count,
                'aov': aov,
                'previous_sales': previous_sales,
                'last_year_sales': last_year_sales,
                'previous_orders': previous_orders,
                'last_year_orders': last_year_orders,
                'vs_previous_pct': prev_change_pct,
                'vs_last_year_pct': ly_change_pct,
                'comparison_available': comparison_available,
                'can_view_profit': can_manage,
                'estimated_invoice_revenue': round(estimated_revenue, 2) if can_manage else None,
                'estimated_cost': round(estimated_cost, 2) if can_manage else None,
                'estimated_gross_profit': estimated_gross_profit,
                'estimated_margin_pct': estimated_margin_pct,
            },
            'product_profitability': product_profitability,
            'inventory_risk': inventory_risk,
            'warehouse_comparison': warehouse_comparison,
            'daily_closing': closing,
        }

    # ─── Trend Chart Data ─────────────────────────────────────────────────────
    @api.model
    def get_trend_data(self, from_date=False, to_date=False, model='sale', granularity='day'):
        """Return sales trend points grouped by the requested time scale.

        Supported scales are day, week, month, quarter and year.  The server
        fills periods with zero sales so the graph has a continuous time axis
        rather than silently skipping dates with no orders.
        """
        today = fields.Date.today()
        if not from_date:
            from_date = str(today.replace(day=1))
            to_date = str(today)
        else:
            to_date = to_date or str(today)

        granularity = str(granularity or 'day').lower()
        if granularity not in {'day', 'week', 'month', 'quarter', 'year'}:
            granularity = 'day'

        from datetime import date, timedelta
        try:
            fd = date.fromisoformat(str(from_date)[:10])
            td = date.fromisoformat(str(to_date)[:10])
        except ValueError:
            fd = today.replace(day=1)
            td = today
        if td < fd:
            fd, td = td, fd

        # Align the visible range to the selected period.
        if granularity == 'week':
            start = fd - timedelta(days=fd.weekday())
            end = td - timedelta(days=td.weekday())
            interval = timedelta(days=7)
        elif granularity == 'month':
            start = fd.replace(day=1)
            end = td.replace(day=1)
            interval = 'month'
        elif granularity == 'quarter':
            start = fd.replace(month=((fd.month - 1) // 3) * 3 + 1, day=1)
            end = td.replace(month=((td.month - 1) // 3) * 3 + 1, day=1)
            interval = 'quarter'
        elif granularity == 'year':
            start = fd.replace(month=1, day=1)
            end = td.replace(month=1, day=1)
            interval = 'year'
        else:
            start = fd
            end = td
            interval = timedelta(days=1)

        if model == 'sale':
            self.env.cr.execute(
                """
                SELECT DATE_TRUNC(%s, date_order)::date AS period_start,
                       COALESCE(SUM(amount_total),0)
                FROM sale_order
                WHERE state IN ('sale','done')
                  AND DATE(date_order) >= %s AND DATE(date_order) <= %s
                GROUP BY period_start
                ORDER BY period_start
                """, (granularity, str(fd), str(td)))
        else:
            self.env.cr.execute(
                """
                SELECT DATE_TRUNC(%s, invoice_date::timestamp)::date AS period_start,
                       COALESCE(SUM(amount_total),0)
                FROM account_move
                WHERE move_type='out_invoice' AND state='posted'
                  AND invoice_date >= %s AND invoice_date <= %s
                GROUP BY period_start
                ORDER BY period_start
                """, (granularity, str(fd), str(td)))

        grouped = {r[0]: round(float(r[1] or 0.0), 2) for r in self.env.cr.fetchall()}

        points = []
        current = start
        while current <= end:
            points.append({'date': str(current), 'amount': grouped.get(current, 0.0)})
            if granularity == 'day' or granularity == 'week':
                current = current + interval
            elif granularity == 'month':
                if current.month == 12:
                    current = current.replace(year=current.year + 1, month=1, day=1)
                else:
                    current = current.replace(month=current.month + 1, day=1)
            elif granularity == 'quarter':
                month = current.month + 3
                year = current.year + (1 if month > 12 else 0)
                month = month - 12 if month > 12 else month
                current = current.replace(year=year, month=month, day=1)
            else:  # year
                current = current.replace(year=current.year + 1, month=1, day=1)

        return points

    # ─── Aging Report ────────────────────────────────────────────────────────
    @api.model
    def get_aging_report(self):
        result = {'ar': [], 'ap': []}
        for move_type, key in [('out_invoice', 'ar'), ('in_invoice', 'ap')]:
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
            result[key] = [{'bucket': r[0], 'count': int(r[1]), 'total': round(float(r[2]), 2)}
                            for r in self.env.cr.fetchall()]
        return result

    # ─── Operations widget (small, embedded in Business Dashboard insights) ──
    @api.model
    def get_operations_data(self):
        pending_deliveries, mismatch, stock_value = [], [], 0.0
        try:
            pickings = self.env['stock.picking'].search([
                ('picking_type_code', '=', 'outgoing'),
                ('state', 'not in', ['done', 'cancel']),
            ], limit=20)
            for p in pickings:
                late = p.scheduled_date and p.scheduled_date.date() < fields.Date.today()
                pending_deliveries.append({
                    'name': p.name, 'partner': p.partner_id.name or '',
                    'date': self._fmt(p.scheduled_date.date() if p.scheduled_date else None),
                    'state': p.state, 'late': late,
                })
        except Exception:
            pass
        try:
            pos = self.env['purchase.order'].search([('state', 'in', ['purchase', 'done'])], limit=100)
            for p in pos:
                for l in p.order_line:
                    if abs(l.qty_received - l.product_qty) > 0.01:
                        mismatch.append({
                            'po': p.name, 'partner': p.partner_id.name or '',
                            'product': l.product_id.name or '',
                            'ordered': round(l.product_qty, 2),
                            'received': round(l.qty_received, 2),
                            'diff': round(l.product_qty - l.qty_received, 2),
                        })
                        if len(mismatch) >= 15:
                            break
                if len(mismatch) >= 15:
                    break
        except Exception:
            pass
        try:
            self.env.cr.execute("SELECT COALESCE(SUM(svl.value),0) FROM stock_valuation_layer svl")
            row = self.env.cr.fetchone()
            stock_value = round(float(row[0] or 0), 2)
        except Exception:
            pass
        return {'pending_deliveries': pending_deliveries, 'mismatch': mismatch, 'stock_value': stock_value}

    # ─── Customer Intelligence ────────────────────────────────────────────────
    @api.model
    def get_customer_intelligence(self, from_date=False, to_date=False):
        today = str(fields.Date.today())
        fd = from_date or today[:8] + '01'
        td = to_date or today

        self.env.cr.execute("""
            SELECT DISTINCT partner_id FROM sale_order
            WHERE state IN ('sale','done') AND DATE(date_order) >= %s AND DATE(date_order) <= %s
        """, (fd, td))
        period_partners = {r[0] for r in self.env.cr.fetchall()}

        self.env.cr.execute("""
            SELECT DISTINCT partner_id FROM sale_order
            WHERE state IN ('sale','done') AND DATE(date_order) < %s
        """, (fd,))
        before_partners = {r[0] for r in self.env.cr.fetchall()}

        new_count = len(period_partners - before_partners)
        returning_count = len(period_partners & before_partners)

        self.env.cr.execute("""
            SELECT rp.id, rp.name,
                   COUNT(DISTINCT so.id) as orders,
                   COALESCE(SUM(so.amount_total),0) as total,
                   COALESCE(AVG(so.amount_total),0) as avg_val,
                   MAX(so.date_order) as last_order
            FROM sale_order so
            JOIN res_partner rp ON rp.id=so.partner_id
            WHERE so.state IN ('sale','done')
            GROUP BY rp.id,rp.name
            ORDER BY total DESC LIMIT 10
        """)
        clv = [{'id': r[0], 'name': r[1] or 'Unknown', 'orders': int(r[2]),
                'total': round(float(r[3]), 2), 'avg': round(float(r[4]), 2),
                'last_order': str(r[5])[:10] if r[5] else ''} for r in self.env.cr.fetchall()]

        return {'new': new_count, 'returning': returning_count, 'total': new_count + returning_count, 'clv': clv}

    # ─── Financial Controls ───────────────────────────────────────────────────
    @api.model
    def get_financial_controls(self, from_date=False, to_date=False):
        today = str(fields.Date.today())
        fd = from_date or today[:8] + '01'
        td = to_date or today

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

        try:
            from datetime import date as ddate
            fd_dt = ddate.fromisoformat(fd)
            td_dt = ddate.fromisoformat(td)
            span = (td_dt - fd_dt).days + 1
            prev_from = str(fd_dt - timedelta(days=span))
            prev_to = str(td_dt - timedelta(days=span))
            ly_from = str(fd_dt.replace(year=fd_dt.year - 1))
            ly_to = str(td_dt.replace(year=td_dt.year - 1))

            def period_sales(f, t):
                self.env.cr.execute("""
                    SELECT COALESCE(SUM(amount_total),0) FROM sale_order
                    WHERE state IN ('sale','done') AND DATE(date_order) >= %s AND DATE(date_order) <= %s
                """, (f, t))
                return round(float(self.env.cr.fetchone()[0] or 0), 2)

            current_sales = period_sales(fd, td)
            previous_sales = period_sales(prev_from, prev_to)
            last_year_sales = period_sales(ly_from, ly_to)
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
        inv_dom = [('move_type', '=', 'out_invoice'), ('state', '!=', 'cancel')]
        vend_dom = [('move_type', '=', 'in_invoice'), ('state', '!=', 'cancel')]
        pay_dom = []
        if from_date and to_date:
            df = [('invoice_date', '>=', from_date), ('invoice_date', '<=', to_date)]
            inv_dom += df
            vend_dom += df
            pay_dom = [('date', '>=', from_date), ('date', '<=', to_date)]

        invoices = self.env['account.move'].search(inv_dom)
        vendor_bills = self.env['account.move'].search(vend_dom)
        payments = self.env['account.payment'].search(pay_dom)
        f = self._fmt

        def parent_name(partner):
            cp = partner.commercial_partner_id
            return cp.name if (cp and cp.id != partner.id) else ''

        def move_row(m):
            lines = [{'product': l.product_id.name or l.name or '', 'qty': l.quantity,
                      'uom': l.product_uom_id.name or '', 'price_unit': l.price_unit,
                      'discount': l.discount, 'tax': ', '.join(l.tax_ids.mapped('name')),
                      'subtotal': l.price_subtotal}
                     for l in m.invoice_line_ids.filtered(lambda x: x.display_type in (False, 'product'))]
            return {'id': m.id, 'name': m.name, 'partner': m.partner_id.name or '',
                    'partner_id': m.partner_id.id, 'partner_parent': parent_name(m.partner_id), 'date': f(m.invoice_date),
                    'due_date': f(m.invoice_date_due), 'amount': m.amount_total,
                    'residual': m.amount_residual, 'state': m.payment_state, 'lines': lines}

        return {
            'invoices': [move_row(m) for m in invoices],
            'vendor_bills': [move_row(m) for m in vendor_bills],
            'transactions': [{'id': t.id, 'name': t.name or 'Draft', 'partner': t.partner_id.name or '',
                              'partner_id': t.partner_id.id, 'partner_parent': parent_name(t.partner_id),
                              'date': f(t.date), 'journal': t.journal_id.name,
                              'type': t.payment_type,
                              'received': t.amount if t.payment_type == 'inbound' else 0,
                              'paid': t.amount if t.payment_type == 'outbound' else 0,
                              'state': t.state} for t in payments],
        }

    # ─── Finance Widgets (KPI) ────────────────────────────────────────────────
    @api.model
    def get_finance_widgets(self):
        today = fields.Date.today()
        fom = today.replace(day=1)
        d7 = today + timedelta(days=7)

        overdue_bills = self.env['account.move'].search([('move_type', '=', 'in_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']), ('invoice_date_due', '<', str(today))])
        due_soon_bills = self.env['account.move'].search([('move_type', '=', 'in_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']),
            ('invoice_date_due', '>=', str(today)), ('invoice_date_due', '<=', str(d7))])
        overdue_inv = self.env['account.move'].search([('move_type', '=', 'out_invoice'), ('state', '=', 'posted'),
            ('payment_state', 'not in', ['paid', 'in_payment']), ('invoice_date_due', '<', str(today))])

        journals = self.env['account.journal'].search([('type', 'in', ['bank', 'cash'])])
        security = self._ledger_security_rules_for_journals(journals)

        # Ledger Balance Security is applied per contributing journal.  For the
        # aggregate Cash Flow card we disclose only the balance portion belonging
        # to journals the current user may view.  Movement totals (In/Out) remain
        # aggregated across all bank/cash journals so they remain useful for
        # transfer checking.  Hidden journal amounts never leave the server.
        cash_balance_masked = False
        visible_journal_count = 0
        contributing_journal_count = 0
        opening_cash = 0.0
        month_in = 0.0
        month_out = 0.0
        current_cash = 0.0

        for journal in journals.filtered(lambda j: j.default_account_id):
            contributing_journal_count += 1
            account_id = int(journal.default_account_id.id)
            journal_security = security.get(journal.id, {})
            journal_masked = bool(journal_security.get('masked'))
            cash_balance_masked = cash_balance_masked or journal_masked

            # Restrict the balance calculation to the journal's own ledger and
            # default account. This preserves the journal-level security boundary
            # and avoids mixing values between journals.
            self.env.cr.execute(
                "SELECT "
                "COALESCE(SUM(aml.debit-aml.credit) FILTER (WHERE am.date<%s),0),"
                "COALESCE(SUM(aml.debit) FILTER (WHERE am.date>=%s),0),"
                "COALESCE(SUM(aml.credit) FILTER (WHERE am.date>=%s),0) "
                "FROM account_move_line aml "
                "JOIN account_move am ON am.id=aml.move_id "
                "WHERE aml.journal_id=%s AND aml.account_id=%s AND am.state='posted'",
                (str(fom), str(fom), str(fom), int(journal.id), account_id),
            )
            row = self.env.cr.fetchone()
            journal_opening = float(row[0] or 0)
            journal_in = float(row[1] or 0)
            journal_out = float(row[2] or 0)
            journal_current = journal_opening + journal_in - journal_out

            # Movement totals intentionally remain visible, including for
            # protected journals. Only Opening/Balance are security-filtered.
            month_in += journal_in
            month_out += journal_out

            if not journal_masked:
                visible_journal_count += 1
                opening_cash += journal_opening
                current_cash += journal_current

        cash_balance_partial_masked = bool(
            cash_balance_masked and visible_journal_count and
            visible_journal_count < contributing_journal_count
        )
        cash_balance_fully_masked = bool(
            cash_balance_masked and contributing_journal_count and not visible_journal_count
        )

        self.env.cr.execute("SELECT COALESCE(SUM(amount_total),0) FROM account_move WHERE move_type='out_invoice' AND state='posted' AND invoice_date>=%s", (str(fom),))
        revenue = float(self.env.cr.fetchone()[0] or 0)
        self.env.cr.execute("SELECT COALESCE(SUM(amount_total),0) FROM account_move WHERE move_type='in_invoice' AND state='posted' AND invoice_date>=%s", (str(fom),))
        costs = float(self.env.cr.fetchone()[0] or 0)

        return {
            'overdue_bills_count': len(overdue_bills), 'overdue_bills_amount': round(sum(overdue_bills.mapped('amount_residual')), 2),
            'due_soon_count': len(due_soon_bills), 'due_soon_amount': round(sum(due_soon_bills.mapped('amount_residual')), 2),
            'overdue_inv_count': len(overdue_inv), 'overdue_inv_amount': round(sum(overdue_inv.mapped('amount_residual')), 2),
            # Opening and Balance contain only the visible journal portion.
            # A trailing '*' in the UI indicates that protected journal values
            # were excluded.  When every contributing journal is protected, no
            # numeric balance is sent to the browser.
            'opening_cash': None if cash_balance_fully_masked else round(opening_cash, 2),
            'month_in': round(month_in, 2),
            'month_out': round(month_out, 2),
            'current_cash': None if cash_balance_fully_masked else round(current_cash, 2),
            'cash_balance_masked': cash_balance_masked,
            'cash_balance_partial_masked': cash_balance_partial_masked,
            'cash_balance_fully_masked': cash_balance_fully_masked,
            'cash_flow_movements_visible': True,
            'revenue': round(revenue, 2), 'costs': round(costs, 2),
            'gross_profit': round(revenue - costs, 2),
            'margin_pct': round((revenue - costs) / revenue * 100, 1) if revenue else 0,
        }

    # ─── Ledger balance security ──────────────────────────────────────────────
    def _ledger_security_rules_for_journals(self, journals):
        """Resolve effective ledger-balance visibility with a fresh server-side read.

        The decision is intentionally made without relying on ORM record-rule
        visibility or cached configuration.  The security configuration and the
        approved-user relation are read directly from their PostgreSQL tables,
        then the current request user's UID is checked against the approved-user
        relation.  This makes the masking decision deterministic for every RPC
        request, including Finance Dashboard, print and CSV calls.
        """
        journal_ids = journals.ids if hasattr(journals, 'ids') else [int(x) for x in (journals or [])]
        journal_ids = [int(x) for x in journal_ids if x]
        if not journal_ids:
            return {}

        # Read the configuration directly from PostgreSQL.  This avoids any
        # stale ORM cache / record-rule interaction with the security model.
        rule_map = {}
        approved_map = {jid: set() for jid in journal_ids}
        try:
            self.env.cr.execute(
                "SELECT id, journal_id, masked FROM dashboard_ledger_security "
                "WHERE journal_id = ANY(%s)",
                (journal_ids,),
            )
            for rule_id, journal_id, masked in self.env.cr.fetchall():
                jid = int(journal_id)
                # A journal should have one rule because of the SQL constraint,
                # but treating any matching masked rule as protected is safer if
                # an old database contains duplicate legacy rows.
                existing = rule_map.get(jid)
                rule_map[jid] = {
                    'id': int(rule_id),
                    'masked': bool(masked) or bool(existing and existing.get('masked')),
                }

            if rule_map:
                rule_ids = list({v['id'] for v in rule_map.values()})
                self.env.cr.execute(
                    "SELECT security_id, user_id FROM dashboard_ledger_security_user_rel "
                    "WHERE security_id = ANY(%s)",
                    (rule_ids,),
                )
                rule_to_journal = {v['id']: jid for jid, v in rule_map.items()}
                for security_id, user_id in self.env.cr.fetchall():
                    jid = rule_to_journal.get(int(security_id))
                    if jid in approved_map:
                        approved_map[jid].add(int(user_id))
        except Exception:
            # Fall back to a fresh sudo ORM query for customized/legacy schemas.
            # If that also fails, no rule is inferred and normal visibility is
            # preserved rather than accidentally leaking a protected amount.
            rule_map = {}
            try:
                rule_model = self.env['dashboard.ledger.security'].sudo()
                for r in rule_model.search([('journal_id', 'in', journal_ids)]):
                    jid = int(r.journal_id.id)
                    rule_map[jid] = {'id': int(r.id), 'masked': bool(r.masked)}
                    approved_map[jid] = set(r.approved_user_ids.ids)
            except Exception:
                pass

        user = self.env.user
        is_admin = bool(
            user.has_group('eagle_business_dashboard.group_dashboard_admin')
            or user.has_group('base.group_system')
        )
        uid = int(user.id)
        result = {}
        for journal_id in journal_ids:
            rule = rule_map.get(int(journal_id))
            rule_masked = bool(rule and rule.get('masked'))
            # A protected journal is masked for everyone who is not explicitly
            # approved, including Dashboard Admins and System Administrators.
            # Those groups control configuration access; they are not an
            # automatic visibility bypass.  This removes the ambiguity that
            # previously made the rule appear ineffective when the tester was
            # logged in with an administrator account.
            explicitly_approved = uid in approved_map.get(int(journal_id), set())
            masked = bool(rule_masked and not explicitly_approved)
            result[int(journal_id)] = {
                'configured': bool(rule),
                'rule_masked': rule_masked,
                'masked': masked,
                'approved': explicitly_approved,
                'administrator': is_admin,
            }
        return result

    @api.model
    def get_ledger_security_status(self, journal_ids=None):
        """Expose only the current user's effective visibility state."""
        if journal_ids:
            journals = self.env['account.journal'].browse([int(x) for x in journal_ids]).exists()
            journals = journals.filtered(lambda j: j.type in ('bank', 'cash'))
        else:
            journals = self.env['account.journal'].search([('type', 'in', ['bank', 'cash'])])
        effective = self._ledger_security_rules_for_journals(journals)
        return {
            str(j.id): {
                'masked': bool(effective.get(j.id, {}).get('masked')),
                'approved': bool(effective.get(j.id, {}).get('approved')),
                'administrator': bool(effective.get(j.id, {}).get('administrator')),
            }
            for j in journals
        }

    # ─── Journal Balance ─────────────────────────────────────────────────────
    @api.model
    def get_journal_balance(self, from_date=False, to_date=False):
        journals = self.env['account.journal'].search([('type', 'in', ['bank', 'cash'])], order='name asc')
        security = self._ledger_security_rules_for_journals(journals)
        result = []
        for journal in journals:
            balance_masked = bool(security.get(journal.id, {}).get('masked'))
            approved = bool(security.get(journal.id, {}).get('approved'))
            account = journal.default_account_id
            if not account:
                continue
            opening = 0.0
            if from_date:
                self.env.cr.execute("SELECT COALESCE(SUM(aml.debit-aml.credit),0) FROM account_move_line aml JOIN account_move am ON am.id=aml.move_id WHERE aml.account_id=ANY(%s) AND am.state='posted' AND am.date<%s", ([account.id], from_date))
                opening = float(self.env.cr.fetchone()[0] or 0)
            parts = []
            params = [account.id]
            if from_date:
                parts.append("am.date>=%s")
                params.append(from_date)
            if to_date:
                parts.append("am.date<=%s")
                params.append(to_date)
            dc = ("AND " + " AND ".join(parts)) if parts else ""
            self.env.cr.execute("""SELECT COALESCE(SUM(aml.debit),0),COALESCE(SUM(aml.credit),0),
                COUNT(*) FILTER(WHERE aml.debit>0),COUNT(*) FILTER(WHERE aml.credit>0)
                FROM account_move_line aml JOIN account_move am ON am.id=aml.move_id
                WHERE aml.account_id=%%s AND am.state='posted' %s""" % dc, params)
            row = self.env.cr.fetchone()
            deposit = float(row[0] or 0)
            withdraw = float(row[1] or 0)
            change = deposit - withdraw
            closing = round(opening + change, 2)
            result.append({'journal_id': journal.id, 'journal_name': journal.name,
                'opening': None if balance_masked else round(opening, 2),
                'deposit': round(deposit, 2), 'deposit_count': int(row[2] or 0),
                'withdraw': round(withdraw, 2), 'withdraw_count': int(row[3] or 0),
                'change': round(change, 2), 'closing': None if balance_masked else closing,
                'balance_masked': balance_masked, 'can_view_balance': not balance_masked,
                'security_approved': approved,
                'security_configured': bool(security.get(journal.id, {}).get('configured')),
                'security_rule_masked': bool(security.get(journal.id, {}).get('rule_masked'))})
        return result

    @api.model
    def get_journal_transactions(self, journal_id, from_date=False, to_date=False):
        domain = [('journal_id', '=', journal_id), ('state', 'in', ['draft', 'in_process', 'paid'])]
        if from_date:
            domain.append(('date', '>=', from_date))
        if to_date:
            domain.append(('date', '<=', to_date))
        payments = self.env['account.payment'].search(domain, order='date desc', limit=300)
        f = self._fmt
        return [{'id': p.id, 'name': p.name or 'Draft', 'partner': p.partner_id.name or '',
                 'date': f(p.date), 'journal_id': p.journal_id.id, 'amount': p.amount, 'type': p.payment_type,
                 'received': p.amount if p.payment_type == 'inbound' else 0,
                 'paid': p.amount if p.payment_type == 'outbound' else 0,
                 'state': p.state} for p in payments]

    # ─── Payment validation from dashboard ────────────────────────────────
    @api.model
    def validate_payment(self, payment_id):
        payment = self.env['account.payment'].browse(int(payment_id)).exists()
        if not payment:
            from odoo.exceptions import UserError
            raise UserError('Payment entry not found.')
        payment.ensure_one()
        if payment.state == 'draft':
            payment.action_post()
            self._audit('Validate payment', 'account.payment', payment.id, payment.name or 'Draft', 'Dashboard payment validation')
        elif payment.state == 'in_process':
            # In Odoo 18, in_process means the payment has already been posted
            # but its outstanding/liquidity side is not yet reconciled. There is
            # no second posting operation to perform. Keep the same dashboard
            # button visible so the workflow is consistent, but report the
            # actual accounting state instead of forcing an invalid transition.
            return {
                'id': payment.id,
                'state': payment.state,
                'name': payment.name or 'Payment',
                'already_posted': True,
                'message': '%s is already posted and is currently In Process. Reconciliation/bank matching is required to move it to Paid.' % (payment.name or 'Payment'),
            }
        return {'id': payment.id, 'state': payment.state, 'name': payment.name or 'Payment'}

    # ─── Dynamic List Action (for KPI card "view details" links) ─────────
    @api.model
    def open_dynamic_action(self, model, domain, name='Dashboard List'):
        """Create a bounded Odoo 18 list/form action for dashboard drill-downs.

        The dashboard only needs a fixed set of business models. Restricting the
        target model prevents the generic RPC from becoming a model browser while
        the normal Odoo ACLs/record rules still govern the opened view.
        """
        allowed_models = {
            'account.move', 'account.payment', 'account.move.line',
            'account.bank.statement.line', 'sale.order', 'purchase.order',
            'stock.picking', 'product.product', 'res.partner', 'dashboard.audit.event',
        }
        if model not in allowed_models:
            from odoo.exceptions import AccessError
            raise AccessError('This dashboard drill-down model is not allowed.')
        model_obj = self.env[model]
        model_obj.check_access_rights('read')
        if not isinstance(domain, list):
            from odoo.exceptions import ValidationError
            raise ValidationError('Invalid dashboard drill-down domain.')
        action = self.env['ir.actions.act_window'].sudo().create({
            'name': str(name or 'Dashboard List')[:120],
            'res_model': model,
            'view_mode': 'list,form',
            'domain': domain[:80],
            'target': 'current',
        })
        return action.id

    # ═════════════════════════════════════════════════════════════════════
    # OPERATIONS DASHBOARD (Delivery Orders / Receipts / Internal Transfers)
    # ═════════════════════════════════════════════════════════════════════
    @api.model
    def get_operations_dashboard(self, from_date=False, to_date=False):
        # Warehouse rows are considered in-range when EITHER their creation
        # date OR their completion (done) date falls inside the selected
        # dashboard date range. This prevents a delivery created earlier but
        # completed in the selected period from disappearing, and likewise
        # keeps newly-created still-pending deliveries visible.
        range_domain = []
        if from_date and to_date:
            range_start = str(from_date) + ' 00:00:00'
            range_end = str(to_date) + ' 23:59:59'
            range_domain = [
                '|',
                '&', ('create_date', '>=', range_start), ('create_date', '<=', range_end),
                '&', ('date_done', '>=', range_start), ('date_done', '<=', range_end),
            ]

        row = self._operations_picking_row

        deliveries = self.env['stock.picking'].search(
            range_domain + [('picking_type_id.code', '=', 'outgoing')], order='create_date desc', limit=200)
        receipts = self.env['stock.picking'].search(
            range_domain + [('picking_type_id.code', '=', 'incoming')], order='create_date desc', limit=200)
        internal = self.env['stock.picking'].search(
            range_domain + [('picking_type_id.code', '=', 'internal')], order='create_date desc', limit=200)

        return {
            'deliveries': [row(p) for p in deliveries],
            'receipts': [row(p) for p in receipts],
            'internal': [row(p) for p in internal],
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
            'pending_deliveries': pending_deliveries, 'pending_receipts': pending_receipts,
            'late': late, 'today_done': today_done,
        }

    @api.model
    def _operations_parent_name(self, partner):
        cp = partner.commercial_partner_id
        return cp.name if (cp and cp.id != partner.id) else ''

    @api.model
    def _operations_sale_order_row(self, order):
        lines = [{
            'product': l.product_id.name or l.name or '',
            'qty': l.product_uom_qty,
            'uom': l.product_uom.name or '',
            'price_unit': l.price_unit,
            'discount': getattr(l, 'discount', 0.0) or 0.0,
            'tax': ', '.join(l.tax_id.mapped('name')) if hasattr(l, 'tax_id') else '',
            'subtotal': l.price_subtotal,
        } for l in order.order_line.filtered(lambda x: not x.display_type)]
        return {
            'id': order.id, 'name': order.name, 'partner': order.partner_id.name or '',
            'partner_id': order.partner_id.id,
            'partner_parent': self._operations_parent_name(order.partner_id),
            'status': order.state, 'state': order.state, 'date': self._fmt(order.date_order),
            'invoice_status': order.invoice_status, 'billing_status': order.invoice_status,
            'amount': order.amount_total, 'lines': lines,
        }

    @api.model
    def _operations_payment_row(self, payment):
        return {
            'id': payment.id, 'name': payment.name or 'Draft',
            'partner': payment.partner_id.name or '', 'partner_id': payment.partner_id.id,
            'partner_parent': self._operations_parent_name(payment.partner_id),
            'ledger': payment.journal_id.name, 'journal_id': payment.journal_id.id,
            'date': self._fmt(payment.date),
            'received': payment.amount if payment.payment_type == 'inbound' else 0,
            'paid': payment.amount if payment.payment_type == 'outbound' else 0,
            'state': payment.state,
        }

    @api.model
    def _operations_picking_row(self, picking):
        today = fields.Date.today()
        sched = picking.scheduled_date.date() if picking.scheduled_date else None
        created = picking.create_date.date() if picking.create_date else None
        completed = picking.date_done.date() if picking.date_done else None
        carrier = picking.carrier_id if 'carrier_id' in picking._fields else False
        tracking_ref = picking.carrier_tracking_ref if 'carrier_tracking_ref' in picking._fields else False
        created_at = fields.Datetime.context_timestamp(self, picking.create_date) if picking.create_date else False
        scheduled_at = fields.Datetime.context_timestamp(self, picking.scheduled_date) if picking.scheduled_date else False
        tracking_url = False
        if tracking_ref and 'carrier_tracking_url' in picking._fields:
            raw_tracking_url = picking.carrier_tracking_url or False
            if raw_tracking_url:
                try:
                    parsed_tracking = json.loads(raw_tracking_url)
                except (TypeError, ValueError):
                    parsed_tracking = raw_tracking_url
                if isinstance(parsed_tracking, list):
                    for tracker in parsed_tracking:
                        if isinstance(tracker, (list, tuple)) and len(tracker) >= 2:
                            candidate = str(tracker[1] or '').strip()
                            if candidate.startswith(('http://', 'https://')):
                                tracking_url = candidate
                                break
                elif isinstance(parsed_tracking, str):
                    candidate = parsed_tracking.strip()
                    if candidate.startswith(('http://', 'https://')):
                        tracking_url = candidate
        return {
            'id': picking.id, 'name': picking.name, 'partner': picking.partner_id.name or '',
            'partner_id': picking.partner_id.id,
            'partner_mobile': (picking.partner_id.mobile or picking.partner_id.commercial_partner_id.mobile or '') if picking.partner_id else '',
            'partner_parent': self._operations_parent_name(picking.partner_id),
            'creation_date': self._fmt(created) if created else '',
            'scheduled_date': self._fmt(sched) if sched else '',
            'creation_datetime': created_at.strftime('%d/%m/%Y %H:%M:%S') if created_at else '',
            'scheduled_datetime': scheduled_at.strftime('%d/%m/%Y %H:%M:%S') if scheduled_at else '',
            'from_location': picking.location_id.display_name or '',
            'from_location_id': picking.location_id.id or False,
            'to_location': picking.location_dest_id.display_name or '',
            'to_location_id': picking.location_dest_id.id or False,
            'responsible': picking.user_id.display_name or '',
            'responsible_id': picking.user_id.id or False,
            'date_done': self._fmt(completed) if completed else '',
            'carrier': carrier.display_name if carrier else '',
            'tracking_reference': tracking_ref or '', 'tracking_url': tracking_url or '',
            'state': picking.state, 'origin': picking.origin or '',
            'products_count': len(picking.move_ids),
            'late': bool(sched and sched < today and picking.state not in ('done', 'cancel')),
        }

    @api.model
    def get_operations_payment_refresh(self, payment_id, from_date=False, to_date=False):
        payment = self.env['account.payment'].browse(int(payment_id)).exists()
        if not payment:
            return {'found': False, 'id': int(payment_id)}
        visible = True
        if from_date and to_date:
            pdate = payment.date
            visible = bool(pdate and str(from_date) <= str(pdate) <= str(to_date))
        return {'found': True, 'visible': visible, 'row': self._operations_payment_row(payment)}

    @api.model
    def get_operations_picking_refresh(self, picking_id, from_date=False, to_date=False):
        picking = self.env['stock.picking'].browse(int(picking_id)).exists()
        if not picking:
            return {'found': False, 'id': int(picking_id)}
        visible = True
        if from_date and to_date:
            start = str(from_date)
            end = str(to_date)
            created = fields.Date.to_string(picking.create_date.date()) if picking.create_date else ''
            done = fields.Date.to_string(picking.date_done.date()) if picking.date_done else ''
            visible = (start <= created <= end) or (start <= done <= end)
        code = picking.picking_type_id.code
        return {
            'found': True, 'visible': visible,
            'kind': 'delivery' if code == 'outgoing' else 'receipt' if code == 'incoming' else 'internal',
            'row': self._operations_picking_row(picking),
            'widgets': self.get_operations_widgets(),
        }

    @api.model
    def get_operations_sale_order_refresh(self, order_id, from_date=False, to_date=False):
        order = self.env['sale.order'].browse(int(order_id)).exists()
        if not order:
            return {'found': False, 'id': int(order_id)}
        visible = True
        if from_date and to_date:
            dt = order.create_date.date() if order.create_date else None
            visible = bool(dt and str(from_date) <= str(dt) <= str(to_date))
        return {'found': True, 'visible': visible, 'row': self._operations_sale_order_row(order)}

    @api.model
    def validate_picking(self, picking_id):
        picking = self.env['stock.picking'].browse(picking_id)
        if not picking.exists() or picking.state in ('done', 'cancel'):
            return {'ok': False, 'state': picking.state if picking.exists() else False}
        try:
            result = picking.button_validate()
            # Standard Odoo validation may return a wizard action (for example
            # backorders or immediate transfers). Return it to the Operations
            # client so the normal Odoo workflow is preserved.
            if isinstance(result, dict) and result.get('type'):
                return {
                    'ok': True,
                    'state': picking.state,
                    'action': result,
                    'message': 'Odoo validation requires an additional step.',
                }
            self._audit('Validate picking', 'stock.picking', picking.id, picking.name, 'Dashboard validation')
            return {'ok': True, 'state': picking.state}
        except Exception as exc:
            return {'ok': False, 'state': picking.state, 'message': str(exc)}

    @api.model
    def save_picking_tracking_reference(self, picking_id, tracking_reference):
        """Save a Delivery Order tracking reference only when it is currently empty.

        The dashboard intentionally does not allow overwriting an existing tracking
        reference. Users can still edit the value from the normal stock picking
        form when their Odoo permissions allow it.
        """
        picking = self.env['stock.picking'].browse(int(picking_id))
        if not picking.exists():
            return {'ok': False, 'message': 'Delivery Order not found.'}
        if picking.picking_type_id.code != 'outgoing':
            return {'ok': False, 'message': 'This tracking field is available only for Delivery Orders.'}
        if 'carrier_tracking_ref' not in picking._fields:
            return {'ok': False, 'message': 'Carrier Tracking Reference is unavailable. Please install the Delivery module.'}
        current = (picking.carrier_tracking_ref or '').strip()
        if current:
            return {'ok': False, 'tracking_reference': current, 'message': 'The tracking reference is already set and cannot be overwritten from the dashboard.'}
        value = str(tracking_reference or '').strip()
        if not value:
            return {'ok': False, 'message': 'Tracking Reference cannot be empty.'}
        picking.write({'carrier_tracking_ref': value[:256]})
        self._audit('Set tracking reference', 'stock.picking', picking.id, picking.name, 'Operations Dashboard')
        return {'ok': True, 'tracking_reference': picking.carrier_tracking_ref or value[:256]}

    # ═════════════════════════════════════════════════════════════════════
    # FEATURE PACK — insights, exports, approvals, digest, layout
    # ═════════════════════════════════════════════════════════════════════

    # ─── Cash Flow Forecast (next 30 days) ─────────────────────────────
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

    # ─── Reorder Point Predictor ───────────────────────────────────────
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

    # ─── Seasonal Heatmap (sales by day-of-week) ──────────────────────────
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
        days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        return [{'day': days[int(r[0])], 'avg_amount': round(float(r[1]), 2), 'count': int(r[2])} for r in rows]

    # ─── Anomaly Detection ─────────────────────────────────────────────────
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

    # ─── Audit Trail Widget ─────────────────────────────────────────────────
    @api.model
    def get_audit_trail(self, limit=15):
        if self._get_user_role() not in ('admin', 'manager'):
            return []
        logs = self.env['dashboard.audit.event'].search(
            [('company_id', '=', self.env.company.id)],
            order='create_date desc, id desc', limit=max(1, min(int(limit or 15), 50))
        )
        return [{
            'model': x.model_name or '', 'res_id': x.record_id or 0,
            'author': x.user_id.name or 'System',
            'date': x.create_date.strftime('%d/%m/%Y %H:%M') if x.create_date else '',
            'summary': (x.action + ((' — ' + x.reference) if x.reference else ''))[:120],
        } for x in logs]

    # ─── Duplicate Invoice/Payment Detector ────────────────────────────────
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

    # ─── Missing Tax ID Warning ─────────────────────────────────────────────
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

    # ─── Approval Queue ──────────────────────────────────────────────────────
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
            self._audit('Approve sale order', 'sale.order', order.id, order.name, 'Dashboard approval')
            return True
        return False

    @api.model
    def approve_purchase_order(self, order_id):
        order = self.env['purchase.order'].browse(order_id)
        if order.exists() and order.state == 'draft':
            order.button_confirm()
            self._audit('Approve purchase order', 'purchase.order', order.id, order.name, 'Dashboard approval')
            return True
        return False

    # ─── Daily Digest Email ────────────────────────────────────────────────
    def send_daily_digest(self):
        today = fields.Date.today()
        widgets = self.get_business_widgets()
        finw = self.get_finance_widgets()
        self.env.cr.execute("""
            SELECT COALESCE(SUM(amount_total),0) FROM sale_order
            WHERE state IN ('sale','done') AND DATE(date_order) = %s
        """, (str(today),))
        today_sales = float(self.env.cr.fetchone()[0] or 0)

        admins = self.env['res.users'].search([
            ('groups_id', 'in', [self.env.ref('eagle_business_dashboard.group_dashboard_admin').id])
        ])
        body = f"""
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
              <h2 style="color:#1a1f36;">Daily Business Digest</h2>
              <p style="color:#6b7280;font-size:13px;">{today}</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <tr><td style="padding:8px;border:1px solid #e5e7eb;">Today's Sales</td>
                    <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;font-weight:700;">BDT {today_sales:.2f}</td></tr>
                <tr><td style="padding:8px;border:1px solid #e5e7eb;">Overdue Invoices</td>
                    <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;font-weight:700;color:#dc2626;">{widgets['overdue_count']} (BDT {widgets['overdue_amount']:.2f})</td></tr>
                <tr><td style="padding:8px;border:1px solid #e5e7eb;">Cash Balance</td>
                    <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;font-weight:700;">{('BDT %.2f' % finw['current_cash']) if finw.get('current_cash') is not None else 'Protected'}</td></tr>
                <tr><td style="padding:8px;border:1px solid #e5e7eb;">Low Stock Items</td>
                    <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;font-weight:700;">{len(widgets['low_stock'])}</td></tr>
              </table>
              <p style="font-size:12px;color:#9ca3af;">Sent automatically by the {self.env.company.name} Dashboard.</p>
            </div>
        """
        for user in admins:
            if not user.email:
                continue
            self.env['mail.mail'].sudo().create({
                'subject': f'{self.env.company.name} — Daily Business Digest',
                'body_html': body,
                'email_to': user.email,
                'auto_delete': True,
            }).send()

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

    # ─── Per-user Layout ───────────────────────────────────────────────────
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

    # ─── Currency Rates ────────────────────────────────────────────────────
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

    # ─── Bulk Actions ──────────────────────────────────────────────────────
    @api.model
    def bulk_mark_paid(self, move_ids):
        moves = self.env['account.move'].browse(move_ids).filtered(
            lambda m: m.state == 'posted' and m.payment_state not in ('paid', 'in_payment'))
        count, errors = 0, []
        for m in moves:
            try:
                wizard = self.env['account.payment.register'].with_context(
                    active_model='account.move', active_ids=m.ids
                ).create({})
                wizard._create_payments()
                count += 1
                self._audit('Bulk mark paid', 'account.move', m.id, m.name, 'Invoice payment created from dashboard')
            except Exception as e:
                errors.append(f"{m.name}: {str(e)[:120]}")
        return {'processed': count, 'errors': errors}

    # ─── Saved Filter Presets ──────────────────────────────────────────────
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

    # ─── Quick Sale (barcode/POS style) ────────────────────────────────────
    @api.model
    def get_product_options(self, search=''):
        """Return Quick Sale product suggestions using server-side search.

        The old implementation loaded a fixed 300-product list into the browser,
        which meant products outside that first page could never be found.
        Searching is now performed against the full active, saleable product
        catalog; only a small result window is returned to keep the UI fast.
        """
        search = (search or '').strip()
        domain = [('sale_ok', '=', True), ('active', '=', True)]
        if search:
            # Require every search token to match at least one of the common
            # product lookup fields. This keeps multi-word searches useful while
            # still allowing product name, internal reference, or barcode lookups.
            for token in search.split():
                domain += [
                    '|', '|',
                    ('name', 'ilike', token),
                    ('default_code', 'ilike', token),
                    ('barcode', 'ilike', token),
                ]
        products = self.env['product.product'].search(
            domain, limit=50, order='name asc, id asc')
        return [{'id': p.id, 'name': p.display_name, 'price': p.list_price,
                 'default_code': p.default_code or '', 'barcode': p.barcode or ''}
                for p in products]

    @api.model
    def get_partner_options(self, search=''):
        """Return partner suggestions for the Quick Sale wizard.

        The Business Dashboard used its already-loaded dashboard rows to populate
        the partner datalist.  The standalone Operations Quick Sale dialog cannot
        depend on the current dashboard date range, so it needs a direct server-
        side partner lookup. Search all active contacts/companies by name,
        reference, phone, or email and return a compact suggestion payload.
        """
        search = (search or '').strip()
        domain = [('active', '=', True)]
        if search:
            for token in search.split():
                domain += [
                    '|', '|', '|',
                    ('name', 'ilike', token),
                    ('ref', 'ilike', token),
                    ('phone', 'ilike', token),
                    ('email', 'ilike', token),
                ]

        partners = self.env['res.partner'].search(
            domain, limit=50, order='name asc, id asc')
        return [{
            'id': partner.id,
            'name': partner.display_name,
            'ref': partner.ref or '',
            'phone': partner.phone or partner.mobile or '',
            'email': partner.email or '',
        } for partner in partners]

    @api.model
    def create_quick_sale(self, partner_id, product_id, qty, price_unit=False):
        partner = self.env['res.partner'].browse(partner_id) if partner_id else self.env.ref('base.public_partner', raise_if_not_found=False)
        product = self.env['product.product'].browse(product_id)
        if not product.exists():
            return {'error': 'Product not found. Please pick a product from the list.'}
        if not qty or float(qty) <= 0:
            return {'error': 'Quantity must be greater than 0.'}

        final_partner_id = partner.id if partner else self.env.user.partner_id.id
        line_vals = {
            'product_id': product.id,
            'product_uom_qty': qty,
            'price_unit': price_unit if price_unit else product.list_price,
        }

        # If this partner already has a draft order, add the product line
        # to it instead of creating a brand-new order. "Walk-in customer"
        # (no partner selected) always creates a fresh order, since draft
        # orders under the generic public partner shouldn't be merged
        # together indiscriminately.
        merged = False
        order = self.env['sale.order']
        if partner_id:
            existing = self.env['sale.order'].search([
                ('partner_id', '=', final_partner_id),
                ('state', '=', 'draft'),
            ], order='create_date desc', limit=1)
            if existing:
                # If the same product is already on the order, bump the qty
                # instead of adding a duplicate line.
                existing_line = existing.order_line.filtered(lambda l: l.product_id.id == product.id)
                if existing_line:
                    existing_line[0].product_uom_qty += qty
                else:
                    existing.write({'order_line': [(0, 0, line_vals)]})
                order = existing
                merged = True

        if not merged:
            order = self.env['sale.order'].create({
                'partner_id': final_partner_id,
                'order_line': [(0, 0, line_vals)],
            })

        self._audit('Quick Sale created', 'sale.order', order.id, order.name, 'Created or updated from Quick Sale wizard')
        return {'id': order.id, 'name': order.name, 'merged': merged}

    # ─── Quick Internal Transfer (Operations Dashboard) ────────────────────
    @api.model
    def get_internal_location_options(self, search=''):
        """Search usable internal locations for the Quick Internal Transfer dialog."""
        search = (search or '').strip()
        company = self.env.company
        domain = [
            ('usage', '=', 'internal'),
            '|', ('company_id', '=', False), ('company_id', '=', company.id),
        ]
        if search:
            for token in search.split():
                domain += ['|', ('name', 'ilike', token), ('complete_name', 'ilike', token)]
        locations = self.env['stock.location'].search(
            domain, limit=60, order='complete_name asc, id asc')
        return [{
            'id': location.id,
            'name': location.display_name,
            'complete_name': location.complete_name or location.name or '',
        } for location in locations]

    @api.model
    def get_internal_transfer_product_options(self, search=''):
        """Find active stockable/consumable products (including non-sale products)."""
        search = (search or '').strip()
        domain = [('active', '=', True), ('type', 'in', ('product', 'consu'))]
        if search:
            for token in search.split():
                domain += [
                    '|', '|',
                    ('name', 'ilike', token),
                    ('default_code', 'ilike', token),
                    ('barcode', 'ilike', token),
                ]
        products = self.env['product.product'].search(
            domain, limit=50, order='name asc, id asc')
        return [{
            'id': product.id,
            'name': product.display_name,
            'default_code': product.default_code or '',
            'barcode': product.barcode or '',
            'uom': product.uom_id.name or '',
        } for product in products]

    @api.model
    def create_quick_internal_transfer(self, source_location_id, dest_location_id, product_id, qty):
        """Create and confirm a one-product internal transfer from the quick action dialog.

        Reservation follows the normal stock workflow; the operation remains a real
        stock.picking record and is completed via Odoo's regular validation process.
        """
        try:
            source_id = int(source_location_id or 0)
            dest_id = int(dest_location_id or 0)
            prod_id = int(product_id or 0)
            quantity = float(qty or 0)
        except (TypeError, ValueError):
            return {'error': 'Select valid locations, a product, and a quantity.'}

        if not source_id or not dest_id or not prod_id:
            return {'error': 'Source location, destination location, and product are required.'}
        if source_id == dest_id:
            return {'error': 'Source and destination locations must be different.'}
        if not math.isfinite(quantity) or quantity <= 0:
            return {'error': 'Quantity must be a finite number greater than zero.'}

        company = self.env.company
        Location = self.env['stock.location']
        source = Location.browse(source_id).exists()
        destination = Location.browse(dest_id).exists()
        product = self.env['product.product'].browse(prod_id).exists()
        if not source or not destination:
            return {'error': 'One of the selected locations no longer exists.'}
        if not product or not product.active or product.type not in ('product', 'consu'):
            return {'error': 'Select an active storable or consumable product.'}
        for location in (source, destination):
            if location.usage != 'internal':
                return {'error': 'Both locations must be internal stock locations.'}
            if location.company_id and location.company_id != company:
                return {'error': 'Both locations must belong to the current company or be shared locations.'}

        PickingType = self.env['stock.picking.type']
        picking_type = PickingType.search([
            ('code', '=', 'internal'), ('company_id', '=', company.id),
        ], order='id asc', limit=1)
        if not picking_type:
            picking_type = PickingType.search([
                ('code', '=', 'internal'), ('company_id', '=', False),
            ], order='id asc', limit=1)
        if not picking_type:
            return {'error': 'No Internal Transfer operation type is configured for the current company.'}

        picking = self.env['stock.picking'].create({
            'picking_type_id': picking_type.id,
            'company_id': company.id,
            'location_id': source.id,
            'location_dest_id': destination.id,
            'scheduled_date': fields.Datetime.now(),
            'move_ids': [(0, 0, {
                'name': product.display_name,
                'product_id': product.id,
                'product_uom': product.uom_id.id,
                'product_uom_qty': quantity,
                'location_id': source.id,
                'location_dest_id': destination.id,
                'company_id': company.id,
            })],
        })
        picking.action_confirm()
        picking.action_assign()
        self._audit(
            'Quick Internal Transfer created', 'stock.picking', picking.id, picking.name,
            f'Created from Operations Dashboard: {product.display_name} × {quantity:g}; '
            f'{source.display_name} → {destination.display_name}')
        return {'id': picking.id, 'name': picking.name, 'state': picking.state}

    # ─── Vendor Scorecard ───────────────────────────────────────────────────
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

    # ═════════════════════════════════════════════════════════════════════
    # "MAKE IT ATTRACTIVE" PACK — presence, theme, comments, snapshot, NL summary
    # ═════════════════════════════════════════════════════════════════════

    # ─── Live presence ("who's online") ────────────────────────────────
    @api.model
    def heartbeat(self):
        now = fields.Datetime.now()
        rec = self.env['dashboard.presence'].sudo().search([('user_id', '=', self.env.uid)], limit=1)
        if rec:
            rec.write({'last_seen': now})
        else:
            self.env['dashboard.presence'].sudo().create({'user_id': self.env.uid, 'last_seen': now})
        return True

    @api.model
    def get_online_users(self):
        cutoff = fields.Datetime.now() - timedelta(minutes=2)
        recs = self.env['dashboard.presence'].sudo().search([('last_seen', '>=', cutoff)])
        return [{'id': r.user_id.id, 'name': r.user_id.name} for r in recs if r.user_id]

    # ─── Per-user dashboard preferences / customization ────────────────────
    def _user_pref_key(self):
        return f"eagle_dashboard.user_preferences.{self.env.uid}"

    @api.model
    def get_user_preferences(self):
        defaults = {
            "density": "comfortable",
            "hidden_sections": [],
            "collapse_on_load": True,
            "show_hints": True,
            "keyboard_shortcuts": True,
            "refresh_mins": 5,
            "auto_refresh": False,
            "dark_mode": False,
            "accent_color": self.env["ir.config_parameter"].sudo().get_param("eagle_dashboard.theme_color", "#4f5bd5"),
            "workspace": "all",
        }
        raw = self.env["ir.config_parameter"].sudo().get_param(self._user_pref_key(), "")
        try:
            stored = json.loads(raw) if raw else {}
        except Exception:
            stored = {}
        if not isinstance(stored, dict):
            stored = {}
        defaults.update(stored)
        # Sanitize user-controlled values so malformed config cannot break the UI.
        if defaults.get("density") not in ("comfortable", "compact"):
            defaults["density"] = "comfortable"
        if not isinstance(defaults.get("hidden_sections"), list):
            defaults["hidden_sections"] = []
        defaults["hidden_sections"] = [str(x) for x in defaults["hidden_sections"]][:100]
        try:
            defaults["refresh_mins"] = max(1, min(120, int(defaults.get("refresh_mins", 5))))
        except Exception:
            defaults["refresh_mins"] = 5
        for key in ("collapse_on_load", "show_hints", "keyboard_shortcuts", "auto_refresh", "dark_mode"):
            defaults[key] = bool(defaults.get(key))
        color = defaults.get("accent_color") or "#4f5bd5"
        if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            color = "#4f5bd5"
        defaults["accent_color"] = color
        return defaults

    @api.model
    def save_user_preferences(self, preferences):
        preferences = preferences if isinstance(preferences, dict) else {}
        allowed = {
            "density", "hidden_sections", "collapse_on_load", "show_hints",
            "keyboard_shortcuts", "refresh_mins", "auto_refresh", "dark_mode",
            "accent_color", "workspace",
        }
        clean = {k: preferences[k] for k in allowed if k in preferences}
        if clean.get("workspace") not in (None, "all", "executive", "finance", "sales", "operations", "minimal"):
            clean["workspace"] = "all"
        if clean.get("density") not in (None, "comfortable", "compact"):
            clean["density"] = "comfortable"
        if "hidden_sections" in clean:
            hs = clean["hidden_sections"] if isinstance(clean["hidden_sections"], list) else []
            clean["hidden_sections"] = [str(x) for x in hs][:100]
        if "refresh_mins" in clean:
            try:
                clean["refresh_mins"] = max(1, min(120, int(clean["refresh_mins"])))
            except Exception:
                clean["refresh_mins"] = 5
        for key in ("collapse_on_load", "show_hints", "keyboard_shortcuts", "auto_refresh", "dark_mode"):
            if key in clean:
                clean[key] = bool(clean[key])
        if "accent_color" in clean:
            color = clean["accent_color"]
            if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                clean["accent_color"] = "#4f5bd5"
        self.env["ir.config_parameter"].sudo().set_param(self._user_pref_key(), json.dumps(clean))
        return self.get_user_preferences()

    @api.model
    def reset_user_preferences(self):
        self.env["ir.config_parameter"].sudo().set_param(self._user_pref_key(), "")
        return self.get_user_preferences()

    @api.model
    def get_dashboard_health(self):
        """Return a lightweight self-diagnostic for administrators/managers.

        The check is intentionally read-only and tolerant of customized Odoo
        databases. It reports capabilities/configuration, not a fake "pass"
        against the live application runtime.
        """
        can_view = bool(self.env.user.has_group("eagle_business_dashboard.group_dashboard_admin") or
                        self.env.user.has_group("base.group_system") or
                        self.env.user.has_group("eagle_business_dashboard.group_dashboard_manager"))
        if not can_view:
            return {"allowed": False, "checks": []}

        checks = []
        required_models = {
            "sale.order": "Sales", "purchase.order": "Purchases",
            "account.move": "Accounting", "account.payment": "Payments",
            "stock.picking": "Inventory",
        }
        for model, label in required_models.items():
            ok = model in self.env.registry.models
            checks.append({"key": f"model_{model}", "label": f"{label} model", "status": "ok" if ok else "warning",
                           "detail": "Available" if ok else "Model is not available in this Odoo database."})

        index_names = [
            "sale_order_company_state_date_idx",
            "account_payment_company_journal_date_state_idx",
            "account_move_company_type_state_date_idx",
            "account_move_company_due_idx",
        ]
        existing = set()
        try:
            self.env.cr.execute("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY(%s)", (index_names,))
            existing = {r[0] for r in self.env.cr.fetchall()}
        except Exception:
            pass
        for name in index_names:
            checks.append({"key": f"idx_{name}", "label": name, "status": "ok" if name in existing else "warning",
                           "detail": "Present" if name in existing else "Optional performance index is not present yet."})

        cron = self.env.ref("eagle_business_dashboard.cron_daily_digest", raise_if_not_found=False)
        checks.append({"key": "daily_digest", "label": "Daily digest", "status": "ok" if cron else "warning",
                       "detail": "Scheduled action found" if cron else "Scheduled action not found."})
        checks.append({"key": "ledger_rules", "label": "Ledger security rules", "status": "ok",
                       "detail": f"{self.env['dashboard.ledger.security'].search_count([])} journal rule(s) configured."})
        return {"allowed": True, "checks": checks, "generated_at": fields.Datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

    # ─── Theme color ─────────────────────────────────────────────────────
    @api.model
    def get_theme_color(self):
        return self.env['ir.config_parameter'].sudo().get_param('eagle_dashboard.theme_color', '#4f5bd5')

    @api.model
    def save_theme_color(self, color):
        self.env['ir.config_parameter'].sudo().set_param('eagle_dashboard.theme_color', color or '#4f5bd5')
        return True

    # ─── Comments on KPI cards ───────────────────────────────────────────
    @api.model
    def get_kpi_comments(self, kpi_key):
        comments = self.env['dashboard.kpi.comment'].search([('kpi_key', '=', kpi_key)], limit=30)
        return [{'id': c.id, 'text': c.text, 'author': c.user_id.name or '',
                 'date': c.create_date.strftime('%d/%m %H:%M') if c.create_date else ''} for c in comments]

    @api.model
    def add_kpi_comment(self, kpi_key, text):
        if not text or not text.strip():
            return False
        self.env['dashboard.kpi.comment'].create({'kpi_key': kpi_key, 'text': text.strip()[:500]})
        return True

    # ─── Shareable snapshot link ─────────────────────────────────────────
    @api.model
    def create_snapshot_link(self, snapshot_dict, hours=48):
        link = self.env['dashboard.snapshot.link'].create({
            'expires_at': fields.Datetime.now() + timedelta(hours=int(hours)),
            'snapshot_data': json.dumps(snapshot_dict or {}),
        })
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '')
        return {'url': f'{base_url}/dashboard/snapshot/{link.token}', 'token': link.token}

    # ─── Natural-language summary ──────────────────────────────────────
    @api.model
    def get_nl_summary(self):
        widgets = self.get_business_widgets()
        fin = self.get_finance_widgets()
        parts = []
        if widgets['month_sales'] > 0:
            parts.append(f"Sales this month total BDT {widgets['month_sales']:.0f}")
        if fin.get('overdue_inv_count'):
            parts.append(f"{fin['overdue_inv_count']} invoice(s) are overdue (BDT {fin['overdue_inv_amount']:.0f})")
        if widgets.get('low_stock'):
            parts.append(f"{len(widgets['low_stock'])} product(s) are running low on stock")
        if fin.get('cash_balance_masked'):
            parts.append("some cash balances are protected by ledger visibility settings")
        elif (fin.get('current_cash') or 0) < 0:
            parts.append("cash balance is currently negative — review outstanding payments")
        if not parts:
            return "Everything looks steady today — no urgent items to flag."
        return ". ".join(parts) + "."

    # ─── Best / worst sales day ─────────────────────────────────────────
    @api.model
    def get_best_worst_day(self, from_date=False, to_date=False):
        today = fields.Date.today()
        fd = from_date or str(today.replace(day=1))
        td = to_date or str(today)
        self.env.cr.execute("""
            SELECT DATE(date_order) as d, COALESCE(SUM(amount_total),0) as total
            FROM sale_order
            WHERE state IN ('sale','done') AND DATE(date_order) >= %s AND DATE(date_order) <= %s
            GROUP BY d ORDER BY total DESC
        """, (fd, td))
        rows = self.env.cr.fetchall()
        if not rows:
            return {'best': None, 'worst': None}
        best = {'date': str(rows[0][0]), 'amount': round(float(rows[0][1]), 2)}
        worst = {'date': str(rows[-1][0]), 'amount': round(float(rows[-1][1]), 2)}
        return {'best': best, 'worst': worst}

    # ─── Product bundling suggestions ───────────────────────────────────
    @api.model
    def get_product_bundles(self):
        # Odoo 18 stores translated product names as JSONB. Selecting the
        # name column directly can therefore return a dict to Python, which
        # Owl renders as "[object Object]". Aggregate by product IDs first,
        # then resolve display_name through the ORM so the active language is
        # handled correctly.
        self.env.cr.execute("""
            SELECT l1.product_id, l2.product_id, COUNT(DISTINCT l1.order_id) AS cnt
            FROM sale_order_line l1
            JOIN sale_order_line l2
              ON l1.order_id = l2.order_id
             AND l1.product_id < l2.product_id
            JOIN sale_order so ON so.id = l1.order_id
            WHERE so.state IN ('sale', 'done')
              AND l1.product_id IS NOT NULL
              AND l2.product_id IS NOT NULL
            GROUP BY l1.product_id, l2.product_id
            HAVING COUNT(DISTINCT l1.order_id) > 1
            ORDER BY cnt DESC
            LIMIT 5
        """)
        rows = self.env.cr.fetchall()
        if not rows:
            return []

        product_ids = {pid for row in rows for pid in row[:2]}
        products = self.env['product.product'].browse(list(product_ids)).exists()
        names = {product.id: product.display_name for product in products}
        return [
            {
                'a': names.get(product_a, 'Unknown product'),
                'b': names.get(product_b, 'Unknown product'),
                'count': int(count),
            }
            for product_a, product_b, count in rows
            if product_a in names and product_b in names
        ]

    # ─── Goal streaks ────────────────────────────────────────────────────
    @api.model
    def get_streak(self):
        target = float(self.env['ir.config_parameter'].sudo().get_param('eagle_dashboard.sales_target', '0') or '0')
        if target <= 0:
            return {'streak': 0, 'daily_target': 0}
        daily_target = target / 30.0
        today = fields.Date.today()
        streak = 0
        for i in range(60):
            d = today - timedelta(days=i)
            self.env.cr.execute("""
                SELECT COALESCE(SUM(amount_total),0) FROM sale_order
                WHERE state IN ('sale','done') AND DATE(date_order) = %s
            """, (str(d),))
            day_total = float(self.env.cr.fetchone()[0] or 0)
            if day_total >= daily_target:
                streak += 1
            else:
                if i == 0:
                    continue
                break
        return {'streak': streak, 'daily_target': round(daily_target, 2)}
