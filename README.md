# Stock Count – Cosmetic warehouse (WH 1120)

This is a separate system from Milk and Diaper, with its own Google Sheet, Apps Script and app link.

- **Master:** 13,387 materials in 10 zones (A01–A03, B01–B03, C01, C03, F01, F02)
- **Users:** 4 per zone, created automatically, so **40 users**: `A01-001 … A01-004`, …, `F02-001 … F02-004`
- **SAP:** 7,285 materials

Data protection works the same as before:
- Every save waits its turn.
- Scans are stored on the phone first, so they survive reloads and lost Wi-Fi.
- A resent scan is never counted twice.
- A stale edit is refused instead of overwriting.

Scanning uses fast lookups, so it stays quick with large master files and many users.

The **Compare 1120 Cosmetic** tab in the Google Sheet refreshes automatically every 10 minutes. To refresh it immediately, use the Sheet menu **Stock Count → Refresh SAP comparison tabs now**, or the admin button **Update Google Sheet**. The app's own **SAP Comparison** screen is live at all times.

## Setup

1. **Apps Script:** open the Cosmetic Google Sheet, then **Extensions → Apps Script**. Replace everything in Code.gs with `apps-script/Code.gs` from this folder, then save.
2. **Time zone:** ⚙ Project Settings → Time zone **(GMT+03:00) Riyadh**.
3. **Run setup:** select `setup`, click **Run**, then **Review permissions → Advanced → Go to … (unsafe) → Allow**.
4. **Deploy:** **Deploy → New deployment → ⚙ Web app** (Execute as **Me**, Who has access **Anyone**), click **Deploy**, then copy the `/exec` URL.
5. **Connect the app:** paste the URL into `docs/config.js`.
6. **GitHub:** create a new repository `stock-count-cosmetic` (Public). Upload `docs`, `apps-script` and `README.md`, then set **Settings → Pages → main / docs → Save**.
7. **App link:** `https://<github-name>.github.io/stock-count-cosmetic/`
8. **First admin login:** `admin` / `admin123`, then set a new password.
9. **Master data:** upload `Master 1120.xlsx`. This creates the 40 users.
10. **SAP Comparison:** upload `Sap 1120.xlsx`.
11. **Users:** set a personal PIN for each user (the default is 1234).

## Updating the script later
Paste the new Code.gs, then **Deploy → Manage deployments → ✏ → Version: New version → Deploy**. The URL stays the same.
