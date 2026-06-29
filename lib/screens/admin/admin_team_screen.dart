import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/admin_providers.dart';
import '../../providers/auth_providers.dart';

class AdminTeamScreen extends ConsumerWidget {
  const AdminTeamScreen({super.key, required this.teamId});
  final String teamId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final leagueId = ref.watch(currentUserProvider).valueOrNull?.leagueId ?? '';
    final teamAsync = ref.watch(teamProvider(teamId));

    return Scaffold(
      appBar: AppBar(title: Text(teamAsync.valueOrNull?.name ?? 'Team')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _JoinCodeSection(label: 'Captain join code', role: 'captain', teamId: teamId, leagueId: leagueId),
            const SizedBox(height: 24),
            _JoinCodeSection(label: 'Vice-captain join code', role: 'viceCaptain', teamId: teamId, leagueId: leagueId),
          ],
        ),
      ),
    );
  }
}

class _JoinCodeSection extends ConsumerWidget {
  const _JoinCodeSection({required this.label, required this.role, required this.teamId, required this.leagueId});
  final String label;
  final String role;
  final String teamId;
  final String leagueId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final code = ref.watch(activeJoinCodesProvider(teamId)).valueOrNull
        ?.where((c) => c.role == role)
        .firstOrNull;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: code == null
                ? Row(
                    children: [
                      Expanded(child: Text('No code generated', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant))),
                      FilledButton.tonal(
                        onPressed: () => ref.read(adminServiceProvider).generateJoinCode(leagueId: leagueId, teamId: teamId, role: role),
                        child: const Text('Generate'),
                      ),
                    ],
                  )
                : code.isUsed
                ? Row(
                    children: [
                      const Icon(Icons.check_circle, color: Colors.green),
                      const SizedBox(width: 8),
                      Expanded(child: Text('Registered (code: ${code.code})', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant))),
                      TextButton(
                        onPressed: () => ref.read(adminServiceProvider).generateJoinCode(leagueId: leagueId, teamId: teamId, role: role),
                        child: const Text('New code'),
                      ),
                    ],
                  )
                : Row(
                    children: [
                      Expanded(
                        child: Text(code.code,
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  letterSpacing: 4,
                                  fontWeight: FontWeight.bold,
                                  color: Theme.of(context).colorScheme.primary,
                                )),
                      ),
                      IconButton(
                        icon: const Icon(Icons.copy),
                        tooltip: 'Copy',
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: code.code));
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Copied: ${code.code}')),
                          );
                        },
                      ),
                      TextButton(
                        onPressed: () => ref.read(adminServiceProvider).generateJoinCode(leagueId: leagueId, teamId: teamId, role: role),
                        child: const Text('Regenerate'),
                      ),
                    ],
                  ),
          ),
        ),
      ],
    );
  }
}
