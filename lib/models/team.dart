import 'package:cloud_firestore/cloud_firestore.dart';

class Team {
  final String id;
  final String leagueId;
  final String seasonId;
  final String divisionId;
  final String name;
  final String? captainUserId;
  final String? viceCaptainUserId;
  final DateTime createdAt;

  const Team({required this.id, required this.leagueId, required this.seasonId, required this.divisionId, required this.name, this.captainUserId, this.viceCaptainUserId, required this.createdAt});

  factory Team.fromJson(String id, Map<String, dynamic> json) => Team(
        id: id,
        leagueId: json['leagueId'] as String,
        seasonId: json['seasonId'] as String,
        divisionId: json['divisionId'] as String,
        name: json['name'] as String,
        captainUserId: json['captainUserId'] as String?,
        viceCaptainUserId: json['viceCaptainUserId'] as String?,
        createdAt: (json['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      );
}
