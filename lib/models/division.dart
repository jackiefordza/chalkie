import 'package:cloud_firestore/cloud_firestore.dart';

class Division {
  final String id;
  final String leagueId;
  final String seasonId;
  final String name;
  final int order;
  final DateTime createdAt;

  const Division({required this.id, required this.leagueId, required this.seasonId, required this.name, required this.order, required this.createdAt});

  factory Division.fromJson(String id, Map<String, dynamic> json) => Division(
        id: id,
        leagueId: json['leagueId'] as String,
        seasonId: json['seasonId'] as String,
        name: json['name'] as String,
        order: json['order'] as int? ?? 0,
        createdAt: (json['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      );
}
