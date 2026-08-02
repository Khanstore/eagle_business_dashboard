/** @odoo-module **/

/**
 * Shared filter state for Business Dashboard ↔ Finance Dashboard.
 * A plain singleton object (no OWL reactivity needed here — each
 * dashboard reads from it on mount and writes to it on every change).
 */

const _now = new Date();
const _fmt = (d) => d.toISOString().split('T')[0];
const _todayStr = _fmt(_now);

export const sharedFilterState = {
    from_date:      _todayStr,
    to_date:        _todayStr,
    active_preset:  'today',
    selected_month: `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`,
    selected_year:  String(_now.getFullYear()),
    partner_filter: '',
    partner_id_filter: '',
};
