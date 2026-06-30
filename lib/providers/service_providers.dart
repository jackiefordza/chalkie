import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/auth_service.dart';
import '../services/firestore_service.dart';
import '../services/join_code_service.dart';

final firebaseAuthProvider =
    Provider<FirebaseAuth>((_) => FirebaseAuth.instance);
final firestoreProvider =
    Provider<FirebaseFirestore>((_) => FirebaseFirestore.instance);

final authServiceProvider = Provider<AuthService>((ref) => AuthService(
      ref.watch(firebaseAuthProvider),
      ref.watch(firestoreProvider),
    ));

final firestoreServiceProvider = Provider<FirestoreService>(
  (ref) => FirestoreService(ref.watch(firestoreProvider)),
);
final joinCodeServiceProvider = Provider<JoinCodeService>((ref) =>
    JoinCodeService(
        ref.watch(firestoreProvider), ref.watch(firebaseAuthProvider)));
