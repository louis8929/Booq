# booq — Projects

## Run

```bash
npm install
npm run dev
```

Then open **http://localhost:5173/projects** (Node 20+).

## Decisions & trade-offs

- Router data loaders over `useEffect` fetching. 
- MUI for UI.

## What I'd do next

- Real backend + **React Query** for caching, revalidation, and mutations.
- **Auth**: login + route protection.
- **Tests**: validation + filtering logic, plus a render smoke test per view.
