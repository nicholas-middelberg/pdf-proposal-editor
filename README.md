# pdf-proposal-editor
Web app that lets a user upload a PDF of a construction proposal and edit it section by section using AI

## Setup

```
cp .env.example .env.local
# then paste the real hiring-proxy token into .env.local as PROXY_TOKEN=...
npm install
npm run dev
```

`PROXY_TOKEN` is read only inside `app/api/edit/route.ts` (D-010) and must
never be committed or prefixed `NEXT_PUBLIC_`.

## Model

`/api/edit` (`lib/ai.ts`) is pinned to `claude-sonnet-5` — confirmed served
by the live hiring proxy (verified with real edit calls against
`fixtures/easy.pdf`-style paragraphs).
