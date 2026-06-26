import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/app_user.dart';
import '../core/constants/app_constants.dart';

class FirestoreService {
  final FirebaseFirestore _db;

  FirestoreService(this._db);

  Stream<AppUser?> watchUser(String uid) {
    return _db
        .collection(AppConstants.users)
        .doc(uid)
        .snapshots()
        .map((doc) => doc.exists ? AppUser.fromJson(doc.id, doc.data()!) : null);
  }
}
