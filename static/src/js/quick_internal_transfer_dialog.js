/** @odoo-module **/

/*
 * Standalone Quick Internal Transfer dialog. It stays outside the Operations
 * Owl tree so typing/searching does not re-render dashboard tables.
 */
export class EagleQuickInternalTransferDialog {
    constructor({ orm, onCreated = null }) {
        this.orm = orm;
        this.onCreated = onCreated;
        this.root = null;
        this.createButton = null;
        this.errorBox = null;
        this.qtyInput = null;
        this.submitBusy = false;
        this.keydownHandler = null;
        this.ids = { source: 0, destination: 0, product: 0 };
        this.seq = { source: 0, destination: 0, product: 0 };
        this.timers = { source: null, destination: null, product: null };
        this.cache = new Map();
        this.controls = {};
    }

    open() {
        this.close();
        this.ids = { source: 0, destination: 0, product: 0 };
        this.submitBusy = false;
        this._build();
        // Keep all suggestion lists closed when the dialog opens. Source gets
        // focus for keyboard convenience, but options load only after the user
        // clicks a field or starts typing in it.
        this.controls.source.input.focus();
    }

    close() {
        for (const role of ["source", "destination", "product"]) {
            this.seq[role] += 1;
            if (this.timers[role]) {
                clearTimeout(this.timers[role]);
                this.timers[role] = null;
            }
        }
        if (this.keydownHandler) {
            document.removeEventListener("keydown", this.keydownHandler);
            this.keydownHandler = null;
        }
        if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
        this.root = null;
        this.createButton = null;
        this.errorBox = null;
        this.qtyInput = null;
        this.controls = {};
    }

    _build() {
        const backdrop = document.createElement("div");
        backdrop.className = "eagle-modal-backdrop eagle-quick-transfer-backdrop";
        backdrop.style.zIndex = "10060";
        backdrop.innerHTML = `
            <div class="eagle-modal eagle-target-modal eagle-quick-transfer-modal" role="dialog" aria-modal="true" aria-label="Quick Internal Transfer">
                <div class="eagle-modal-header">
                    <h5 class="eagle-modal-title"><i class="fa fa-random me-2"></i>Quick Internal Transfer</h5>
                    <button type="button" class="ebtn ebtn-ghost ebtn-icon qt-close" aria-label="Close"><i class="fa fa-times"></i></button>
                </div>
                <div class="eagle-modal-body">
                    <div class="eagle-card-inner eagle-quick-transfer-inner">
                        <div class="qt-error eagle-alert eagle-alert-danger mb-3" style="display:none"></div>
                        <div class="qt-field">
                            <label class="form-label small text-muted" for="eagle-qt-source">Source Location <span class="text-danger">*</span></label>
                            <div class="position-relative">
                                <input id="eagle-qt-source" type="text" class="form-control form-control-sm qt-source" autocomplete="off" placeholder="Search source location...">
                                <div class="qt-source-status text-muted small mt-1">Click or type to search locations.</div>
                                <div class="qt-source-list eagle-quick-search-dropdown qt-dropdown" style="display:none"></div>
                            </div>
                        </div>
                        <div class="qt-field">
                            <label class="form-label small text-muted" for="eagle-qt-destination">Destination Location <span class="text-danger">*</span></label>
                            <div class="position-relative">
                                <input id="eagle-qt-destination" type="text" class="form-control form-control-sm qt-destination" autocomplete="off" placeholder="Search destination location...">
                                <div class="qt-destination-status text-muted small mt-1">Click or type to search locations.</div>
                                <div class="qt-destination-list eagle-quick-search-dropdown qt-dropdown" style="display:none"></div>
                            </div>
                        </div>
                        <div class="qt-field">
                            <label class="form-label small text-muted" for="eagle-qt-product">Product <span class="text-danger">*</span></label>
                            <div class="position-relative">
                                <input id="eagle-qt-product" type="text" class="form-control form-control-sm qt-product" autocomplete="off" placeholder="Search product name, reference, or barcode...">
                                <div class="qt-product-status text-muted small mt-1">Click or type to search products.</div>
                                <div class="qt-product-list eagle-quick-search-dropdown qt-dropdown" style="display:none"></div>
                            </div>
                        </div>
                        <div class="qt-field qt-qty-field">
                            <label class="form-label small text-muted" for="eagle-qt-qty">Quantity <span class="text-danger">*</span></label>
                            <input id="eagle-qt-qty" type="number" class="form-control form-control-sm qt-qty" min="0.0001" step="0.0001" value="1">
                        </div>
                        <p class="text-muted small mt-3 mb-2"><i class="fa fa-info-circle me-1"></i>This creates a real Odoo Internal Transfer. It is confirmed and stock reservation is attempted; open the transfer to review and complete the standard validation workflow.</p>
                        <div class="qt-actions">
                            <button type="button" class="eagle-qt-action qt-cancel">Cancel</button>
                            <button type="button" class="eagle-qt-action qt-create"><i class="fa fa-check me-1"></i><span class="qt-create-label">Create Transfer</span></button>
                        </div>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(backdrop);
        this.root = backdrop;
        this.errorBox = backdrop.querySelector(".qt-error");
        this.qtyInput = backdrop.querySelector(".qt-qty");
        this.createButton = backdrop.querySelector(".qt-create");

        for (const role of ["source", "destination", "product"]) {
            const input = backdrop.querySelector(`.qt-${role}`);
            const dropdown = backdrop.querySelector(`.qt-${role}-list`);
            const status = backdrop.querySelector(`.qt-${role}-status`);
            this.controls[role] = { input, dropdown, status };
            input.addEventListener("input", (ev) => this._onInput(role, ev));
            // Focus alone (including automatic focus after selecting the prior
            // field) must not open the suggestion menu. A deliberate click or
            // typing opens it; Escape closes it until the next interaction.
            input.addEventListener("click", () => {
                if (dropdown.style.display !== "block") this._loadOptions(role, input.value || "");
            });
            input.addEventListener("keydown", (ev) => this._onKeydown(role, ev));
        }

        backdrop.querySelector(".qt-close").addEventListener("click", () => this.close());
        backdrop.querySelector(".qt-cancel").addEventListener("click", () => this.close());
        this.createButton.addEventListener("click", () => this._submit());
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
    }

    _onInput(role, ev) {
        this.ids[role] = 0;
        const query = String(ev.target.value || "").trim();
        const { dropdown, status } = this.controls[role];
        dropdown.style.display = "none";
        this._showError("");
        this.seq[role] += 1;
        const seq = this.seq[role];
        if (this.timers[role]) clearTimeout(this.timers[role]);
        this._setStatus(status, query.length >= 1 ? "Searching…" : "Loading options…", true);
        this.timers[role] = setTimeout(() => {
            this.timers[role] = null;
            this._loadOptions(role, query, seq);
        }, query.length >= 1 ? 220 : 0);
    }

    _onKeydown(role, ev) {
        const dropdown = this.controls[role]?.dropdown;
        if (ev.key === "Enter" && dropdown?.style.display === "block") {
            const first = dropdown.querySelector("button");
            if (first) {
                ev.preventDefault();
                first.click();
            }
        } else if (ev.key === "Escape" && dropdown) {
            dropdown.style.display = "none";
        }
    }

    async _loadOptions(role, query, seq = ++this.seq[role]) {
        if (!this.root || seq !== this.seq[role]) return;
        const normalQuery = String(query || "").trim();
        const cacheKey = `${role}:${normalQuery.toLowerCase()}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            this._renderOptions(role, cached);
            return;
        }
        const method = role === "product" ? "get_internal_transfer_product_options" : "get_internal_location_options";
        try {
            const rows = await this.orm.call("dashboard.data", method, [normalQuery]);
            if (!this.root || seq !== this.seq[role]) return;
            const options = Array.isArray(rows) ? rows : [];
            this.cache.set(cacheKey, options);
            if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
            this._renderOptions(role, options);
        } catch (error) {
            if (!this.root || seq !== this.seq[role]) return;
            console.error(`Quick Internal Transfer ${role} search failed:`, error);
            this._setStatus(this.controls[role].status, "Search failed. Please retry.");
            this.controls[role].dropdown.style.display = "none";
        }
    }

    _renderOptions(role, rows) {
        const { input, dropdown, status } = this.controls[role];
        dropdown.innerHTML = "";
        const options = (rows || []).slice(0, 30);
        this._setStatus(status, options.length ? `${options.length} matching option(s). Select one below.` : "No matching options found.");
        if (!options.length) {
            dropdown.style.display = "none";
            return;
        }
        for (const option of options) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "eagle-quick-search-option";
            const title = document.createElement("span");
            title.className = "fw-semibold d-block";
            title.textContent = option.name || option.complete_name || "";
            const meta = document.createElement("span");
            meta.className = "text-muted small d-block";
            const bits = [];
            if (role === "product") {
                if (option.default_code) bits.push(`Ref: ${option.default_code}`);
                if (option.barcode) bits.push(`Barcode: ${option.barcode}`);
                if (option.uom) bits.push(`UoM: ${option.uom}`);
            } else if (option.id) {
                bits.push(`Location ID: ${option.id}`);
            }
            meta.textContent = bits.join(" · ");
            button.appendChild(title);
            if (meta.textContent) button.appendChild(meta);
            button.addEventListener("click", () => {
                this.ids[role] = Number(option.id) || 0;
                input.value = option.name || option.complete_name || "";
                dropdown.style.display = "none";
                this._showError("");
                if (role === "source") this.controls.destination.input.focus();
                else if (role === "destination") this.controls.product.input.focus();
                else this.qtyInput.focus();
            });
            dropdown.appendChild(button);
        }
        dropdown.style.display = "block";
    }

    _setStatus(el, message, loading = false) {
        if (!el) return;
        el.textContent = message || "";
        if (loading) el.dataset.loading = "1";
        else delete el.dataset.loading;
    }

    _showError(message) {
        if (!this.errorBox) return;
        this.errorBox.textContent = message || "";
        this.errorBox.style.display = message ? "block" : "none";
    }

    async _submit() {
        if (this.submitBusy || !this.createButton) return;
        const quantity = Number(this.qtyInput?.value);
        if (!this.ids.source || !this.ids.destination || !this.ids.product) {
            this._showError("Select a source location, destination location, and product from the search results.");
            return;
        }
        if (this.ids.source === this.ids.destination) {
            this._showError("Source and destination locations must be different.");
            return;
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
            this._showError("Quantity must be greater than zero.");
            return;
        }

        this.submitBusy = true;
        const original = this.createButton.innerHTML;
        this.createButton.disabled = true;
        this.createButton.innerHTML = '<i class="fa fa-spinner fa-spin me-1"></i><span>Creating…</span>';
        this._showError("");
        try {
            const result = await this.orm.call("dashboard.data", "create_quick_internal_transfer", [
                this.ids.source, this.ids.destination, this.ids.product, quantity,
            ]);
            if (result?.error) {
                this._showError(result.error);
                return;
            }
            if (!result?.id) {
                this._showError("The internal transfer could not be created. Please try again.");
                return;
            }
            const callback = this.onCreated;
            this.close();
            if (callback) await callback(result);
        } catch (error) {
            console.error("Quick Internal Transfer create failed:", error);
            this._showError(error?.data?.message || error?.message || "Server error while creating the internal transfer.");
        } finally {
            this.submitBusy = false;
            if (this.createButton) {
                this.createButton.disabled = false;
                this.createButton.innerHTML = original;
            }
        }
    }
}
