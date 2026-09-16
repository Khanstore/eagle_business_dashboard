import json
from datetime import datetime
from odoo import http
from odoo.http import request


class DashboardSnapshotController(http.Controller):

    @http.route('/dashboard/snapshot/<string:token>', type='http', auth='public', website=False)
    def view_snapshot(self, token, **kwargs):
        link = request.env['dashboard.snapshot.link'].sudo().search([('token', '=', token)], limit=1)
        if not link or link.expires_at < datetime.now():
            return request.render('eagle_business_dashboard.snapshot_expired')
        try:
            data = json.loads(link.snapshot_data or '{}')
        except Exception:
            data = {}
        return request.render('eagle_business_dashboard.snapshot_view', {
            'data': data,
            'created_by': link.created_by.name or 'Someone',
            'expires_at': link.expires_at,
        })
