import { router } from 'expo-router';

// router.back() is a silent no-op when the current screen has no push history
// (e.g. the user landed here via a direct URL/refresh on web, or a deep link).
// Fall back to replacing with a known-good route instead of leaving them stuck.
export function goBack(fallback: string = '/') {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback as Parameters<typeof router.replace>[0]);
  }
}
