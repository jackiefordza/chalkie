import 'package:cloud_firestore/cloud_firestore.dart';

class AppUser {
  final String uid;
  final String email;
  final String displayName;
  final String role;
  final String? leagueId;
  final String? teamId;
  final String? divisionId;
  final String? playerId;
  final DateTime createdAt;

  const AppUser({
    required this.uid,
    required this.email,
    required this.displayName,
    required this.role,
    this.leagueId,
    this.teamId,
    this.divisionId,
    this.playerId,
    required this.createdAt,
  });

  bool get isAdmin => role == 'admin';
  bool get isCaptain => role == 'captain';
  bool get isViceCaptain => role == 'viceCaptain';
  bool get isCaptainOrVC => role == 'captain' || role == 'viceCaptain';
  bool get isPlayer => role == 'player';
  bool get isPending => role == 'pending';

  factory AppUser.fromJson(String uid, Map<String, dynamic> json) {
    return AppUser(
      uid: uid,
      email: json['email'] as String,
      displayName: json['displayName'] as String,
      role: json['role'] as String,
      leagueId: json['leagueId'] as String?,
      teamId: json['teamId'] as String?,
      divisionId: json['divisionId'] as String?,
      playerId: json['playerId'] as String?,
      createdAt: json['createdAt'] != null
          ? (json['createdAt'] as Timestamp).toDate()
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() => {
        'email': email,
        'displayName': displayName,
        'role': role,
        'leagueId': leagueId,
        'teamId': teamId,
        'divisionId': divisionId,
        'playerId': playerId,
        'createdAt': Timestamp.fromDate(createdAt),
      };
}
