export function isPackagePath(path) {
  return (
    typeof path === "string" &&
    /^\/downloads\/ScoreGuard-(?:scraper|production|streamlit)-v0\.[23456]\.zip$/.test(path)
  );
}
export function isCloudPackagePath(path) {
  return path === "/downloads/ScoreGuard-cloud-v0.7.zip";
}
// Only known local download routes can be resumed after sign-in.
export function loginDestination(value) {
  return isPackagePath(value) ||
    isCloudPackagePath(value) ||
    value === "/downloads/uputstvo" ||
    value === "/downloads/cloud-secrets.toml"
    ? value
    : "/";
}
export function loginPath(value) {
  const target = loginDestination(value);
  return target === "/" ? "/login" : "/login?next=" + encodeURIComponent(target);
}
export function isBrowserNavigation(accept, mode) {
  return mode === "navigate" || /\btext\/html\b/i.test(accept || "");
}
