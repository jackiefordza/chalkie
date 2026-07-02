import { Redirect } from 'expo-router';

// Legacy route — onboarding now starts at find-league
export default function JoinRedirect() {
  return <Redirect href="/(protected)/find-league" />;
}
