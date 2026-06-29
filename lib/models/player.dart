import 'package:cloud_firestore/cloud_firestore.dart';

class Player {
  Player({
    required this.id,
    required this.leagueId,
    required this.seasonId,
    required this.divisionId,
    required this.teamId,
    required this.name,
    this.claimedByUserId,
    this.claimedAt,
    required this.createdAt,
  });

  final String id;
  final String leagueId;
  final String seasonId;
  final String divisionId;
  final String teamId;
  final String name;
  final String? claimedByUserId;
  final DateTime? claimedAt;
  final DateTime createdAt;

  bool get isClaimed => claimedByUserId != null;

  factory Player.fromJson(Map<String, dynamic> json, String id) => Player(
        id: id,
        leagueId: json['leagueId'] as String,
        seasonId: json['seasonId'] as String,
        divisionId: json['divisionId'] as String,
        teamId: json['teamId'] as String,
        name: json['name'] as String,
        claimedByUserId: json['claimedByUserId'] as String?,
        claimedAt: (json['claimedAt'] as Timestamp?)?.toDate(),
        createdAt: (json['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      );
}