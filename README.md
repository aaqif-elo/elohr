# Elohr

Elohr is a SolidStart application for managing employee leave requests, attendance tracking, and contract details. It uses SolidJS on the front end, Prisma for the database ORM, and Tailwind CSS for styling.

## Features

- User management with roles and permissions  
- Submit, approve, and track leave requests  
- Record daily attendance  
- Configurable reset policies and composite types  
- SQLite / PostgreSQL support via Prisma  

## Prerequisites

- Node.js >= 16  
- pnpm (or npm/yarn)  
- A database URL in `.env` (e.g. `DATABASE_URL="file:./dev.db"` or a Postgres connection string)

## Setup

1. Install dependencies

```bash
pnpm install
```

2. Copy .env.example to .env and update your database connection string.

3. Run Prisma generate

```bash
npx prisma generate
```

## Development

Start the dev server with hot reload:

```bash
pnpm run dev
```

Open `http://localhost:{PORT}` in your browser.

## Building & Deployment

Build the production version:

```bash
pnpm run build
```

Preview the production build locally:

```bash
pnpm run preview
```

Deploy your build according to your platform (Node, Vercel, Netlify, etc.).

Contributing
Feel free to open issues and submit pull requests. Please follow the existing code style and add tests for new features.

License
MIT © [elo](https://elobyte.com)
