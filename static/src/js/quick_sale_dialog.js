/** @odoo-module **/

/*
 * Standalone Quick Sale dialog.
 *
 * The dialog is deliberately kept outside the dashboard Owl tree. All field
 * state, searching, dropdown rendering, and submission are handled here so
 * typing in a field cannot trigger a full dashboard render.
 */
export class EagleQuickSaleDialog {
    constructor({ orm, formatAmount, onCreated = null }) {
        this.orm = orm;
        this.formatAmount = formatAmount || ((v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n.toFixed(2) : "0.00";
        });
        this.onCreated = onCreated;

        this.root = null;
        this.partnerInput = null;
        this.partnerDropdown = null;
        this.partnerStatus = null;
        this.productInput = null;
        this.productDropdown = null;
        this.productStatus = null;
        this.qtyInput = null;
        this.createButton = null;
        this.errorBox = null;

        this.partnerTimer = null;
        this.productTimer = null;
        this.partnerSeq = 0;
        this.productSeq = 0;
        this.partnerId = 0;
        this.productId = 0;
        this.submitBusy = false;
        this.keydownHandler = null;
        this.partnerCache = new Map();
        this.productCache = new Map();
    }

    open() {
        this.close();
        this.partnerId = 0;
        this.productId = 0;
        this.submitBusy = false;
        this._build();
        this._loadPartners("");
        this.partnerInput.focus();
    }

    close() {
        this.partnerSeq += 1;
        this.productSeq += 1;
        if (this.partnerTimer) {
            clearTimeout(this.partnerTimer);
            this.partnerTimer = null;
        }
        if (this.productTimer) {
            clearTimeout(this.productTimer);
            this.productTimer = null;
        }
        if (this.keydownHandler) {
            document.removeEventListener("keydown", this.keydownHandler);
            this.keydownHandler = null;
        }
        if (this.root?.parentNode) {
            this.root.parentNode.removeChild(this.root);
        }
        this.root = null;
        this.partnerInput = null;
        this.partnerDropdown = null;
        this.productInput = null;
        this.productDropdown = null;
        this.qtyInput = null;
        this.createButton = null;
        this.errorBox = null;
    }

    _build() {
        const backdrop = document.createElement("div");
        backdrop.className = "eagle-modal-backdrop eagle-quick-sale-backdrop";
        backdrop.style.zIndex = "10050";
        backdrop.innerHTML = `
            <div class="eagle-modal eagle-target-modal eagle-quick-sale-modal" role="dialog" aria-modal="true" aria-label="Quick Sale">
                <div class="eagle-modal-header">
                    <h5 class="eagle-modal-title"><i class="fa fa-bolt me-2"></i>Quick Sale</h5>
                    <button type="button" class="ebtn ebtn-ghost ebtn-icon qs-close" aria-label="Close"><i class="fa fa-times"></i></button>
                </div>
                <div class="eagle-modal-body">
                    <div class="eagle-card-inner">
                        <div class="qs-error eagle-alert eagle-alert-danger mb-3" style="display:none"></div>

                        <label class="form-label small text-muted" for="eagle-qs-partner">Partner (optional)</label>
                        <div class="position-relative mb-3">
                            <input id="eagle-qs-partner" type="text" class="form-control form-control-sm qs-partner"
                                   autocomplete="off" spellcheck="false" placeholder="Type to search partner...">
                            <div class="qs-partner-status text-muted small mt-1">Loading recent partners…</div>
                            <div class="qs-partner-list eagle-quick-search-dropdown" style="display:none"></div>
                        </div>

                        <label class="form-label small text-muted" for="eagle-qs-product">Product <span class="text-danger">*</span></label>
                        <div class="position-relative mb-3">
                            <input id="eagle-qs-product" type="text" class="form-control form-control-sm qs-product"
                                   autocomplete="off" spellcheck="false"
                                   placeholder="Type product name, internal reference, or barcode...">
                            <div class="qs-product-status text-muted small mt-1">Type at least 2 characters to search.</div>
                            <div class="qs-product-list eagle-quick-search-dropdown" style="display:none"></div>
                        </div>

                        <label class="form-label small text-muted" for="eagle-qs-qty">Quantity</label>
                        <input id="eagle-qs-qty" type="number" class="form-control form-control-sm qs-qty" min="0.01" step="0.01" value="1">

                        <p class="text-muted small mt-3 mb-2">
                            <i class="fa fa-info-circle me-1"></i>
                            The selected product is added to the selected partner's newest draft order when one exists;
                            otherwise a new draft order is created. The order opens for review before confirmation.
                        </p>
                        <div class="qs-body-actions" aria-label="Quick Sale actions"
                             style="display:flex!important;flex-direction:row!important;justify-content:flex-end!important;align-items:center!important;gap:12px!important;margin-top:16px!important;padding-top:14px!important;border-top:1px solid rgba(148,163,184,.28)!important;width:100%!important;">
                            <button type="button" class="eagle-qs-action eagle-qs-cancel"
                                    style="display:inline-flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;position:relative!important;z-index:1000!important;min-width:100px!important;height:42px!important;background:#ffffff!important;color:#374151!important;border:1.5px solid #cbd5e1!important;border-radius:8px!important;align-items:center!important;justify-content:center!important;">Cancel</button>
                            <button type="button" class="eagle-qs-action eagle-qs-create"
                                    style="display:inline-flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;position:relative!important;z-index:1001!important;min-width:190px!important;height:42px!important;background:#4f46e5!important;color:#ffffff!important;border:1.5px solid #4f46e5!important;border-radius:8px!important;align-items:center!important;justify-content:center!important;">
                                <i class="fa fa-check me-1"></i><span class="qs-create-label">Create Order</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(backdrop);
        this.root = backdrop;
        this.partnerInput = backdrop.querySelector(".qs-partner");
        this.partnerDropdown = backdrop.querySelector(".qs-partner-list");
        this.partnerStatus = backdrop.querySelector(".qs-partner-status");
        this.productInput = backdrop.querySelector(".qs-product");
        this.productDropdown = backdrop.querySelector(".qs-product-list");
        this.productStatus = backdrop.querySelector(".qs-product-status");
        this.qtyInput = backdrop.querySelector(".qs-qty");
        const actionRow = backdrop.querySelector(".qs-body-actions");
        const cancelButton = backdrop.querySelector(".eagle-qs-cancel");
        this.createButton = backdrop.querySelector(".eagle-qs-create");
        this.errorBox = backdrop.querySelector(".qs-error");

        if (!actionRow || !cancelButton || !this.createButton) {
            console.error("Quick Sale: required action controls are missing from the dialog.");
            this._showError("Quick Sale could not initialize its action buttons. Please reopen the wizard.");
        }
        cancelButton?.addEventListener("click", () => this.close());
        this.createButton?.addEventListener("click", () => this._submit());

        backdrop.querySelector(".qs-close").addEventListener("click", () => this.close());
        this.partnerInput.addEventListener("input", (ev) => this._onPartnerInput(ev));
        this.partnerInput.addEventListener("focus", () => {
            if (this.partnerDropdown.style.display !== "block") {
                this._loadPartners(this.partnerInput.value || "");
            }
        });
        this.partnerInput.addEventListener("keydown", (ev) => this._onDropdownKeydown(ev, this.partnerDropdown, () => this._selectVisiblePartner()));
        this.productInput.addEventListener("input", (ev) => this._onProductInput(ev));
        this.productInput.addEventListener("keydown", (ev) => this._onDropdownKeydown(ev, this.productDropdown, () => this._selectVisibleProduct()));
        this.qtyInput.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                this._submit();
            }
        });
        backdrop.addEventListener("mousedown", (ev) => {
            if (ev.target === backdrop) this.close();
        });

        this.keydownHandler = (ev) => {
            if (ev.key === "Escape") this.close();
        };
        document.addEventListener("keydown", this.keydownHandler);

        // Make the action controls unambiguously visible.
        for (const button of [cancelButton, this.createButton]) {
            button.style.display = "inline-flex";
            button.style.visibility = "visible";
            button.style.opacity = "1";
            button.style.pointerEvents = "auto";
            button.style.position = "relative";
            button.style.zIndex = "1";
        }
    }

    _setStatus(el, message, loading = false) {
        if (!el) return;
        el.innerHTML = loading
            ? `<i class="fa fa-spinner fa-spin me-1"></i>${message || "Searching…"}`
            : `<i class="fa fa-info-circle me-1"></i>${message || ""}`;
    }

    _showError(message) {
        if (!this.errorBox) return;
        this.errorBox.textContent = message || "";
        this.errorBox.style.display = message ? "block" : "none";
    }

    _clearError() {
        this._showError("");
    }

    _onPartnerInput(ev) {
        this.partnerId = 0;
        const q = String(ev.target.value || "").trim();
        this._hideDropdown(this.partnerDropdown);
        this._clearError();
        this.partnerSeq += 1;
        const seq = this.partnerSeq;
        if (this.partnerTimer) clearTimeout(this.partnerTimer);
        this._setStatus(this.partnerStatus, q.length >= 2 ? "Searching partners…" : "Loading partners…", true);
        this.partnerTimer = setTimeout(() => {
            this.partnerTimer = null;
            this._loadPartners(q, seq);
        }, q.length >= 2 ? 300 : 0);
    }

    async _loadPartners(query, seq = ++this.partnerSeq) {
        if (!this.root || seq !== this.partnerSeq) return;
        const key = String(query || "").trim().toLowerCase();
        const cached = this.partnerCache.get(key);
        if (cached) {
            this._showPartners(cached);
            return;
        }
        try {
            const rows = await this.orm.call("dashboard.data", "get_partner_options", [query || ""]);
            if (!this.root || seq !== this.partnerSeq) return;
            const partners = Array.isArray(rows) ? rows : [];
            this.partnerCache.set(key, partners);
            if (this.partnerCache.size > 30) {
                this.partnerCache.delete(this.partnerCache.keys().next().value);
            }
            this._showPartners(partners);
        } catch (error) {
            if (!this.root || seq !== this.partnerSeq) return;
            console.error("Quick Sale partner search failed:", error);
            this._setStatus(this.partnerStatus, "Partner search failed. You can leave it blank or try again.");
            this._hideDropdown(this.partnerDropdown);
        }
    }

    _showPartners(rows) {
        if (!this.partnerDropdown) return;
        this.partnerDropdown.innerHTML = "";
        const items = [{ id: 0, name: "— Walk-in customer —", ref: "" }].concat(rows || []).slice(0, 25);
        if (!items.length) {
            this._setStatus(this.partnerStatus, "No matching partners.");
            this._hideDropdown(this.partnerDropdown);
            return;
        }
        this._setStatus(this.partnerStatus, `${Math.max(items.length - 1, 0)} matching partner(s). Click to select.`);
        for (const partner of items) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "eagle-quick-search-option";
            const title = document.createElement("span");
            title.className = "fw-semibold d-block";
            title.textContent = partner.name || "";
            const meta = document.createElement("span");
            meta.className = "text-muted small d-block";
            const metaParts = [];
            if (partner.ref) metaParts.push(`Ref: ${partner.ref}`);
            if (partner.phone) metaParts.push(partner.phone);
            if (partner.email) metaParts.push(partner.email);
            if (partner.id) metaParts.push(`#${partner.id}`);
            meta.textContent = metaParts.join(" · ");
            button.appendChild(title);
            button.appendChild(meta);
            button.addEventListener("click", () => this._selectPartner(partner));
            this.partnerDropdown.appendChild(button);
        }
        this.partnerDropdown.style.display = "block";
    }

    _selectPartner(partner) {
        this.partnerId = Number(partner?.id) || 0;
        this.partnerInput.value = partner?.name || "";
        this._hideDropdown(this.partnerDropdown);
        this._clearError();
        this.productInput.focus();
    }

    _onProductInput(ev) {
        const q = String(ev.target.value || "").trim();
        this.productId = 0;
        this.productSeq += 1;
        const seq = this.productSeq;
        if (this.productTimer) clearTimeout(this.productTimer);
        this._hideDropdown(this.productDropdown);
        this._clearError();

        if (q.length < 2) {
            this._setStatus(this.productStatus, "Type at least 2 characters to search.");
            return;
        }
        const key = q.toLowerCase();
        const cached = this.productCache.get(key);
        if (cached) {
            this._showProducts(cached);
            return;
        }
        this._setStatus(this.productStatus, "Searching products…", true);
        this.productTimer = setTimeout(() => {
            this.productTimer = null;
            this._loadProducts(q, seq);
        }, 300);
    }

    async _loadProducts(query, seq) {
        if (!this.root || seq !== this.productSeq) return;
        try {
            const rows = await this.orm.call("dashboard.data", "get_product_options", [query]);
            if (!this.root || seq !== this.productSeq) return;
            const products = Array.isArray(rows) ? rows : [];
            this.productCache.set(String(query || "").toLowerCase(), products);
            if (this.productCache.size > 40) {
                this.productCache.delete(this.productCache.keys().next().value);
            }
            this._showProducts(products);
        } catch (error) {
            if (!this.root || seq !== this.productSeq) return;
            console.error("Quick Sale product search failed:", error);
            this._setStatus(this.productStatus, "Product search failed. Try again.");
            this._showError("Could not search products. Please try again.");
        }
    }

    _showProducts(products) {
        if (!this.productDropdown) return;
        this.productDropdown.innerHTML = "";
        if (!products.length) {
            this._setStatus(this.productStatus, "No matching products found.");
            this._hideDropdown(this.productDropdown);
            return;
        }
        this._setStatus(this.productStatus, `${products.length} product(s) found. Click a product to select it.`);
        products.slice(0, 30).forEach((product) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "eagle-quick-search-option";
            const title = document.createElement("span");
            title.className = "fw-semibold d-block";
            title.textContent = product.name || "";
            const meta = document.createElement("span");
            meta.className = "text-muted small d-block";
            const bits = [];
            if (product.default_code) bits.push(`[${product.default_code}]`);
            if (product.barcode) bits.push(`barcode: ${product.barcode}`);
            bits.push(`BDT ${this.formatAmount(product.price)}`);
            bits.push(`#${product.id}`);
            meta.textContent = bits.join(" · ");
            button.appendChild(title);
            button.appendChild(meta);
            button.addEventListener("click", () => this._selectProduct(product));
            this.productDropdown.appendChild(button);
        });
        this.productDropdown.style.display = "block";
    }

    _selectProduct(product) {
        this.productId = Number(product?.id) || 0;
        if (!this.productId) return;
        const code = product.default_code ? ` [${product.default_code}]` : "";
        this.productInput.value = `${product.name || ""}${code} — BDT ${this.formatAmount(product.price)} [#${product.id}]`;
        this._hideDropdown(this.productDropdown);
        this._setStatus(this.productStatus, "Product selected.");
        this._clearError();
        this.qtyInput.focus();
        this.qtyInput.select();
        this._updateCreateButton();
    }

    _updateCreateButton() {
        if (!this.createButton) return;
        const span = this.createButton.querySelector(".qs-create-label");
        if (span) span.textContent = this.partnerId ? "Add to Order / Create" : "Create Order";
        this.createButton.style.display = "inline-flex";
        this.createButton.style.visibility = "visible";
        this.createButton.style.opacity = "1";
    }

    _hideDropdown(dropdown) {
        if (dropdown) dropdown.style.display = "none";
    }

    _onDropdownKeydown(ev, dropdown, selectFn) {
        if (ev.key === "Escape") {
            this._hideDropdown(dropdown);
            return;
        }
        const buttons = Array.from(dropdown?.querySelectorAll("button") || []);
        if (!buttons.length) return;
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
            ev.preventDefault();
            const current = buttons.findIndex((b) => b.classList.contains("is-active"));
            let next = ev.key === "ArrowDown" ? current + 1 : current - 1;
            if (current < 0) next = ev.key === "ArrowDown" ? 0 : buttons.length - 1;
            if (next < 0) next = buttons.length - 1;
            if (next >= buttons.length) next = 0;
            buttons.forEach((b) => b.classList.remove("is-active"));
            buttons[next].classList.add("is-active");
            buttons[next].scrollIntoView({ block: "nearest" });
        } else if (ev.key === "Enter") {
            const active = dropdown.querySelector("button.is-active");
            if (active) {
                ev.preventDefault();
                active.click();
            } else if (selectFn) {
                selectFn();
            }
        }
    }

    _selectVisiblePartner() {
        const active = this.partnerDropdown?.querySelector("button.is-active");
        if (active) active.click();
    }

    _selectVisibleProduct() {
        const active = this.productDropdown?.querySelector("button.is-active");
        if (active) active.click();
    }

    async _submit() {
        if (this.submitBusy) return;
        this._clearError();
        const qty = parseFloat(this.qtyInput?.value || "0");
        if (!this.productId) {
            this._showError("Please select a product from the search results.");
            this.productInput.focus();
            return;
        }
        if (!Number.isFinite(qty) || qty <= 0) {
            this._showError("Quantity must be greater than 0.");
            this.qtyInput.focus();
            return;
        }

        this.submitBusy = true;
        const original = this.createButton.innerHTML;
        this.createButton.disabled = true;
        this.createButton.innerHTML = '<i class="fa fa-spinner fa-spin me-1"></i><span>Working…</span>';
        try {
            const result = await this.orm.call("dashboard.data", "create_quick_sale", [
                this.partnerId || false,
                this.productId,
                qty,
                false,
            ]);
            if (result?.error) {
                this._showError(result.error);
                return;
            }
            if (!result?.id) {
                this._showError("The order could not be created. Please try again.");
                return;
            }
            const callback = this.onCreated;
            this.close();
            if (callback) await callback(result);
        } catch (error) {
            console.error("Quick Sale create failed:", error);
            this._showError("Server error while creating the order.");
        } finally {
            this.submitBusy = false;
            if (this.createButton) {
                this.createButton.disabled = false;
                this.createButton.innerHTML = original;
                this._updateCreateButton();
            }
        }
    }
}
