import 'package:cloud_firestore/cloud_firestore.dart';
import '../core/constants/app_constants.dart';
import '../models/player.dart';

class CaptainService {
  CaptainService(this._db);

  final FirebaseFirestore _db;

  Stream<List<Player>> watchPlayers(String teamId) => _db
      .collection(AppConstants.players)
      .where('teamId', isEqualTo: teamId)
      .snapshots()
      .map((snap) {
        final list = snap.docs.map((doc) => Player.fromJson(doc.data(), doc.id)).toList();
        list.sort((a, b) => a.name.compareTo(b.name));
        return list;
      });

  Future<void> addPlayer({
    required String name,
    required String leagueId,
    required String seasonId,
    required String divisionId,
    required String teamId,
  }) =>
      _db.collection(AppConstants.players).doc().set({
        'name': name.trim(),
        'leagueId': leagueId,
        'seasonId': seasonId,
        'divisionId': divisionId,
        'teamId': teamId,
        'claimedByUserId': null,
        'claimedAt': null,
        'createdAt': FieldValue.serverTimestamp(),
      });

  Future<void> removePlayer(String playerId) =>
      _db.collection(AppConstants.players).doc(playerId).delete();
}