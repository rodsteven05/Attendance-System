# Project Notes

- Stack: Vite, React, TypeScript, Supabase, and custom responsive CSS.
- Install dependencies with `npm install`.
- Run locally with `npm run dev`.
- Verify changes with `npm run lint` and `npm run build`.
- Supabase browser credentials belong in `.env`; copy keys from `.env.example`.
- Provider secrets (Resend and Twilio) must only be configured as Supabase Edge Function secrets.
- Apply migrations in `supabase/migrations` before using the application.
