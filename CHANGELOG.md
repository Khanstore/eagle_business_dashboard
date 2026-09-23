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
