import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/division.dart';
import '../models/join_code.dart';
import '../models/league.dart';
import '../models/season.dart';
import '../models/team.dart';
import '../services/admin_service.dart';
import 'auth_providers.dart';
import 'service_providers.dart';

final adminServiceProvider = Provider<AdminService>((ref) {
  final uid = ref.watch(authStateProvider).valueOrNull?.uid ?? '';
  return AdminService(ref.watch(firestoreProvider), uid);
});

final leagueProvider = StreamProvider.family<League?, String>(
  (ref, leagueId) => ref.watch(adminServiceProvider).watchLeague(leagueId),
);

final seasonsProvider = StreamProvider.family<List<Season>, String>(
  (ref, leagueId) => ref.watch(adminServiceProvider).watchSeasons(leagueId),
);

final divisionsProvider = StreamProvider.family<List<Division>, String>(
  (ref, seasonId) => ref.watch(adminServiceProvider).watchDivisions(seasonId),
);

final teamsProvider = StreamProvider.family<List<Team>, String>(
  (ref, divisionId) => ref.watch(adminServiceProvider).watchTeams(divisionId),
);

final teamProvider = StreamProvider.family<Team?, String>(
  (ref, teamId) => ref.watch(adminServiceProvider).watchTeam(teamId),
);

final activeJoinCodesProvider = StreamProvider.family<List<JoinCode>, String>(
  (ref, teamId) => ref.watch(adminServiceProvider).watchActiveJoinCodes(teamId),
);
