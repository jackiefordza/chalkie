// Single source of truth for the product's user-facing display name.
// "DartGrid" is the current working product name (renamed from "Chalkie" —
// see git history for that rename) — every screen that shows it reads from
// here instead of a literal string, so a future rename is a one-line
// change, not a repo-wide find/replace. Deliberately NOT wired into
// app.json's expo.name/slug/bundleIdentifier/scheme, nor any Firebase
// project ID, Hosting URL, repository name, branch name, package name, or
// other technical identifier containing "chalkie" — those are
// infrastructure/build-time identity, intentionally left unchanged, and a
// separate, much bigger decision than a display-name change; this constant
// only ever affects what's rendered on screen.
export const APP_NAME = 'DartGrid';
