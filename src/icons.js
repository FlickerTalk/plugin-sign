// Every icon of the plugin goes through `icon()`, so that painting them another way later (an
// `<ion-icon>`) is a change in one place. Ionicons, outline, as in the app:
// - the ones the app lends (`./icon/<name>.svg`, painted through a CSS mask in the text colour);
// - the two it does not, from the `ionicons` package (MIT, pinned in package.json), inline here as
//   the package ships them: an SVG in the bundle, nothing fetched.

/** The app icons this plugin uses (app `src-tauri/src/plugins.rs`, `ICONS`). */
export const APP_ICONS = ["add-outline", "checkmark-outline", "close-outline", "document-text-outline", "hand-left-outline", "lock-closed-outline", "pencil-outline", "remove-outline", "save-outline", "send-outline", "trash-outline"];

/** Ionicons the app does not lend, as `ionicons@8.1.0/dist/svg/<name>.svg` has them. */
export const OWN_ICONS = {
  "person-outline": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\" class=\"ionicon\"><path d=\"M344 144c-3.92 52.87-44 96-88 96s-84.15-43.12-88-96c-4-55 35-96 88-96s92 42 88 96\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"32px\"/><path d=\"M256 304c-87 0-175.3 48-191.64 138.6C62.39 453.52 68.57 464 80 464h352c11.44 0 17.62-10.48 15.65-21.4C431.3 352 343 304 256 304Z\" fill=\"none\" stroke=\"currentColor\" stroke-miterlimit=\"10\" stroke-width=\"32px\"/></svg>",
  "warning-outline": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\" class=\"ionicon\"><path d=\"M85.57 446.25h340.86a32 32 0 0 0 28.17-47.17L284.18 82.58c-12.09-22.44-44.27-22.44-56.36 0L57.4 399.08a32 32 0 0 0 28.17 47.17\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"32px\"/><path d=\"m250.26 195.39 5.74 122 5.73-121.95a5.74 5.74 0 0 0-5.79-6h0a5.74 5.74 0 0 0-5.68 5.95\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"32px\"/><path fill=\"currentColor\" d=\"M256 397.25a20 20 0 1 1 20-20 20 20 0 0 1-20 20\"/></svg>",
};

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (one) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[one]);

/** The markup of an icon: hidden from a screen reader beside a text, or named by `label` when it
 *  stands alone. */
export function icon(name, { label, slot } = {}) {
  const named = (label === undefined ? 'aria-hidden="true"' : `role="img" aria-label="${escape(label)}"`) + (slot ? ` slot="${slot}"` : "");
  if (APP_ICONS.includes(name)) return `<i class="i" data-icon="${name}" ${named} style="--i:url(./icon/${name}.svg)"></i>`;
  if (name in OWN_ICONS) return `<i class="i own" data-icon="${name}" ${named}>${OWN_ICONS[name]}</i>`;
  throw new Error(`no icon called ${name}`);
}
