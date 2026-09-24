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

    // Date formats commonly rendered by this module.
    let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        return {type: "number", value: Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))};
    }
    m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        return {type: "number", value: Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))};
    }

    // Numeric cells: currency symbols, grouping commas, signs, percentages,
    // and parenthesised counts are treated as presentation noise.
    const cleaned = raw
        .replace(/BDT|USD|EUR|GBP/gi, "")
        .replace(/[%(),]/g, "")
        .replace(/\s+/g, "");
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) {
        return {type: "number", value: Number(cleaned)};
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
    return `eagle_${namespace}_table_${suffix}_${tableKey}`;
}

function buildStableTableKey(table, index) {
    const card = table.closest(".eagle-card");
    const title = card?.querySelector(".eagle-card-title")?.textContent || "table";
    const headers = Array.from(table.querySelectorAll("thead th")).map(th =>
        normaliseKey(th.textContent)
    ).join("|");
    return `${index}-${normaliseKey(title)}-${headers}`;
}

export function enhanceEagleTables(root, namespace = "dashboard") {
    if (!root) return;

    const tables = Array.from(root.querySelectorAll("table.eagle-table"));
    tables.forEach((table, index) => {
        const wrapper = table.closest(".eagle-table-wrap") || table.parentElement;
        if (!wrapper) return;

        if (!wrapper.dataset.eagleTableKey) {
            wrapper.dataset.eagleTableKey = buildStableTableKey(table, index);
        }
        const tableKey = wrapper.dataset.eagleTableKey;

        // A table nested inside a component-owned collapsible card already has
        // an explicit control. Add the generic control only when no such
        // control exists in the nearest card header.
        const header = wrapper.closest(".eagle-card")?.querySelector(":scope > .eagle-card-header");
        const hasComponentFold = !!header?.querySelector("button[aria-expanded]");
        const isNestedJournalTable = !!wrapper.closest(".jb-details-panel");

        if ((!hasComponentFold || isNestedJournalTable) && !wrapper.querySelector(":scope > .eagle-auto-table-toolbar")) {
            const toolbar = document.createElement("div");
            toolbar.className = "eagle-auto-table-toolbar";
            toolbar.innerHTML = `
                <span class="eagle-auto-table-label"><i class="fa fa-table me-1"></i>Table</span>
                <button type="button" class="ebtn ebtn-sm ebtn-outline eagle-auto-table-toggle"
                        aria-expanded="true" title="Show / hide table">
                    <i class="fa fa-chevron-up"></i>
                </button>`;
            toolbar.querySelector(".eagle-auto-table-toggle").addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const current = toolbar.classList.contains("is-collapsed");
                toolbar.classList.toggle("is-collapsed", !current);
                table.classList.toggle("eagle-table-hidden", !current);
                toolbar.querySelector(".eagle-auto-table-toggle").setAttribute("aria-expanded", String(current));
                toolbar.querySelector(".eagle-auto-table-toggle i").className = `fa ${current ? "fa-chevron-up" : "fa-chevron-down"}`;
                try {
                    localStorage.setItem(storageKey(namespace, tableKey, "fold"), (!current).toString());
                } catch (e) {}
            });
            wrapper.insertBefore(toolbar, table);

            try {
                const collapsed = localStorage.getItem(storageKey(namespace, tableKey, "fold")) === "true";
                if (collapsed) {
                    toolbar.classList.add("is-collapsed");
                    table.classList.add("eagle-table-hidden");
                    toolbar.querySelector(".eagle-auto-table-toggle").setAttribute("aria-expanded", "false");
                    toolbar.querySelector(".eagle-auto-table-toggle i").className = "fa fa-chevron-down";
                }
            } catch (e) {}
        }

        // Add generic sorting to every actual data header that doesn't already
        // have a component-owned sorter. Headers containing a checkbox or no
        // label are action selectors and are intentionally left alone.
        const headers = Array.from(table.querySelectorAll("thead th"));
        headers.forEach((th, colIndex) => {
            if (th.dataset.eagleSortBound === "1" || th.classList.contains("sortable")) return;
            if (th.querySelector("input,button,select") || !th.textContent.trim()) return;
            th.dataset.eagleSortBound = "1";
            th.classList.add("eagle-sortable-auto");
            const icon = document.createElement("i");
            icon.className = "fa fa-sort eagle-auto-sort-icon ms-1";
            th.appendChild(icon);

            const applySort = () => {
                const direction = th.dataset.eagleSortDirection === "asc" ? "desc" : "asc";
                headers.forEach(other => {
                    if (other !== th) {
                        delete other.dataset.eagleSortDirection;
                        const otherIcon = other.querySelector("i.eagle-auto-sort-icon");
                        if (otherIcon) otherIcon.className = "fa fa-sort eagle-auto-sort-icon ms-1";
                    }
                });
                th.dataset.eagleSortDirection = direction;
                icon.className = `fa ${direction === "asc" ? "fa-sort-asc" : "fa-sort-desc"} eagle-auto-sort-icon ms-1`;

                const body = table.tBodies[0];
                if (!body) return;
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

                sortableGroups.sort((ga, gb) => {
                    const cellA = ga[0].cells[colIndex]?.textContent || "";
                    const cellB = gb[0].cells[colIndex]?.textContent || "";
                    return compareValues(cellA, cellB, direction === "asc" ? 1 : -1);
                });

                const ordered = [...sortableGroups, ...excludedGroups, ...standaloneDetails];
                ordered.forEach(group => group.forEach(row => body.appendChild(row)));
                try { localStorage.setItem(storageKey(namespace, tableKey, "sort"), `${colIndex}:${direction}`); } catch (e) {}
            };
            th.addEventListener("click", applySort);
        });

        // Restore a previous generic sort after Owl patches rebuild table rows.
        try {
            const saved = localStorage.getItem(storageKey(namespace, tableKey, "sort"));
            if (saved) {
                const [savedIndex, savedDirection] = saved.split(":").map(String);
                const savedTh = headers[Number(savedIndex)];
                if (savedTh && savedTh.dataset.eagleSortBound === "1" && savedTh.dataset.eagleSortDirection !== savedDirection) {
                    savedTh.click();
                    if (savedDirection === "desc") savedTh.click();
                }
            }
        } catch (e) {}
    });
}
