# Firestore → PostgreSQL Migration

Exports all core Firestore collections to JSON, then seeds a PostgreSQL database.

## Prerequisites

- **Node.js** 18+
- **PostgreSQL 16** running locally (or via Docker)
- Firebase service account key at `../server/aiwaverider8-privatekey.json`

## Quick Start (Local PostgreSQL)

### 1. Install PostgreSQL locally

**Windows (winget):**
```bash
winget install PostgreSQL.PostgreSQL.16
```

**macOS (Homebrew):**
```bash
brew install postgresql@16 && brew services start postgresql@16
```

### 2. Create the database and user

```bash
psql -U postgres
```

```sql
CREATE USER aiwaverider WITH PASSWORD 'aiwaverider';
CREATE DATABASE aiwaverider OWNER aiwaverider;
GRANT ALL PRIVILEGES ON DATABASE aiwaverider TO aiwaverider;
\q
```

### 3. Run the schema + indices

```bash
psql -U aiwaverider -d aiwaverider -f 001_schema.sql
psql -U aiwaverider -d aiwaverider -f 002_indices.sql
```

### 4. Install dependencies

```bash
cd migration
npm install
```

### 5. Configure environment

```bash
cp .env.example .env
# Edit .env if your PostgreSQL credentials differ from defaults
```

### 6. Export Firestore data

```bash
npm run export
```

This creates one JSON file per collection in `data/`.

### 7. Seed PostgreSQL

```bash
npm run seed
```

### 8. Verify

```bash
psql -U aiwaverider -d aiwaverider -c "\dt"           # list tables
psql -U aiwaverider -d aiwaverider -c "SELECT COUNT(*) FROM users;"
psql -U aiwaverider -d aiwaverider -c "SELECT COUNT(*) FROM agents;"
```

---

## Alternative: Docker Compose

If you prefer Docker instead of a local install:

```bash
cd migration
docker compose up -d        # starts PostgreSQL 16 + pgAdmin
npm install
npm run export              # export Firestore → JSON
npm run seed                # seed PostgreSQL from JSON
```

- **PostgreSQL:** `localhost:5432` (user/pass: `aiwaverider`)
- **pgAdmin:** `http://localhost:5050` (login: `admin@aiwaverider.com` / `admin`)

To connect pgAdmin to the database, add a server with host `postgres`, port `5432`, user `aiwaverider`, password `aiwaverider`.

To tear down:
```bash
docker compose down         # stop containers
docker compose down -v      # stop + delete data volume
```

---

## File Overview

| File | Purpose |
|---|---|
| `001_schema.sql` | CREATE TABLE statements, triggers, extensions |
| `002_indices.sql` | Performance indices matching current query patterns |
| `export-firestore.js` | Connects to Firestore, exports core collections to `data/*.json` |
| `seed-from-json.js` | Reads JSON files, inserts into PostgreSQL in FK-dependency order |
| `docker-compose.yml` | PostgreSQL 16 + pgAdmin (optional) |
| `data/` | Exported JSON files (gitignored except `.gitkeep`) |

## Schema Notes

- Firebase Auth UIDs are kept as `TEXT` primary keys (not UUID) since we're keeping Firebase Auth
- Firestore camelCase fields are mapped to PostgreSQL snake_case
- Nested objects (priceDetails, creator, emailPreferences) stored as JSONB
- Simple arrays (tags, features, likes) stored as TEXT[]
- Agent reviews (Firestore subcollection) are promoted to a top-level `agent_reviews` table
- `updated_at` columns auto-update via trigger
- All foreign keys use `ON DELETE CASCADE` or `ON DELETE SET NULL` as appropriate

## Troubleshooting

**"relation already exists"** — The schema uses `CREATE TABLE IF NOT EXISTS`, so re-running is safe.

**FK constraint violations during seed** — The seed script uses `SET CONSTRAINTS ALL DEFERRED` and `ON CONFLICT DO NOTHING`. If a referenced user/agent was excluded, the FK column is set to NULL for optional references.

**Firestore Timestamps** — The export script converts all Firestore Timestamps to ISO strings. The seed script also handles `{ _seconds, _nanoseconds }` objects that may appear in raw exports.
