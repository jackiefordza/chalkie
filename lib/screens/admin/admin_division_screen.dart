import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/admin_providers.dart';
import '../../providers/auth_providers.dart';

class AdminDivisionScreen extends ConsumerWidget {
  const AdminDivisionScreen({super.key, required this.seasonId, required this.divisionId});
  final String seasonId;
  final String divisionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final leagueId = ref.watch(currentUserProvider).valueOrNull?.leagueId ?? '';
    final division = ref.watch(divisionsProvider(seasonId)).valueOrNull
        

        ?.where((d) => d.id == divisionId).firstOrNull;
    final teamsAsync = ref.watch(teamsProvider(divisionId));

    return Scaffold(
      appBar: AppBar(title: Text(division?.name ?? 'Division')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddTeam(context, ref, leagueId),
        icon: const Icon(Icons.add),
        label: const Text('Add team'),
      ),
      body: teamsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (teams) => teams.isEmpty
            ? const Center(child: Text('No teams yet — tap + to add one'))
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: teams.length,
                itemBuilder: (_, i) {
                  final t = teams[i];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: const CircleAvatar(child: Icon(Icons.people)),
                      title: Text(t.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(t.captainUserId != null ? 'Captain assigned' : 'No captain yet'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/admin/teams/${t.id}'),
                    ),
                  );
                },
              ),
      ),
    );
  }

  Future<void> _showAddTeam(BuildContext context, WidgetRef ref, String leagueId) async {
    final ctrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add team'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(labelText: 'Team name', border: OutlineInputBorder()),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              final name = ctrl.text.trim();
              if (name.isEmpty) return;
              Navigator.pop(ctx);
              await ref.read(adminServiceProvider).createTeam(
                    leagueId: leagueId, seasonId: seasonId,
                    divisionId: divisionId, name: name,
                  );
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
    ctrl.dispose();
  }
}
