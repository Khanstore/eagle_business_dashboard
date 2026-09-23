/** @odoo-module **/

const SEND = "outbound";
const RECEIVE = "inbound";

function findCheckedPaymentType() {
    return document.querySelector(
        '.o_form_view input[type="radio"][name="payment_type"]:checked,' +
        '.o_form_view input[type="radio"][value="outbound"]:checked,' +
        '.o_form_view input[type="radio"][value="inbound"]:checked'
    );
}

function applyPaymentFallback() {
    const body = document.body;
    if (!body) return;
    body.classList.remove("eagle-payment-send-active", "eagle-payment-receive-active");
    const checked = findCheckedPaymentType();
    if (!checked || (checked.value !== SEND && checked.value !== RECEIVE)) return;
    const root = checked.closest?.(".o_form_view");
    if (!root) return;
    root.classList.add("eagle-payment-form");
    const isSend = checked.value === SEND;
    body.classList.toggle("eagle-payment-send-active", isSend);
    body.classList.toggle("eagle-payment-receive-active", !isSend);
}

function schedulePaymentFallback() {
    window.requestAnimationFrame(applyPaymentFallback);
}

if (!window.__eaglePaymentThemeV33Installed) {
    window.__eaglePaymentThemeV33Installed = true;
    document.addEventListener("change", (ev) => {
        if (ev.target?.matches?.(
            'input[type="radio"][name="payment_type"],' +
            'input[type="radio"][value="outbound"],' +
            'input[type="radio"][value="inbound"]'
        )) schedulePaymentFallback();
    }, true);
    document.addEventListener("DOMContentLoaded", schedulePaymentFallback, { once: true });
    const observer = new MutationObserver(schedulePaymentFallback);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    schedulePaymentFallback();
}
