# meine-geldseite.de Momentum-Tracker 12-1

Abwandlung des [Momentum-Dashboards](https://github.com/thblees/momentum-dashboard): Relative Stärke
über 3, 6 und 12 Monate – jeweils **ohne die letzten 4 Wochen** (klassisches „12-1"-Momentum).
Die letzten 4 Wochen werden nur als ausgegraute Info-Spalte gezeigt und fließen nicht ins Ranking ein.

## Was anders ist als im Original

- `scripts/fetch-yahoo.mjs` lädt 2 Jahre Kurshistorie statt 6 Monate (12M-1 braucht 253 Handelstage).
- `client/src/pages/Home.tsx`: Fenster 3M-1 / 6M-1 / 12M-1 (63/126/252 Handelstage, Ende jeweils 20 Handelstage vor heute),
  paarweiser Punktevergleich wie gehabt, Gleichstand wird über 12M-1 aufgelöst. Spalte „4W (Info)" zusätzlich.
- `vite.config.ts`: `base: "/momentum-12-1-dashboard/"`.
- Cloudflare-Proxy für eigene Ticker wird mit `range=2y` aufgerufen.

## Einrichtung auf GitHub (einmalig)

1. Neues Repo `momentum-12-1-dashboard` unter `thblees` anlegen (public, leer, ohne README).
2. Inhalt dieses Ordners hochladen:
   ```bash
   cd momentum-12-1-dashboard
   git init && git add . && git commit -m "12-1 Momentum Dashboard"
   git branch -M main
   git remote add origin https://github.com/thblees/momentum-12-1-dashboard.git
   git push -u origin main
   ```
3. Repo → Settings → Pages → Source: **GitHub Actions**.
4. Actions-Tab: Workflow „Deploy to GitHub Pages" läuft automatisch beim Push; „Update Yahoo Finance data" einmal
   manuell per „Run workflow" starten. Danach läuft er werktags 21:30 UTC.
5. Dashboard: https://thblees.github.io/momentum-12-1-dashboard/

Hinweis: Falls der Cloudflare Worker `yahoo-finance-proxy` den `range`-Parameter nicht durchreicht, liefern eigene
Ticker (Eingabefeld „Eigener Vergleich") zu wenig Historie und zeigen 0 % bei 12M-1. Dann im Worker `range` aus der Query
übernehmen.

## Lokal bauen

```bash
npm ci
node scripts/fetch-yahoo.mjs
npx vite build
```
