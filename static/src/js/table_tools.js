/** @odoo-module **/

/*
 * Lightweight, DOM-level table controls used by all Eagle dashboard views.
 * The dashboard data remains authoritative in Owl; this helper only controls
 * presentation (collapse state and header sorting) for tables that do not
 * already have component-owned controls.
 */

function normaliseKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function parseComparable(text) {
    const raw = String(text || "").replace(/\u2022/g, "").trim();
    if (!raw) return {type: "empty", value: null};

    // Date and datetime formats commonly rendered by Odoo for this module.
    let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
        return {type: "number", value: Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0))};
    }
    m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
        return {type: "number", value: Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0))};
    }

    // Numeric cells: support ordinary negative signs, currency labels,
    // grouping separators, percentages and accounting-style parentheses.
    const accountingNegative = /^\(.*\)$/.test(raw);
    const cleaned = raw
        .replace(/BDT|USD|EUR|GBP/gi, "")
        .replace(/[()% ,]/g, "")
        .replace(/\s+/g, "");
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) {
        const numeric = Number(cleaned);
        return {type: "number", value: accountingNegative ? -Math.abs(numeric) : numeric};
    }

    return {type: "text", value: raw};
}

function compareValues(a, b, direction) {
    const pa = parseComparable(a);
    const pb = parseComparable(b);
    if (pa.type === "empty" && pb.type !== "empty") return 1;
    if (pb.type === "empty" && pa.type !== "empty") return -1;
    if (pa.type === "number" && pb.type === "number") {
        if (pa.value === pb.value) return 0;
        return (pa.value < pb.value ? -1 : 1) * direction;
    }
    return pa.value.toString().localeCompare(pb.value.toString(), undefined, {
        numeric: true,
        sensitivity: "base",
    }) * direction;
}

function storageKey(namespace, tableKey, suffix) {
    // Version only the fold key to reset the default-open behavior. Keep the
    // existing sort key so users do not lose saved column/direction choices.
    return suffix === "fold"
        ? `eagle_${namespace}_table_fold_v2_${tableKey}`
        : `eagle_${namespace}_table_${suffix}_${tableKey}`;
}

function buildStableTableKey(table, index) {
    // Do not include the page-wide table index or live row-count badges: panels
    // may be conditionally rendered and counts change after targeted refreshes.
    const card = table.closest(".eagle-card");
    const titleNode = card?.querySelector(".eagle-card-title");
    let title = "table";
    if (titleNode) {
        const clone = titleNode.cloneNode(true);
        clone.querySelectorAll(".ebadge,.badge,i,button,.eagle-table-title-chevron").forEach(node => node.remove());
        title = clone.textContent || "table";
    }
    const headers = Array.from(table.querySelectorAll("thead th")).map(th =>
        normaliseKey(th.textContent)
    ).join("|");
    // Journal transaction detail tables share a parent card and headers; include
    // the journal label so folding/sorting one journal never alters another.
    const detailLabel = table.closest(".jb-details-panel")?.querySelector(".jb-details-header")?.textContent || "";
    const explicit = table.getAttribute("data-eagle-table-id") || table.id || "";
    return `${normaliseKey(title)}-${normaliseKey(detailLabel)}-${headers}${explicit ? `-${normaliseKey(explicit)}` : ""}`;
}

export function enhanceEagleTables(root, namespace = "dashboard") {
    if (!root) return;

    const tables = Array.from(root.querySelectorAll("table.eagle-table"));
    tables.forEach((table, index) => {
        // A few high-traffic tables now own folding/sorting in Owl state. Do not
        // attach DOM-only listeners to those tables; Owl will otherwise patch
        // away the reordered rows and can make their controls appear inert.
        if (table.dataset.eagleManagedControls === "1") return;
        const wrapper = table.closest(".eagle-table-wrap") || table.parentElement;
        if (!wrapper) return;

        if (!wrapper.dataset.eagleTableKey) {
            wrapper.dataset.eagleTableKey = buildStableTableKey(table, index);
        }
        const tableKey = wrapper.dataset.eagleTableKey;

        // Prefer the table card title as the fold control when the card contains
        // exactly one table and does not already own a component fold button.
        // Multi-table cards and nested journal tables receive a fold control per
        // table, so folding one table never hides an unrelated sibling table.
        const card = table.closest(".eagle-card");
        const header = card?.querySelector(":scope > .eagle-card-header");
        const title = header?.querySelector(":scope > .eagle-card-title");
        const cardTables = card ? Array.from(card.querySelectorAll("table.eagle-table")) : [];
        const hasComponentFold = !!header?.querySelector(
            'button[aria-expanded], button i.fa-chevron-up, button i.fa-chevron-down, button .fa-chevron-up, button .fa-chevron-down'
        );
        const isNestedJournalTable = !!wrapper.closest(".jb-details-panel");
        const canUseTitleToggle = !!title && cardTables.length === 1 && !hasComponentFold && !isNestedJournalTable && !wrapper.querySelector(":scope > .eagle-auto-table-toolbar");
        const readCollapsed = () => {
            try {
                const saved = localStorage.getItem(storageKey(namespace, tableKey, "fold"));
                // A new table-control version intentionally starts folded even if
                // an older release had stored the table as open.
                return saved === null ? true : saved === "true";
            } catch (e) { return true; }
        };
        const saveCollapsed = (collapsed) => {
            try { localStorage.setItem(storageKey(namespace, tableKey, "fold"), String(collapsed)); } catch (e) {}
        };

        if (canUseTitleToggle) {
            title.classList.add("eagle-table-title-toggle");
            title.setAttribute("role", "button");
            title.setAttribute("tabindex", "0");
            title.setAttribute("title", "Click to fold or unfold this table");

            let chevron = title.querySelector("i.eagle-table-title-chevron");
            if (!chevron) {
                chevron = document.createElement("i");
                chevron.className = "fa fa-chevron-up eagle-table-title-chevron ms-2";
                title.appendChild(chevron);
            }

            const applyTitleFold = (collapsed, persist = true) => {
                // Resolve the live table/wrapper each time because Owl may replace
                // table nodes during a data refresh while keeping the card title.
                const liveTable = card.querySelector("table.eagle-table");
                const liveWrapper = liveTable?.closest(".eagle-table-wrap") || liveTable;
                if (liveWrapper) liveWrapper.classList.toggle("eagle-table-hidden", collapsed);
                title.classList.toggle("is-collapsed", collapsed);
                title.setAttribute("aria-expanded", String(!collapsed));
                chevron.className = `fa ${collapsed ? "fa-chevron-down" : "fa-chevron-up"} eagle-table-title-chevron ms-2`;
                if (persist) saveCollapsed(collapsed);
            };

            if (!title.dataset.eagleFoldBound) {
                title.dataset.eagleFoldBound = "1";
                title.addEventListener("click", (ev) => {
                    if (ev.target.closest("a,button,input,select,textarea")) return;
                    ev.preventDefault();
                    applyTitleFold(!title.classList.contains("is-collapsed"));
                });
                title.addEventListener("keydown", (ev) => {
                    if (ev.key !== "Enter" && ev.key !== " ") return;
                    ev.preventDefault();
                    applyTitleFold(!title.classList.contains("is-collapsed"));
                });
            }
            applyTitleFold(readCollapsed(), false);
        } else if ((!hasComponentFold || isNestedJournalTable || !title || cardTables.length !== 1) && !wrapper.querySelector(":scope > .eagle-auto-table-toolbar")) {
            // Fallback for tables without a unique card title (for example the
            // nested journal-transaction tables inside a single Finance panel).
            const toolbar = document.createElement("div");
            toolbar.className = "eagle-auto-table-toolbar";
            toolbar.innerHTML = `
                <span class="eagle-auto-table-label"><i class="fa fa-table me-1"></i>Table</span>
                <button type="button" class="ebtn ebtn-sm ebtn-outline eagle-auto-table-toggle"
                        aria-expanded="false" title="Show / hide table">
                    <i class="fa fa-chevron-down"></i>
                </button>`;
            const applyToolbarFold = (collapsed, persist = true) => {
                const liveTable = wrapper.querySelector("table.eagle-table") || table;
                liveTable.classList.toggle("eagle-table-hidden", collapsed);
                toolbar.classList.toggle("is-collapsed", collapsed);
                const button = toolbar.querySelector(".eagle-auto-table-toggle");
                button.setAttribute("aria-expanded", String(!collapsed));
                button.querySelector("i").className = `fa ${collapsed ? "fa-chevron-down" : "fa-chevron-up"}`;
                if (persist) saveCollapsed(collapsed);
            };
            toolbar.querySelector(".eagle-auto-table-toggle").addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const liveTable = wrapper.querySelector("table.eagle-table") || table;
                applyToolbarFold(!liveTable.classList.contains("eagle-table-hidden"));
            });
            toolbar._eagleApplyFold = applyToolbarFold;
            wrapper.insertBefore(toolbar, table);

            applyToolbarFold(readCollapsed(), false);
        } else {
            // Component-owned fold buttons (Finance and some Business panels)
            // keep control of their Owl state. Their templates initialize closed.
        }

        // If Owl patched rows but retained the toolbar node, re-apply the saved
        // state to the newly-rendered table rather than leaving it open by default.
        const existingToolbar = wrapper.querySelector(":scope > .eagle-auto-table-toolbar");
        if (existingToolbar?._eagleApplyFold) {
            existingToolbar._eagleApplyFold(readCollapsed(), false);
        } else if (!canUseTitleToggle && !hasComponentFold) {
            table.classList.toggle("eagle-table-hidden", readCollapsed());
        }

        // Every table column uses the shared sorting layer. The two transaction
        // tables also have Owl-managed sort handlers; we leave those handlers in
        // place, while persisting the selected direction and reapplying it after
        // patches so they behave like the generic sortable tables.
        const headers = Array.from(table.querySelectorAll("thead th"));
        headers.forEach((th) => {
            const label = normaliseKey(th.textContent);
            if (!label || th.querySelector("input,button,select,textarea")) return;
            const hasComponentSorter = th.classList.contains("sortable");

            if (th.dataset.eagleSortBound !== "1") {
                th.dataset.eagleSortBound = "1";
                th.classList.add("eagle-sortable-auto");
                th.setAttribute("title", th.getAttribute("title") || "Click to sort ascending/descending");
                th.style.cursor = "pointer";

                // Keep the explicit Owl sort icon when present; otherwise add
                // the same shared icon used by all other dashboard tables.
                let existingIcon = Array.from(th.querySelectorAll("i")).find(icon =>
                    /(?:^|\s)fa-sort(?:-asc|-desc)?(?:\s|$)/.test(icon.className)
                );
                if (!existingIcon || !hasComponentSorter) {
                    if (!th.querySelector("i.eagle-auto-sort-icon")) {
                        const icon = document.createElement("i");
                        icon.className = "fa fa-sort eagle-auto-sort-icon ms-1";
                        th.appendChild(icon);
                    }
                }

                const applySortDirection = (direction, persist = true) => {
                    const currentHeaders = Array.from(table.querySelectorAll("thead th"));
                    const currentColIndex = currentHeaders.indexOf(th);
                    if (currentColIndex < 0) return;

                    currentHeaders.forEach(other => {
                        if (other !== th) {
                            delete other.dataset.eagleSortDirection;
                            const otherAutoIcon = other.querySelector("i.eagle-auto-sort-icon");
                            if (otherAutoIcon) otherAutoIcon.className = "fa fa-sort eagle-auto-sort-icon ms-1";
                        }
                    });
                    th.dataset.eagleSortDirection = direction;
                    const currentIsComponentSortable = th.classList.contains("sortable");
                    if (currentIsComponentSortable) {
                        const indicator = Array.from(th.querySelectorAll("i")).find(icon =>
                            /(?:^|\s)fa-sort(?:-asc|-desc)?(?:\s|$)/.test(icon.className)
                            && !icon.classList.contains("eagle-auto-sort-icon")
                        );
                        if (indicator) {
                            indicator.className = `fa ${direction === "asc" ? "fa-sort-asc" : "fa-sort-desc"}`;
                        }
                    }
                    const autoIcon = th.querySelector("i.eagle-auto-sort-icon");
                    if (autoIcon) {
                        autoIcon.className = `fa ${direction === "asc" ? "fa-sort-asc" : "fa-sort-desc"} eagle-auto-sort-icon ms-1`;
                    }

                    const body = table.tBodies[0];
                    if (body) {
                        const rows = Array.from(body.rows);
                        const groups = [];
                        let currentGroup = null;
                        for (const row of rows) {
                            if (row.classList.contains("jb-details-row")) {
                                if (currentGroup) currentGroup.push(row);
                                else groups.push([row]);
                            } else {
                                currentGroup = [row];
                                groups.push(currentGroup);
                            }
                        }
                        const mainGroups = groups.filter(group => group[0] && !group[0].classList.contains("jb-details-row"));
                        const standaloneDetails = groups.filter(group => group[0]?.classList.contains("jb-details-row"));
                        const sortableGroups = mainGroups.filter(group => !group[0].querySelector("td[colspan]"));
                        const excludedGroups = mainGroups.filter(group => group[0].querySelector("td[colspan]"));
                        const multiplier = direction === "asc" ? 1 : -1;
                        sortableGroups.sort((ga, gb) => {
                            const cellA = ga[0].cells[currentColIndex]?.textContent || "";
                            const cellB = gb[0].cells[currentColIndex]?.textContent || "";
                            return compareValues(cellA, cellB, multiplier);
                        });
                        [...sortableGroups, ...excludedGroups, ...standaloneDetails]
                            .forEach(group => group.forEach(row => body.appendChild(row)));
                    }

                    if (persist) {
                        const columnKey = encodeURIComponent(normaliseKey(th.textContent));
                        try { localStorage.setItem(storageKey(namespace, tableKey, "sort"), `${columnKey}:${direction}`); } catch (e) {}
                    }
                };

                th._eagleApplySortDirection = applySortDirection;
                th.addEventListener("click", (ev) => {
                    if (ev.target.closest("a,button,input,select,textarea")) return;
                    const nextDirection = th.dataset.eagleSortDirection === "asc" ? "desc" : "asc";
                    // Do not cancel this event: existing Owl-backed sortable
                    // columns still update their data state; the shared layer
                    // then applies the same direction to the visible rows.
                    th._eagleApplySortDirection(nextDirection, true);
                });
            }
        });

        // Restore the saved sort by stable column label after every Owl patch.
        // A component-owned sort remains intact; this reapplies the visual row
        // order if conditional rendering or a targeted refresh replaced rows.
        try {
            const saved = localStorage.getItem(storageKey(namespace, tableKey, "sort"));
            if (saved) {
                const [savedColumn, savedDirection] = saved.split(":");
                let savedTh;
                if (/^\d+$/.test(savedColumn)) {
                    savedTh = headers[Number(savedColumn)];
                } else {
                    let label = savedColumn;
                    try { label = decodeURIComponent(savedColumn); } catch (e) {}
                    savedTh = headers.find(th => normaliseKey(th.textContent) === label);
                }
                if (savedTh && (savedDirection === "asc" || savedDirection === "desc") &&
                    typeof savedTh._eagleApplySortDirection === "function") {
                    savedTh._eagleApplySortDirection(savedDirection, false);
                }
            }
        } catch (e) {}
    });
}
