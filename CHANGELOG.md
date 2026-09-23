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
