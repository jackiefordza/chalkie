import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/app_user.dart';
import '../core/constants/app_constants.dart';

class AuthService {
  final FirebaseAuth _auth;
  final FirebaseFirestore _db;

  AuthService(this._auth, this._db);

  Stream<User?> get authStateChanges => _auth.authStateChanges();
  User? get currentUser => _auth.currentUser;

  Future<UserCredential> signIn(String email, String password) =>
      _auth.signInWithEmailAndPassword(email: email, password: password);

  Future<UserCredential> register({
    required String email,
    required String password,
    required String displayName,
  }) async {
    final credential = await _auth.createUserWithEmailAndPassword(
      email: email,
      password: password,
    );
    await credential.user!.updateDisplayName(displayName);
    final appUser = AppUser(
      uid: credential.user!.uid,
      email: email,
      displayName: displayName,
      role: 'pending',
      createdAt: DateTime.now(),
    );
    await _db
        .collection(AppConstants.users)
        .doc(credential.user!.uid)
        .set(appUser.toJson());
    return credential;
  }

  Future<void> signOut() => _auth.signOut();
}
