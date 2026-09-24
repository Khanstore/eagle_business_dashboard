/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { onMounted, onPatched, onWillUnmount } from "@odoo/owl";
import { FormRenderer } from "@web/views/form/form_renderer";

/**
 * Lightly tint the standard Odoo Payment form according to payment direction.
 *
 * The accounting/payment workflow itself is unchanged. This is presentation only:
 * outbound/send payments use a light red background and inbound/receive payments
 * use a light green background. The class is recomputed after every render so the
 * color follows the selected Payment Type on both new and existing payments.
 */
patch(FormRenderer.prototype, {
    setup() {
        super.setup();
        this._eaglePaymentType = null;
        this._eagleApplyPaymentTheme = () => {
            const record = this.props?.record;
            const isPayment = record?.resModel === "account.payment";
            const paymentType = isPayment ? record?.data?.payment_type : null;
            const root = this.el;
            if (!root) {
                return;
            }

            const isSend = paymentType === "outbound";
            const isReceive = paymentType === "inbound";
            this._eaglePaymentType = isPayment && (isSend || isReceive) ? paymentType : null;

            root.classList.toggle("eagle-payment-send-form", isSend);
            root.classList.toggle("eagle-payment-receive-form", isReceive);
        };

        onMounted(() => this._eagleApplyPaymentTheme());
        onPatched(() => this._eagleApplyPaymentTheme());
        onWillUnmount(() => {
            if (this.el) {
                this.el.classList.remove("eagle-payment-send-form", "eagle-payment-receive-form");
            }
        });
    },
});
