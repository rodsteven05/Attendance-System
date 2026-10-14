# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Database updates

Apply every SQL file in `supabase/migrations` in filename order. Existing installations must also apply `202610120006_remove_subscriptions.sql` through the Supabase SQL Editor or the project's migration workflow. It removes subscription restrictions and obsolete subscription fields while keeping classroom ownership checks. Teacher accounts no longer require paid activation; the admin Users page lists registered accounts.

## Attendance reliability update

Apply `202610120007_attendance_reliability.sql` after the subscription-removal migration, then deploy the updated `supabase/functions/send-notification` Edge Function. Configure Resend/Twilio credentials only as Edge Function secrets. Deploy the matching frontend after these backend changes. No live database or provider delivery is exercised by local tests.

- Edit each classroom and select its teaching days. Existing classrooms intentionally start with no teaching days; scans and finalization require a configured schedule. Add holidays and cancelled class dates as YYYY-MM-DD values. Times use Asia/Manila. Reports use the current schedule, so changing it also changes historical unrecorded-day calculations.
- Open Attendance for the Today’s class roster. Sync pending scans on every device before finalizing after the cutoff. Future days, non-class days, and dates before enrollment cannot be marked absent by finalization. Existing saved records are preserved.
- Every correction requires a reason and records the actor, time, prior status/notes, and new status/notes. Excuse filing and its attendance update are atomic. Direct browser writes to attendance and excuses are disabled; use the authorized functions.
- Offline scans are stored separately per teacher account and retain their original time. Saved attendance is not re-created when retrying failed parent notifications. The old unowned `attendance-queue` storage entry is preserved but is never automatically assigned to the next account. An administrator should review/export those legacy entries and reconcile them with the proper teacher before clearing that old key. Do not clear all browser data while scans are pending.
- Notifications are queued in the attendance transaction. The signed-in app attempts delivery during synchronization; Notifications also provides a retry action in batches of up to 100. There is no unattended delivery scheduler in this project. `sent` means provider acceptance, not confirmed receipt. Uncertain provider outcomes retain `processing_at` and require an administrator to check provider logs before clearing that claim or recording the outcome, to avoid duplicate SMS/email.
- Reports include the roster even when no attendance rows exist. Unrecorded is distinct from absent. Recorded rate excludes excused and unrecorded days; a report with unrecorded days is incomplete. Detailed CSV exports saved rows only.

Run `npm test`, `npm run lint`, and `npm run build`. Database tests execute the migration chain in local PGlite PostgreSQL with simulated Supabase auth roles; notification tests mock the provider boundary and do not send messages.
