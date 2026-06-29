import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_providers.dart';
import '../screens/auth/login_screen.dart';
import '../screens/auth/register_screen.dart';
import '../screens/auth/join_code_screen.dart';
import '../screens/admin/admin_home_screen.dart';
import '../screens/admin/admin_setup_screen.dart';
import '../screens/admin/admin_season_screen.dart';
import '../screens/admin/admin_division_screen.dart';
import '../screens/admin/admin_team_screen.dart';
import '../screens/captain/captain_home_screen.dart';
import '../screens/player/player_home_screen.dart';


final routerProvider = Provider<GoRouter>((ref) {
  final router = GoRouter(
    initialLocation: '/login',
    redirect: (context, state) {
      final isLoggedIn = ref.read(authStateProvider).valueOrNull != null;
      final loc = state.matchedLocation;
      final onAuthPage = loc == '/login' || loc == '/register';

      if (!isLoggedIn) return onAuthPage ? null : '/login';

      final appUser = ref.read(currentUserProvider).valueOrNull;
      if (appUser == null) return null;

      // Pending — can only be on /join
      if (appUser.isPending) return loc == '/join' ? null : '/join';

      // Admin
      if (appUser.isAdmin) {
        if (appUser.leagueId == null) return loc == '/admin/setup' ? null : '/admin/setup';
        if (loc == '/admin/setup' || onAuthPage) return '/admin';
        return null;
      }

      // Captain / VC
      if (appUser.isCaptainOrVC) {
        if (onAuthPage || loc == '/join') return '/captain';
        return null;
      }

      // Player
      if (onAuthPage || loc == '/join') return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/login',    builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),
      GoRoute(path: '/join',     builder: (_, __) => const JoinCodeScreen()),
      GoRoute(
        path: '/admin',
        builder: (_, __) => const AdminHomeScreen(),
        routes: [
          GoRoute(path: 'setup', builder: (_, __) => const AdminSetupScreen()),
          GoRoute(
            path: 'seasons/:sid',
            builder: (_, s) => AdminSeasonScreen(seasonId: s.pathParameters['sid']!),
            routes: [
              GoRoute(
                path: 'divisions/:did',
                builder: (_, s) => AdminDivisionScreen(
                  seasonId: s.pathParameters['sid']!,
                  divisionId: s.pathParameters['did']!,
                ),
              ),
            ],
          ),
          GoRoute(
            path: 'teams/:tid',
            builder: (_, s) => AdminTeamScreen(teamId: s.pathParameters['tid']!),
          ),
        ],
      ),
      GoRoute(path: '/captain', builder: (_, __) => const CaptainHomeScreen()),
      GoRoute(path: '/home',    builder: (_, __) => const PlayerHomeScreen()),
    ],
  );
  ref.listen(authStateProvider,   (_, __) => router.refresh());
  ref.listen(currentUserProvider, (_, __) => router.refresh());
  return router;
});
