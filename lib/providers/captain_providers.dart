import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/player.dart';
import '../services/captain_service.dart';
import 'service_providers.dart';

final captainServiceProvider = Provider<CaptainService>(
    (ref) => CaptainService(ref.watch(firestoreProvider)));

final playersProvider =
    StreamProvider.family<List<Player>, String>((ref, teamId) {
  if (teamId.isEmpty) return Stream.value([]);
  return ref.watch(captainServiceProvider).watchPlayers(teamId);
});