import 'package:cloud_firestore/cloud_firestore.dart';

class JoinCode {
  final String code;
  final String leagueId;
  final String seasonId;
  final String divisionId;
  final String teamId;
  final String role;
  final String createdByUserId;
  final String? usedByUserId;
  final DateTime createdAt;

  const JoinCode({required this.code, required this.leagueId, required this.seasonId, required this.divisionId, required this.teamId, required this.role, required this.createdByUserId, this.usedByUserId, required this.createdAt});

  bool get isUsed => usedByUserId != null;

  factory JoinCode.fromJson(String code, Map<String, dynamic> json) => JoinCode(
        code: code,
        leagueId: json['leagueId'] as String,
        seasonId: json['seasonId'] as String? ?? '',
        divisionId: json['divisionId'] as String? ?? '',
        teamId: json['teamId'] as String,
        role: json['role'] as String,
        createdByUserId: json['createdByUserId'] as String,
        usedByUserId: json['usedByUserId'] as String?,
        createdAt: (json['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      );
}
