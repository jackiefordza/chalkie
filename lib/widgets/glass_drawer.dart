import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_providers.dart';
import '../providers/service_providers.dart';
import '../providers/theme_provider.dart';

class GlassDrawer extends ConsumerWidget {
  const GlassDrawer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = Theme.of(context).colorScheme;
    final isDark = cs.brightness == Brightness.dark;
    final user = ref.watch(currentUserProvider).valueOrNull;
    final themeMode = ref.watch(themeModeProvider);
    final isDarkMode = themeMode == ThemeMode.dark ||
        (themeMode == ThemeMode.system &&
            MediaQuery.platformBrightnessOf(context) == Brightness.dark);

    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.08)
        : Colors.white.withValues(alpha: 0.5);

    return Drawer(
      backgroundColor: Colors.transparent,
      child: ClipRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
          child: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: isDark
                    ? [
                        const Color(0xFF1A1535).withValues(alpha: 0.92),
                        const Color(0xFF0F0F1A).withValues(alpha: 0.95),
                      ]
                    : [
                        Colors.white.withValues(alpha: 0.75),
                        const Color(0xFFEDE9F7).withValues(alpha: 0.85),
                      ],
              ),
              border: Border(right: BorderSide(color: borderColor, width: 1)),
            ),
            child: SafeArea(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 24, 20, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: LinearGradient(
                              colors: [cs.primary, cs.secondary],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                          ),
                          child: Center(
                            child: Text(
                              (user?.displayName.isNotEmpty == true)
                                  ? user!.displayName[0].toUpperCase()
                                  : '?',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          user?.displayName ?? 'Chalkie',
                          style: TextStyle(
                            color: cs.onSurface,
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        _RoleBadge(role: user?.role ?? ''),
                      ],
                    ),
                  ),
                  Divider(color: borderColor, height: 1),
                  const SizedBox(height: 8),

                  // Nav items
                  if (user?.isAdmin == true) ...[
                    _DrawerItem(icon: Icons.home_outlined, label: 'League home', onTap: () { Navigator.pop(context); context.go('/admin'); }),
                  ],
                  if (user?.isCaptainOrVC == true) ...[
                    _DrawerItem(icon: Icons.groups_outlined, label: 'My team', onTap: () { Navigator.pop(context); context.go('/captain'); }),
                  ],
                  if (user?.isPlayer == true) ...[
                    _DrawerItem(icon: Icons.person_outlined, label: 'My profile', onTap: () { Navigator.pop(context); context.go('/home'); }),
                  ],

                  const Spacer(),
                  Divider(color: borderColor, height: 1),

                  // Theme toggle
                  _DrawerItem(
                    icon: isDarkMode ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
                    label: isDarkMode ? 'Light mode' : 'Dark mode',
                    onTap: () => ref.read(themeModeProvider.notifier).toggle(),
                  ),

                  // Sign out
                  _DrawerItem(
                    icon: Icons.logout,
                    label: 'Sign out',
                    danger: true,
                    onTap: () {
                      Navigator.pop(context);
                      ref.read(authServiceProvider).signOut();
                    },
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DrawerItem extends StatelessWidget {
  const _DrawerItem({required this.icon, required this.label, required this.onTap, this.danger = false});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final color = danger ? cs.error : cs.onSurface;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        child: Row(
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(width: 16),
            Text(label, style: TextStyle(color: color, fontSize: 15, fontWeight: FontWeight.w500)),
          ],
        ),
      ),
    );
  }
}

class _RoleBadge extends StatelessWidget {
  const _RoleBadge({required this.role});
  final String role;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final label = switch (role) {
      'admin' => 'Admin',
      'captain' => 'Captain',
      'viceCaptain' => 'Vice Captain',
      'player' => 'Player',
      _ => 'Pending',
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: cs.primaryContainer,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label, style: TextStyle(color: cs.onPrimaryContainer, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}
