import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../core/constants/app_constants.dart';
import '../models/division.dart';
import '../models/join_code.dart';
import '../models/league.dart';
import '../models/season.dart';
import '../models/team.dart';

class AdminService {
  final FirebaseFirestore _db;
  final String adminUid;

  AdminService(this._db, this.adminUid);

  Future<void> createLeague(String name) async {
    final batch = _db.batch();
    final leagueRef = _db.collection(AppConstants.leagues).doc();
    batch.set(leagueRef, {
      'name': name,
      'adminUserId': adminUid,
      'createdAt': FieldValue.serverTimestamp(),
    });
    batch.update(_db.collection(AppConstants.users).doc(adminUid), {
      'leagueId': leagueRef.id,
    });
    await batch.commit();
  }

  Stream<League?> watchLeague(String leagueId) => _db
      .collection(AppConstants.leagues)
      .doc(leagueId)
      .snapshots()
      .map((d) => d.exists ? League.fromJson(d.id, d.data()!) : null);

  Future<void> createSeason(String leagueId, String name) async {
    await _db.collection(AppConstants.seasons).doc().set({
      'leagueId': leagueId,
      'name': name,
      'status': 'upcoming',
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updateSeasonStatus(String seasonId, String status) =>
      _db.collection(AppConstants.seasons).doc(seasonId).update({'status': status});

  Stream<List<Season>> watchSeasons(String leagueId) => _db
      .collection(AppConstants.seasons)
      .where('leagueId', isEqualTo: leagueId)
      .snapshots()
      .map((s) {
        final list = s.docs.map((d) => Season.fromJson(d.id, d.data())).toList();
        list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
        return list;
      });

  Future<void> createDivision({
    required String leagueId,
    required String seasonId,
    required String name,
    required int order,
  }) async {
    await _db.collection(AppConstants.divisions).doc().set({
      'leagueId': leagueId,
      'seasonId': seasonId,
      'name': name,
      'order': order,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Stream<List<Division>> watchDivisions(String seasonId) => _db
      .collection(AppConstants.divisions)
      .where('seasonId', isEqualTo: seasonId)
      .snapshots()
      .map((s) {
        final list = s.docs.map((d) => Division.fromJson(d.id, d.data())).toList();
        list.sort((a, b) => a.order.compareTo(b.order));
        return list;
      });

  Future<void> createTeam({
    required String leagueId,
    required String seasonId,
    required String divisionId,
    required String name,
  }) async {
    await _db.collection(AppConstants.teams).doc().set({
      'leagueId': leagueId,
      'seasonId': seasonId,
      'divisionId': divisionId,
      'name': name,
      'captainUserId': null,
      'viceCaptainUserId': null,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Stream<List<Team>> watchTeams(String divisionId) => _db
      .collection(AppConstants.teams)
      .where('divisionId', isEqualTo: divisionId)
      .snapshots()
      .map((s) {
        final list = s.docs.map((d) => Team.fromJson(d.id, d.data())).toList();
        list.sort((a, b) => a.name.compareTo(b.name));
        return list;
      });

  Stream<Team?> watchTeam(String teamId) => _db
      .collection(AppConstants.teams)
      .doc(teamId)
      .snapshots()
      .map((d) => d.exists ? Team.fromJson(d.id, d.data()!) : null);

  Future<String> generateJoinCode({
    required String leagueId,
    required String teamId,
    required String role,
  }) async {
    final teamDoc = await _db.collection(AppConstants.teams).doc(teamId).get();
    final teamData = teamDoc.data()!;

    final existingSnap = await _db
        .collection(AppConstants.joinCodes)
        .where('teamId', isEqualTo: teamId)
        .where('role', isEqualTo: role)
        .get();
    final unusedDocs = existingSnap.docs
        .where((d) => d.data()['usedByUserId'] == null)
        .toList();
    final batch = _db.batch();
    for (final doc in unusedDocs) {
      batch.delete(doc.reference);
    }
    final code = _generateCode();
    batch.set(_db.collection(AppConstants.joinCodes).doc(code), {
      'leagueId': leagueId,
      'seasonId': teamData['seasonId'],
      'divisionId': teamData['divisionId'],
      'teamId': teamId,
      'role': role,
      'createdByUserId': adminUid,
      'usedByUserId': null,
      'usedAt': null,
      'createdAt': FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return code;
  }

  Stream<List<JoinCode>> watchActiveJoinCodes(String teamId) => _db
      .collection(AppConstants.joinCodes)
      .where('teamId', isEqualTo: teamId)
      .snapshots()
      .map((s) => s.docs.map((d) => JoinCode.fromJson(d.id, d.data())).toList());

  String _generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    final rng = Random.secure();
    return List.generate(8, (_) => chars[rng.nextInt(chars.length)]).join();
  }
}
