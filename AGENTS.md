<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Firestore database namespace

Before creating, renaming, reading, or writing a Firestore collection, read and
follow `.agent/rules/database-rules/rules.md`. POS-owned top-level collections
must use the `pos_` namespace so they cannot collide with `bduck-system`.

## Date display convention

All user-visible dates must use `dd/mm/yyyy`, with zero-padded day and month,
regardless of UI or receipt language. Date-times use `dd/mm/yyyy HH:mm` (24-hour
time; add seconds only when needed). Use `formatDate` / `formatDateTime` from
`src/lib/utils/dateFormat.ts` for displays and the shared
`src/components/ui/DateInput.tsx` for date and datetime fields. Do not render raw
ISO dates or add native date inputs outside this component: their visible format
depends on the browser/OS locale. Keep ISO values for storage, APIs, sorting and
date-range calculations; preserve each feature's time-zone semantics.
