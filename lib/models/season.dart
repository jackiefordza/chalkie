import 'package:cloud_firestore/cloud_firestore.dart';

enum SeasonStatus { upcoming, active, completed }

extension SeasonStatusX on SeasonStatus {
  String get value => name;
  String get label => switch (this) {
        SeasonStatus.upcoming => 'Upcoming',
        SeasonStatus.active => 'Active',
        SeasonStatus.completed => 'Completed',
      };
}

SeasonStatus seasonStatusFromString(String v) =>
    SeasonStatus.values.firstWhere((e) => e.name == v, orElse: () => SeasonStatus.upcoming);

class Season {
  final String id;
  final String leagueId;
  final String name;
  final SeasonStatus status;
  final DateTime createdAt;

  const Season({required this.id, required this.leagueId, required this.name, required this.status, required this.createdAt});

  factory Season.fromJson(String id, Map<String, dynamic> json) => Season(
        id: id,
        leagueId: json['leagueId'] as String,
        name: json['name'] as String,
        status: seasonStatusFromString(json['status'] as String? ?? 'upcoming'),
        createdAt: (json['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      );
}
