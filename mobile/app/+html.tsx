import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Expo Router's web build uses whatever this file exports as the ROOT html
// document (see https://docs.expo.dev/router/reference/static-rendering/).
// Without this file, Expo Router falls back to a default template whose
// viewport meta omits `viewport-fit=cover` — on iOS Safari, that means
// `env(safe-area-inset-*)` (which react-native-safe-area-context's web
// implementation reads) resolves to 0 everywhere, not the device's real
// notch/home-indicator insets. Concretely: the floating TabBar
// (components/ui/TabBar.tsx) and AccountMenu both call
// useSafeAreaInsets() to clear the home indicator / notch — without
// viewport-fit=cover those calls silently return zero on a real iPhone's
// Safari/Chrome, so the tab bar can sit flush against (or under) the home
// indicator instead of floating clear of it. This is the one-line fix for
// that, app-wide.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        {/* Prevents a flash-of-unstyled-root-scrollbar on the web build's
            outermost ScrollView — Expo Router's own documented reset. */}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// Keeps the <html>/<body> background in sync with the app's own bg/bg-dark
// tokens (mobile/src/lib/theme.ts's RAW.bg / RAW.bgDark) via the OS-level
// `prefers-color-scheme` media query — otherwise the page's native
// scroll-bounce/overscroll area on mobile Safari flashes the browser's
// default white, outside the app's own light/dark surface entirely.
const responsiveBackground = `
body {
  background-color: #F7F3EA;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #0F1320;
  }
}
`;
