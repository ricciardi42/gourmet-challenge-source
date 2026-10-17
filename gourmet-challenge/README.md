# 🏆 The Gourmet Challenge — Casa Giuliano / Conti

**Six chefs. Six courses. One crown.** A mobile-friendly Italian web app to register the 10 participants, select the 6 chefs and their courses, vote privately, and see automatic rankings and charts.

> **Important:** Upload this code to **GitHub**, but host it with **Cloudflare Pages + D1**. **GitHub Pages alone cannot run the voting API or shared database**. Cloudflare Pages can connect directly to a GitHub repository and deploy automatically on every push.

## What it does

- 10 participants: **6 chefs + 4 non-chef judges**; each chef is assigned a course.
- A chef can rate **5** other dishes. A non-chef judge can rate **6** dishes. **No self-voting**, also checked on the server.
- Each ballot gives **integer scores 1–10** for:
  1. **Gusto ed equilibrio dei sapori** — taste, ingredients, cooking;
  2. **Presentazione e impiattamento** — aesthetic, colors, attention to detail;
  3. **Creatività e originalità** — imagination, innovation, technique;
  4. **Abbinamento enogastronomico** — how well the wine pairs with the dish.
- **54 total possible ballots:** 6 × (10 − 1).
- Each participant gets a randomly generated **private access code**. No registration or email is required. One saved ballot per eligible judge/chef pair; resubmitting *updates* it until voting closes.
- The organizer can open/close voting, hide/reveal results, see how many evaluations each participant completed, and reset lost codes.
- Rankings, podium, average-score bar chart, criterion chart, detailed score table; updated automatically every 15 seconds while viewing the results.
- Equal budget, bring a wine pairing, assemble/plate at Casa Giuliano/Conti, **NO FISH** (these are event guidelines, not automated checks).

### Scoring and tie rule

Every criterion has **25% weight**. A chef's score is the **mean of the four criteria across submitted ballots**, from 1 to 10. Using the mean avoids favoring chefs who happened to have more judges vote early. In a tie on overall mean, compare the unrounded average for **taste**, then **presentation**, **creativity**, and finally **wine pairing**. Completely identical category averages share a rank (**ex aequo**). The ranking is **provisional** until every eligible ballot is submitted.

## Files

```text
gourmet-challenge/
├── public/
│   ├── index.html             # interface
│   ├── app.js                 # voting, admin area, charts
│   ├── styles.css             # responsive design
│   ├── favicon.svg
│   └── _headers               # browser security headers
├── functions/api/
│   └── [[path]].js             # Cloudflare server-side voting API
├── migrations/
│   └── 0001_initial.sql        # persistent D1 database tables
├── src/
│   └── shared.js               # scoring and roster validation
├── test/
│   ├── api.test.js             # API integration tests using SQLite
│   └── shared.test.js          # scoring/validation tests
├── .github/workflows/test.yml # GitHub Actions CI
├── wrangler.toml.example       # copy to wrangler.toml and fill in database ID
├── package.json
└── README.md
```

## Deploy from your own GitHub (recommended)

You will need a **GitHub** account, a **Cloudflare** account, and [Node.js 22+](https://nodejs.org/). Wrangler and the database are managed from your terminal. Cloudflare has free-tier options, subject to its current terms/limits.

### 1. Upload the project to GitHub

1. Download and unzip `gourmet-challenge.zip`.
2. Create a **new GitHub repository**, e.g. `gourmet-challenge`.
3. Upload **the contents of the unzipped folder** to the **root** of that repository (including the `functions`, `public`, `migrations` folders). Do **not** upload just the ZIP file or place everything inside an extra nested folder.
4. You can also use Git if you prefer:

   ```bash
   cd gourmet-challenge
   git init
   git add .
   git commit -m "Initial Gourmet Challenge app"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/gourmet-challenge.git
   git push -u origin main
   ```

   If GitHub created a README first, use the GitHub web upload option or reconcile the existing repository history instead of force-pushing.

### 2. Create the real Cloudflare database

From inside the project folder, with internet access:

```bash
npm install
npx wrangler login
npx wrangler d1 create gourmet-challenge-db
```

Cloudflare will print a **database ID** like `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`.

**Copy** `wrangler.toml.example` to a new file named `wrangler.toml`, and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the database ID shown by Cloudflare. Leave the binding name **`DB`** unchanged. A database ID is not a secret; do **not** put your admin password in the Wrangler file.

Initialize the **remote (real)** database:

```bash
npx wrangler d1 migrations apply gourmet-challenge-db --remote
```

Confirm the migration if prompted. This creates the `settings`, `participants` and `votes` tables.

**Commit and push `wrangler.toml`** to your GitHub repository as well. For this Pages project, it tells Cloudflare which D1 database should be connected.

### 3. Connect the GitHub repository to Cloudflare Pages

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** (the exact dashboard labels may change).
2. Select your GitHub `gourmet-challenge` repository and `main` branch.
3. Choose **Framework preset: None**, **Build command: leave empty**, **Build output directory: `public`**. The Pages Functions in `functions/` will be deployed together with the website. If the dashboard shows project root, leave it at the repository root.
4. Deploy. The configured `wrangler.toml` includes the **D1 binding** named `DB`. In your project's **Settings → Bindings**, verify that `DB` points to `gourmet-challenge-db` (production; configure preview separately if you need preview builds). With a Wrangler configuration, bindings may be managed through the file rather than editable in the dashboard.
5. Under **Settings → Variables and Secrets**, add a **secret** called exactly `ADMIN_PASSWORD` with a **unique password of at least 12 characters**, e.g. generated by a password manager. Set it for **Production**. Never add this value to GitHub files or `public/app.js`.
6. Redeploy the Pages project after saving the secret if necessary.

You should get a URL similar to `https://gourmet-challenge.pages.dev` (it may have a different automatically assigned name). Share that URL with your friends. HTTPS is handled by Cloudflare.

Cloudflare's docs: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [Pages Functions](https://developers.cloudflare.com/pages/functions/), [D1 migrations](https://developers.cloudflare.com/d1/wrangler-commands/), [Wrangler Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

### 4. Create your competition

1. Open your Pages URL and click **⚙️ Organizza**.
2. Enter your `ADMIN_PASSWORD`.
3. Type the **10 names**, tick the **6 chefs**, and assign their 6 courses (editable defaults included).
4. Click **Crea la competizione + 10 codici**.
5. **Immediately download the private CSV with the 10 generated codes**. You will only see these exact codes once. The organizer can later reset an individual code if lost.
6. Click **📋 Invito** to copy each guest's invitation and personal access code, and share it **privately**.
7. Participants open the website on their phones → **🍽️ Vota i piatti** → enter their codes → score the dishes.
8. View **🏆 Classifica**, or temporarily hide it through the admin settings to keep the reveal a surprise. The admin can still view hidden results while logged in.
9. Close voting from the admin panel when all evaluations are in and reveal the winner!

> The participant access code authenticates that participant. Anyone who receives the code can vote in their place; keep it private. All votes live in the same D1 database, not in each phone's localStorage.

## Local development and tests (optional)

Once `wrangler.toml` is filled in:

```bash
npm install
npm test
npx wrangler d1 migrations apply gourmet-challenge-db --local
```

Create a local, **untracked** `.dev.vars` file containing:

```text
ADMIN_PASSWORD=replace-with-your-own-strong-local-password
```

Then run:

```bash
npm run dev
```

Visit the local URL Wrangler prints (usually `http://localhost:8788`). Local database storage is separate from the production database. The `.dev.vars` file is excluded by `.gitignore`.

**Automated test suite:** `npm test` works with Node 22+ even without Cloudflare credentials or installed dependencies. It uses real in-memory SQLite and tests initial setup, all **54 ballots**, blocked self-votes, rating boundaries, ballot edits, locked voting, hidden results, code resetting, roster editing, averages, and ties.

## Troubleshooting

| Problem | Likely cause / fix |
|---|---|
| Site loads but says the server is not configured or `/api/status` is 404 | You're viewing GitHub Pages or another static-only host. Deploy using **Cloudflare Pages** with the `functions/` folder. |
| `Database non configurato` | Check the `DB` D1 binding, `wrangler.toml`, and production environment. |
| `no such table: participants` or generic database error | Apply `npx wrangler d1 migrations apply gourmet-challenge-db --remote` to the correct D1 database. |
| `Admin non configurato` | Set `ADMIN_PASSWORD` in Cloudflare as a secret with at least 12 characters. |
| You lost an access code | Admin → **Rigenera un codice personale**. Old code stops working. |
| A chef tries to vote for themselves | Intentionally blocked by both frontend and backend. |
| Rankings seem different with incomplete participation | They're based on mean scores, not summed points, and are provisional until all **54** ballots arrive. |
| Test files pass, deployment fails | Tests use SQLite + the API handler but do not exercise the live Cloudflare deployment. Check Pages Functions logs and bindings. |

### Privacy and operational notes

- Code hashes, not plain participant codes, are stored in D1. The initial codes are shown once only; a lost code can be regenerated.
- The organizer password lives only in a Cloudflare secret; it is **never** committed to the repository.
- Codes/passwords are stored only in the current browser session, not permanently in localStorage. Log out from shared phones.
- Rankings display aggregated scores only, not a public list of how each person voted.
- Admin can edit the roster **only before the first ballot**, preventing accidental invalidation of results.
- For a friendly dinner competition, code-based identity is practical, but it is not a high-assurance identity verification or anti-collusion system.

**Designed for the Gourmet Challenge at Casa Giuliano/Conti — may the best chef win! 🍷**
