# SoundScope

SoundScope is a Next.js MVP inspired by the provided PRD for a Spotify analytics companion. The current build focuses on a strong portfolio-grade frontend foundation with mock insight data and clear extension points for Spotify OAuth, MongoDB caching, and future playlist and recommendation logic.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Framer Motion
- Recharts

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Run the dev server:

```bash
npm run dev
```

3. Open `http://localhost:3000`

## Next Integration Steps

- Add Spotify OAuth using NextAuth or custom Spotify authorization routes
- Create API routes for Spotify fetch and caching workflows
- Store normalized user/profile/insight snapshots in MongoDB
- Replace mock insight generators in `lib/mock-data.ts` with live data pipelines
