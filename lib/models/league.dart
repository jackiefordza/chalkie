import 'package:cloud_firestore/cloud_firestore.dart';

class League {
  final String id;
  final String name;
  final String adminUserId;
  final DateTime createdAt;

  const League({required this.id, required this.name, required this.adminUserId, required this.createdAt});

  factory League.fromJson(String id, Map<String, dynamic> json) => League(
        id: id,
        name: json['name'] as String,
        adminUserId: json['adminUserId'] as String,
        createdAt: (json['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      );
}
