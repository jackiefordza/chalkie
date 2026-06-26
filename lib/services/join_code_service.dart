import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../core/constants/app_constants.dart';

class JoinCodeService {
  JoinCodeService(this._db, this._auth);

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  Future<void> processJoinCode(String code) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw Exception('Not authenticated');

    final trimmed = code.trim().toUpperCase();

    await _db.runTransaction((txn) async {
      final codeRef = _db.collection(AppConstants.joinCodes).doc(trimmed);
      final codeDoc = await txn.get(codeRef);

      if (!codeDoc.exists) throw Exception('Invalid join code');
      final data = codeDoc.data()!;
      if (data['usedByUserId'] != null) throw Exception('Code already used');

      txn.update(codeRef, {
        'usedByUserId': uid,
        'usedAt': FieldValue.serverTimestamp(),
      });

      txn.update(_db.collection(AppConstants.users).doc(uid), {
        'role': data['role'],
        'leagueId': data['leagueId'],
        'teamId': data['teamId'],
        'joinedViaCode': trimmed,
      });
    });
  }
}
