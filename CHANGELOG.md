## 18.0.10.11.24
- Standardized table folding and sorting across Business, Finance, and Operations dashboards.
- Tables start folded by default; single-table cards use the title/chevron, while nested or multi-table cards get an individual fold control.
- Kept component-owned Finance/Business sections and the reactive Operations Orders/Purchase controls intact; generic sorting re-applies after Owl patches and targeted refreshes.
- Bumped module version and updated user/developer manuals.

## 18.0.10.11.23
- Fixed the Operations Dashboard Orders and Purchase table fold controls with Owl-managed, keyboard-accessible title toggles and persisted open/closed state.
- Replaced DOM-only sorting for these tables with reactive, column-aware sorting across Order, Partner, Date (when visible), Status, Invoice/Billing, and Amount; ascending/descending indicators update with the chosen field.
- Prevented the generic DOM table enhancer from attaching competing listeners to the component-managed tables, avoiding Owl patch reverts that made clicks appear inert.
- Updated User Manual and Developer Manual; bumped the module version to `18.0.10.11.23`.

## 18.0.10.11.22

- Unified Quick Sale across Business and Operations: both floating buttons now open the same `EagleQuickSaleDialog`, with the same partner search, walk-in option, product search, quantity validation, and create/update behavior.
- Removed the previous Business Dashboard-only inline Quick Sale modal so there is one reusable implementation shared by both dashboards.
- Standardized sorting across data tables: generic tables and the Finance/Business transaction tables now share stable column-key persistence and reapply visual row order after Owl patches/targeted refreshes.
- Made table-state keys independent of page-wide table index so conditionally rendered panels do not lose their saved fold/sort preference when another table is hidden.
- Bumped module version to `18.0.10.11.22`; updated user/developer documentation.

## 18.0.10.11.21

- Added a second floating action to Operations Dashboard: **Quick Internal Transfer**, beside the existing Quick Sale button.
- Added a standalone wizard with type-ahead source/destination internal-location search, active stockable/consumable product search, and quantity validation.
- Added server-side endpoints to search eligible locations/products and create a regular internal `stock.picking`; it confirms the transfer and attempts stock reservation using the standard Odoo workflow.
- On creation, the transfer opens in a new tab and only the relevant transfer row is refreshed on the dashboard.
- Fixed table sorting persistence so all data tables reapply saved column sort directions after Owl updates; checked fold controls across every Operations table.
- Updated User Manual and Developer Manual. Module version bumped to 18.0.10.11.21.

## 18.0.10.11.20

- Added an **Internal Stock Transfer** table to the Operations Dashboard, matching the supplied screenshot's Reference, From, To, Creation Date, Scheduled Date, Status, and Responsible columns.
- Internal transfers use the existing warehouse date rule: Creation Date **or** Done Date within the selected range.
- Internal transfer rows support clickable reference/location/responsible fields, fold/unfold, sorting, and CSV export.
- Non-Done/non-Cancelled internal transfers can be validated through the standard Odoo picking workflow; after an action, only the affected transfer row and related warehouse counters are refreshed.
- Updated User Manual, Developer Manual, and Change Log. Module version bumped to 18.0.10.11.20.

## 18.0.10.11.19

- Operations action buttons now perform **targeted record refreshes** instead of calling the full dashboard `loadAll()` cycle.
- Validating a payment refreshes only that transaction row; its displayed totals recalculate from the updated row set.
- Validating a delivery/receiving order refreshes only the affected transfer row plus the related live warehouse counters.
- Quick Sale refreshes only the affected Sales Order row (quotation/order) after creation or update, so unrelated dashboard tables and controls are not rebuilt.
- Existing date filters, fold/unfold state, sorting, tracking links, and other page state remain in place during these targeted updates.

## 18.0.10.11.18

- Operations Dashboard: every data table can now be **folded/unfolded by clicking its table title**. The open/closed state is remembered per table in the browser.
- Every Operations Dashboard column heading is now **click-to-sort**, with ascending/descending indicators. Sorting is presentation-only and applies to the currently displayed rows without changing Odoo records.
- Kept existing Delivery Order tracking links, inline tracking-reference entry, status validation, Quick Sale, date-range filtering, and other Operations behavior unchanged.

## 18.0.10.11.16

- Operations Dashboard Delivery Orders now show **Carrier** and **Tracking Reference**.
- Tracking Reference is editable directly in the Operations Dashboard only while it is empty; once saved, the dashboard does not overwrite it.
- Delivery **Status** is now an action button for non-Done/non-Cancelled transfers, using the standard Odoo picking validation workflow; Done and Cancelled remain non-action badges.
- Added the Odoo **Delivery** module as a dependency so carrier and tracking fields are always available.

## 18.0.10.11.15

- Fixed partner lookup in the Operations Dashboard Quick Sale/Quick Order wizard by adding the server-side `get_partner_options` endpoint.
- Operations Quick Sale now uses the same partner-search flow as the Business Dashboard, including walk-in fallback and full server-side lookup by name, reference, phone, or email.
- After creating or updating a Quick Sale, the resulting Sales Order opens in a new tab, matching the Business Dashboard workflow.

## 18.0.10.11.14
- Fixed the Operations Dashboard client action registry error (`Cannot find key "operations_dashboard_tag" in the "actions" registry`).
- Added `quick_sale_dialog.js` to `web.assets_backend` before `operations_dashboard.js`, resolving its imported-module dependency so the Operations Dashboard component registers correctly.
- No change to the Operations Dashboard date-range behavior introduced in 18.0.10.11.13.


## 18.0.10.11.13
- Operations Dashboard Delivery Orders and Receiving Orders now use an **OR date rule**: a transfer is shown when its **Creation Date OR Complete Date** falls within the selected From/To range.
- The Operations warehouse tables now display the actual stock transfer **Creation Date** (`create_date`) instead of the scheduled date.
- Pending transfers created in the selected period remain visible even when they have no Complete Date yet; older transfers completed in the selected period are also included.


## 18.0.10.11.12
- Restored the floating **+ (Quick Sale)** button on the Operations Dashboard, matching the dashboard-wide quick action behavior.
- The Operations Dashboard now opens the standalone Quick Sale dialog from the bottom-right floating action button.
## 18.0.10.11.11

- Dashboard menu now has exactly three direct submenus: **Business**, **Finance**, and **Operation**.
- **Business** continues to open the existing Business Dashboard.
- **Finance** now directly opens the existing Finance Dashboard page. The redundant nested “Finance Dashboard” menu entry is retired.
- **Operation** now directly opens the dedicated Operations Dashboard page. Delivery Orders and Receipts are no longer separate child menus under Operation.
- Operations Dashboard presentation is aligned to the supplied reference: filters followed by Orders/Purchase, Quotations/RFQ, Transactions, Delivery/Receiving Orders, and Team Notes.
- Ledger Balance Security remains under **Dashboard → Settings → Ledger Balance Security** and is not part of the Dashboard page menu.


## 18.0.10.11.10
- Added a standalone Operations workspace opened directly from Dashboard → Operations, styled to match the Business Dashboard and focused on Orders, Purchase, Quotations, RFQ, Transactions, Delivery Orders, Receiving Orders, filtering, and quick actions.
- Moved Ledger Balance Security out of the Finance menu and into a new administrator-only Business Dashboard → Settings → Ledger Balance Security menu.
- Removed the embedded Ledger Balance Security configuration section from the Finance dashboard settings modal.
- Updated user and developer manuals.
v1.0.33
- Reworked account.payment Send/Receive tinting to CSS-first selectors using :has() with a minimal DOM fallback.
- Removed FormRenderer patch dependency from payment theme.
- Regenerated documentation.

## 18.0.10.31
- Fixed standard account.payment Send/Receive background tint using live payment-type state.
- Applies tint to the full form view and relevant surrounding containers without polling or mutation loops.


## v1.0.29
- Operation Dashboard: Sales/Purchase print-wizard buttons with scope-specific line options.
- Removed standalone Quotations/RFQ print/export buttons.
- Added New Sales Order and New Purchase Order actions.
- Added Receive and Send payment actions to Transactions.
- Updated User and Developer Manuals.

# Eagle Business Dashboard 18.0.10.24

## v1.0.24 / Quick Sale reliability
- Replaced Quick Sale partner selection with server-side type-ahead search.
- Quick Sale now loads a bounded recent partner list and searches by name, reference, email, or phone.
- Product and partner search state is fully isolated from the parent dashboard Owl component.
- Create / Add to Order action is forced visible with dedicated styling.
- Product selection and order submission remain server validated.
- User and Developer Manuals regenerated as informational references.

## v1.0.23 / Quick Sale isolation
- Quick Sale dialog moved outside the large dashboard Owl render tree.
- Product typing uses local DOM state and server-side search.
- Product results are clickable and keyboard-selectable.
- Search requests are debounced and stale responses are ignored.
- Search results are cached in a bounded client cache.
- Server limits Quick Sale results to 30 active saleable products.
- Quick Sale server validates active and saleable product status.
- User and Developer Manuals regenerated as informational references.

## 18.0.10.28
- Unauthorized users now see the unprotected portion of Cash Balance, Opening, and Balance when protected and unprotected ledger contributions coexist.
- Partial aggregates are marked with `*`; fully protected aggregates remain masked.
- Cash Balance drill-down is disabled whenever protected ledger contributions exist, preventing protected journal items from being exposed.


## 18.0.10.35
- Transaction tables, exports, and print output show Receive and Send as separate columns.

- Transaction UI, CSV, and print output use separate Receive and Send columns.
