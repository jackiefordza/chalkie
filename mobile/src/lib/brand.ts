// Single source of truth for the product's user-facing display name.
// "Chalkie" is a working name, not expected to be the final public product
// name — every screen that shows it reads from here instead of a literal
// string, so the eventual rename is a one-line change, not a repo-wide
// find/replace. Deliberately NOT wired into app.json's expo.name/slug/
// bundleIdentifier/scheme — those are build-time native app identity
// (App Store listing, URL scheme, package name) and changing them is a
// separate, much bigger decision than this UI pass; this constant only
// ever affects what's rendered on screen.
export const APP_NAME = 'Chalkie';
