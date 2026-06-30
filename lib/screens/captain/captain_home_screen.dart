import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/team.dart';
import '../../providers/auth_providers.dart';
import '../../providers/admin_providers.dart';
import '../../providers/captain_providers.dart';
import '../../widgets/glass_button.dart';
import '../../widgets/glass_card.dart';
import '../../widgets/gradient_scaffold.dart';

class CaptainHomeScreen extends ConsumerWidget {
  const CaptainHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).valueOrNull;
    final teamId = user?.teamId ?? '';
    final teamAsync = ref.watch(teamProvider(teamId));

    return GradientScaffold(
      showDrawer: true,
      title: teamAsync.when(
        data: (team) => Text(team?.name ?? 'My Team'),
        loading: () => const Text('Loading...'),
        error: (_, __) => const Text('My Team'),
      ),
      child: teamAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (team) => team == null
            ? const Center(child: Text('Team not found'))
            : _TeamBody(team: team, user: user),
      ),
    );
  }
}

class _TeamBody extends ConsumerWidget {
  const _TeamBody({required this.team, required this.user});
  final Team team;
  final dynamic user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = Theme.of(context).colorScheme;
    final playersAsync = ref.watch(playersProvider(team.id));
    final roleLabel = user?.role == 'viceCaptain' ? 'Vice Captain' : 'Captain';

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Role chip
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              decoration: BoxDecoration(
                color: cs.primaryContainer,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(roleLabel,
                  style: TextStyle(
                      color: cs.onPrimaryContainer,
                      fontWeight: FontWeight.w600,
                      fontSize: 12)),
            ),
            const SizedBox(height: 20),

            // Players header
            Row(
              children: [
                Text('Players',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700)),
                const Spacer(),
                playersAsync.when(
                  data: (p) => Text('${p.length}',
                      style: TextStyle(color: cs.onSurfaceVariant, fontSize: 14)),
                  loading: () => const SizedBox.shrink(),
                  error: (_, __) => const SizedBox.shrink(),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Player list
            Expanded(
              child: playersAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => Center(child: Text('Error: $e')),
                data: (players) => players.isEmpty
                    ? GlassCard(
                        child: Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.group_add_outlined,
                                  size: 48, color: cs.onSurfaceVariant),
                              const SizedBox(height: 12),
                              Text('No players yet',
                                  style: TextStyle(
                                      color: cs.onSurfaceVariant,
                                      fontWeight: FontWeight.w500)),
                              const SizedBox(height: 4),
                              Text('Tap + to add your first player',
                                  style: TextStyle(
                                      color: cs.onSurfaceVariant, fontSize: 13)),
                            ],
                          ),
                        ),
                      )
                    : ListView.separated(
                        itemCount: players.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, i) {
                          final player = players[i];
                          return GlassCard(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 12),
                            borderRadius: 14,
                            child: Row(
                              children: [
                                CircleAvatar(
                                  radius: 20,
                                  backgroundColor: cs.primaryContainer,
                                  child: Text(
                                    player.name[0].toUpperCase(),
                                    style: TextStyle(
                                        color: cs.onPrimaryContainer,
                                        fontWeight: FontWeight.w700),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(player.name,
                                          style: const TextStyle(
                                              fontWeight: FontWeight.w600)),
                                      if (player.isClaimed)
                                        Text('Registered',
                                            style: TextStyle(
                                                color: Colors.green.shade600,
                                                fontSize: 12)),
                                    ],
                                  ),
                                ),
                                if (!player.isClaimed)
                                  IconButton(
                                    icon: Icon(Icons.delete_outline,
                                        color: cs.error, size: 20),
                                    onPressed: () =>
                                        _confirmRemove(context, ref, player.id, player.name),
                                  ),
                              ],
                            ),
                          );
                        },
                      ),
              ),
            ),

            const SizedBox(height: 16),
            GlassButton(
              onPressed: () => _showAddPlayerDialog(context, ref),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.person_add_outlined, size: 18),
                  SizedBox(width: 8),
                  Text('Add player'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showAddPlayerDialog(BuildContext context, WidgetRef ref) async {
    final ctrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Add player'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(
              labelText: 'Player name'),
          onSubmitted: (_) => Navigator.pop(ctx, true),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          GlassButton(
            onPressed: () => Navigator.pop(ctx, true),
            expand: false,
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (confirmed != true || ctrl.text.trim().isEmpty) return;
    await ref.read(captainServiceProvider).addPlayer(
          name: ctrl.text.trim(),
          leagueId: team.leagueId,
          seasonId: team.seasonId,
          divisionId: team.divisionId,
          teamId: team.id,
        );
  }

  Future<void> _confirmRemove(
      BuildContext context, WidgetRef ref, String playerId, String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Remove player'),
        content: Text('Remove "$name" from the roster?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          GlassButton(
            onPressed: () => Navigator.pop(ctx, true),
            expand: false,
            danger: true,
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(captainServiceProvider).removePlayer(playerId);
    }
  }
}
