# Functions

## Deploy

Use the repo-local deploy shortcut from the project root:

```bash
npm run deploy:functions
```

That command automatically sets the higher local Node heap and the Firebase discovery timeout needed by this repo.

If you need to deploy from inside the `functions/` folder directly, use:

```bash
NODE_OPTIONS=--max-old-space-size=8192 FUNCTIONS_DISCOVERY_TIMEOUT=180 firebase deploy --only functions
```
