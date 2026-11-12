import { validateAccounts } from "./core.mjs";
export function cloudSecrets(config) {
  validateAccounts(config);
  return (
    "# Paste the entire content into Streamlit Advanced settings > Secrets. Keep this file out of GitHub.\nOPERATOR_ACCOUNTS_JSON = " +
    JSON.stringify(JSON.stringify(config)) +
    "\n"
  );
}
