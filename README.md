# Clarify – Know Where Your Money Goes

**Clarify** is a sleek, full-stack desktop app for managing your personal finances. It helps you keep track of income and expenses, automatically categorizes your transactions, and gives you monthly and yearly summaries—all in one clean dashboard.

Built with **Electron**, **React (Vite)**, **Express/SQLite**, and **Material-UI**, Clarify aims to create clarity and control over your money.

---

## 🔑 Features

### 💸 Smart Finance Tracking
- **Bank account scraping** - Automatically import transactions from Israeli banks
- **Manual transaction entry** - Add income and expenses manually with a unified interface
- **Unified transaction model** - All financial movements (income and expenses) stored in one table
- **Secure credential management** with end-to-end encryption
- **Category-based tracking** for all expenses  
- **Income management** with manual entry support
- **Monthly & yearly summaries** to see your financial health at a glance  
- **Saved accounts with nicknames** for quick access to your credentials
- **Transaction management** with edit and delete capabilities

### 📊 Analytics & Insights
- Visual breakdown of your income and expenses  
- Spending trends over time  
- Overview of cash flow and category-wise distribution  
- Total Income and Total Expenses widgets for quick overview

### 🔒 Security Features
- End-to-end encryption for sensitive credentials and auth sessions
- OS keychain integration (keytar) for bearer tokens with encrypted file fallback
- Secure credential storage and management
- Bank account credentials stored securely

### 🎯 Account Management
- **Organized account display** with separate sections for bank and credit card accounts
- **Present account operations** with improved UI/UX

---

## 🧰 Tech Stack

- **Renderer**: Electron + React (Vite), TypeScript, Material-UI  
- **Backend**: Embedded Express API (Node.js)  
- **Database**: SQLite (desktop-first) with optional PostgreSQL support  
- **Deployment**: Electron Builder (DMG/NSIS/AppImage)  
- **Bank Integration**: [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers)

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v20 or higher)  
- PostgreSQL (v16 or higher)  
- Docker & Docker Compose (optional, for container deployment)

---

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/clarify/clarify-expenses.git  
   cd clarify-expenses
   ```

2. **Install dependencies**
   ```bash
   npm install            # root tooling + shared scripts
   npm --prefix app install
   npm --prefix renderer install
   ```

3. **Create a `.env` file** (or copy `.env.example` and adjust values):
   ```bash
   cp .env.example .env
   ```

   Update the copy with your database credentials and a strong `CLARIFY_ENCRYPTION_KEY` (32 bytes recommended). Other toggles are documented below.

   If you have access to the shared secrets vault, populate `scripts/secrets-map.json` with the
   relevant 1Password item paths and run:
   ```bash
   npm run pull-secrets
   ```
   This generates `app/.env.local`, refreshes signing assets under `~/.config/shekelsync/signing/`,
   and keeps local values aligned with CI.

4. **Start the desktop development stack**
   ```bash
   npm run dev:electron
   ```

  This spins up the Vite renderer alongside the Electron shell using the shared configuration
  (`USE_VITE_RENDERER=true`), so UI changes hot-reload automatically.

   Auth/session state is automatically sealed in the host OS keychain (via `keytar`) with an encrypted file fallback at
   `Electron.userData/secure-store/session.enc`. Ensure `CLARIFY_ENCRYPTION_KEY` is configured so the desktop build can
   encrypt the fallback store when the keychain is unavailable.

5. **Run the full test suite (Vitest + Playwright)**
   ```bash
   npm run test
   ```

### Development Tips & Environment Toggles

| Variable | Default | Purpose |
| --- | --- | --- |
| `USE_VITE_RENDERER` | `true` (via `npm run dev:electron`) | Switches Electron to the Vite-powered renderer during development. This is the only supported renderer path. |
| `RENDERER_DEV_URL` | `http://localhost:5173` | Override if the Vite dev server runs on a different host/port. |
| `ALLOW_DB_MIGRATE` | `false` | Enable before hitting migration endpoints in non-production environments. |
| `SKIP_EMBEDDED_API` | `false` | Disable the embedded Express API (e.g., when pointing Electron at an external backend). |
| `CLARIFY_ENCRYPTION_KEY` | _none_ | **Required.** 64-character hex string (32 bytes) used for credential & session encryption. |
| `ALLOW_DEV_NO_ENCRYPTION` | `false` | Set to `true` only for local experiments when you do not have an encryption key (app will fallback to a derived dev key). |

Export these variables in your shell or prefix the command, for example:

```bash
RENDERER_DEV_URL=http://localhost:6006 npm run dev:electron
```

> **Note:** `CLARIFY_ENCRYPTION_KEY` must be a 64-character hex string (32 bytes). If you are just experimenting locally, you can set `ALLOW_DEV_NO_ENCRYPTION=true` to fall back to a derived development key, but this should never be used in production because credentials and session metadata rely on this key.

> **Linux users:** `keytar` depends on `libsecret`. Install it via `sudo apt install libsecret-1-dev` (or the equivalent for your distro) before running the Electron app.

---

### 🐳 Docker Deployment

1. Build and run the app using Docker:
   ```bash
   docker-compose up -d
   ```

2. Open your browser at:  
   http://localhost:3000

---

## 🗂 Project Structure

```
clarify-expenses/
├── app/                    # Shared libraries + Express routes used by Electron
│   ├── components/         # React building blocks consumed by the Vite renderer
│   ├── server/             # Express routers/services with Vitest coverage
│   ├── lib/                # Helpers (API client, encryption, session store, etc.)
│   └── package.json        # Electron builder scripts and dependencies
├── renderer/               # Vite renderer bundled into the Electron app
├── electron/               # Main / preload / embedded API server wiring
├── docs/                   # Architecture, transition, and packaging notes
├── scripts/                # Tooling (DB init, secrets sync, packaging helpers, ...)
├── .github/workflows/      # CI definitions (tests + packaging)
└── README.md               # You're reading it
```

## 📚 Further Reading

- [Electron Transition Plan](docs/electron-transition-plan.md)
- [Packaging Roadmap](docs/packaging-roadmap.md)
- [Platform Dependencies](docs/platform-dependencies.md)
- [Auth & Session Storage](docs/auth-session-storage.md)
- [Testing Strategy](docs/testing-strategy.md)
- [Signing Setup](docs/signing-setup.md)
- [Auto-Update Strategy](docs/auto-update.md)
- [Release Checklist](docs/release-checklist.md)

---

## 📦 Environment Variables

| Variable      | Description               |  
|---------------|---------------------------|  
| CLARIFY_DB_USER       | PostgreSQL username       |  
| CLARIFY_DB_HOST       | PostgreSQL host           |  
| CLARIFY_DB_NAME       | Database name             |  
| CLARIFY_DB_PASSWORD   | PostgreSQL password       |  
| CLARIFY_DB_PORT       | Database port (default: 5432) |
| CLARIFY_ENCRYPTION_KEY| Key for credential encryption (required) |

---

## 🔄 Recent Updates

### Bank Account Scraping Support
- **Unified Transaction Model**: All financial data (income and expenses) now stored in a single `transactions` table
- **Bank Account Integration**: Support for scraping transactions directly from Israeli bank accounts
- **Simplified Dashboard**: Streamlined to show Total Income and Total Expenses with category breakdown
- **Removed Legacy Components**: Eliminated separate income table and complex transaction categorization
- **Clean Architecture**: Simplified database schema and API structure for better maintainability

---

### 📸 Screenshots

#### Dashboard Overview
![Dashboard](app/public/screenshots/dashboard.png)

#### Expenses
![Transactions](app/public/screenshots/category_example.png)

#### Category Management
##### Merger
![Analytics](app/public/screenshots/category_management.png)
##### Rules
![Analytics](app/public/screenshots/category_management_rules.png)

#### Bank Transactions
![Analytics](app/public/screenshots/bank_transactions.png)

#### Account Management
![Analytics](app/public/screenshots/account_management.png)

---

## 🤝 Contributing

Contributions are welcome! If you have suggestions, bug reports, or feature requests, open an issue or submit a pull request.

---

## 📄 License

This project is licensed under the MIT License. See the LICENSE file for more details.

---

## 💬 Support

For support, open an issue in this repository.

---

## 🙌 Credits

- Bank scraping integration powered by [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers)
