import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../core/constants/app_constants.dart';

class JoinCodeService {
  JoinCodeService(this._db, this._auth);

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  Future<void> processJoinCode(String code) async {
    final currentUser = _auth.currentUser;
    if (currentUser == null) throw Exception('Not authenticated');
    final uid = currentUser.uid;
    final displayName = currentUser.displayName ?? currentUser.email ?? 'Unknown';

    final trimmed = code.trim().toUpperCase();
    final playerRef = _db.collection(AppConstants.players).doc();

    await _db.runTransaction((txn) async {
      final codeRef = _db.collection(AppConstants.joinCodes).doc(trimmed);
      final codeDoc = await txn.get(codeRef);

      if (!codeDoc.exists) throw Exception('Invalid join code');
      final data = codeDoc.data()!;
      if (data['usedByUserId'] != null) throw Exception('Code already used');

      final role = data['role'] as String;
      final leagueId = data['leagueId'] as String;
      final teamId = data['teamId'] as String;
      final seasonId = data['seasonId'] as String;
      final divisionId = data['divisionId'] as String;

      txn.update(codeRef, {
        'usedByUserId': uid,
        'usedAt': FieldValue.serverTimestamp(),
      });

      txn.set(playerRef, {
        'leagueId': leagueId,
        'seasonId': seasonId,
        'divisionId': divisionId,
        'teamId': teamId,
        'name': displayName,
        'claimedByUserId': uid,
        'claimedAt': FieldValue.serverTimestamp(),
        'createdAt': FieldValue.serverTimestamp(),
      });

      txn.update(_db.collection(AppConstants.users).doc(uid), {
        'role': role,
        'leagueId': leagueId,
        'teamId': teamId,
        'divisionId': divisionId,
        'playerId': playerRef.id,
        'joinedViaCode': trimmed,
      });

      final teamField = role == 'viceCaptain' ? 'viceCaptainUserId' : 'captainUserId';
      txn.update(_db.collection(AppConstants.teams).doc(teamId), {
        teamField: uid,
      });
    });
  }
}
