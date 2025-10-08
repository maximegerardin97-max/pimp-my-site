# Pimp My Site

Lovable-style landing that scans a URL using a Supabase Edge Function and stores screenshots in the `screenshots` bucket.

- UI lives in `src/app/page.tsx`
- Gradient vibes similar to Lovable
- Calls Supabase `scan` edge function with `{ url }`

## Getting Started

```bash
npm run dev
```
Open http://localhost:3000 to see the custom UI.

Set envs for local dev in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=YOUR_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

## Deploy

### GitHub Pages
This repo includes `.github/workflows/pages.yml` which builds a static export.

- Add repo secrets:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Pages will publish at `/pimp-my-site`.

### Vercel
Import the repo, set the same env vars, and deploy.

## Supabase
Use the SQL in `supabase/seed.sql` if needed to create `public.scans` and policies. The `scan` function uploads to `screenshots` and logs rows to `public.scans`.
