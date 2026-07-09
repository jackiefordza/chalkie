import { useState, useEffect } from 'react';
import { View, Alert, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import {
  collection, doc, onSnapshot, query, where,
  writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW } from '@/lib/theme';
import { Screen, Heading, Body, Button, Card, ListRow, AppBar, AppIcon } from '@/components/ui';
import type { JoinRequest } from '@/types';

interface TeamInfo {
  name: string; captainUserId: string | null; viceCaptainUserId: string | null;
  seasonId: string; divisionId: string;
}
interface DisputedMatch { id: string; homeTeamId: string; awayTeamId: string }

const ROLE_LABEL = { captain: 'Captain', viceCaptain: 'Vice Captain' } as const;

export default function AdminInboxScreen() {
  const { appUser } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const leagueId = appUser?.leagueId ?? null;

  const [captainRequests, setCaptainRequests] = useState<JoinRequest[]>([]);
  const [disputes, setDisputes] = useState<DisputedMatch[]>([]);
  const [teams, setTeams] = useState<Record<string, TeamInfo>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;

    const unsubReqs = onSnapshot(
      query(
        collection(db, 'joinRequests'),
        where('leagueId', '==', leagueId),
        where('requestType', '==', 'captainRole'),
        where('status', '==', 'pending'),
      ),
      (snap) => setCaptainRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as JoinRequest))),
    );

    const unsubDisputes = onSnapshot(
      query(collection(db, 'matches'), where('leagueId', '==', leagueId), where('status', '==', 'disputed')),
      (snap) => setDisputes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DisputedMatch))),
    );

    const unsubTeams = onSnapshot(
      query(collection(db, 'teams'), where('leagueId', '==', leagueId)),
      (snap) => {
        const map: Record<string, TeamInfo> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          map[d.id] = {
            name: data.name, captainUserId: data.captainUserId ?? null,
            viceCaptainUserId: data.viceCaptainUserId ?? null,
            seasonId: data.seasonId, divisionId: data.divisionId,
          };
        });
        setTeams(map);
      },
    );

    return () => { unsubReqs(); unsubDisputes(); unsubTeams(); };
  }, [leagueId]);

  const teamNames: Record<string, string> = {};
  Object.entries(teams).forEach(([id, t]) => { teamNames[id] = t.name; });

  // Admin only handles: a request for Captain, or a request for VC on a team
  // that has no captain yet. A VC request on a team that already has a
  // captain is that captain's call, not admin's — see Captains > Inbox.
  const actionableRequests = captainRequests.filter((r) => (
    r.requestedRole === 'captain' || !teams[r.teamId]?.captainUserId
  ));

  async function approveRequest(req: JoinRequest) {
    if (!appUser?.leagueId || !req.requestedRole) return;
    const team = teams[req.teamId];
    if (!team) return;

    setApprovingId(req.id);
    try {
      const batch = writeBatch(db);

      const playerRef = doc(collection(db, 'players'));
      batch.set(playerRef, {
        name: req.displayName,
        leagueId: appUser.leagueId,
        seasonId: team.seasonId,
        divisionId: team.divisionId,
        teamId: req.teamId,
        claimedByUserId: req.userId,
        claimedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        createdByUserId: appUser.uid,
      });

      const teamField = req.requestedRole === 'viceCaptain' ? 'viceCaptainUserId' : 'captainUserId';
      batch.update(doc(db, 'teams', req.teamId), { [teamField]: req.userId });

      // Demote whoever currently holds this slot — otherwise they keep
      // role: 'captain'/'viceCaptain' (and the write access that comes with
      // it) even after the team record moves on to someone else.
      const outgoingUserId = req.requestedRole === 'viceCaptain' ? team.viceCaptainUserId : team.captainUserId;
      if (outgoingUserId && outgoingUserId !== req.userId) {
        batch.update(doc(db, 'users', outgoingUserId), { role: 'player' });
      }

      batch.update(doc(db, 'joinRequests', req.id), {
        status: 'approved',
        approvedAt: serverTimestamp(),
        approvedByUserId: appUser.uid,
      });

      batch.update(doc(db, 'users', req.userId), {
        role: req.requestedRole,
        teamId: req.teamId,
        leagueId: appUser.leagueId,
        divisionId: team.divisionId,
        seasonId: team.seasonId,
        playerId: playerRef.id,
        pendingRequestType: null,
        pendingRequestId: null,
      });

      await batch.commit();
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setApprovingId(null);
    }
  }

  async function rejectRequest(req: JoinRequest) {
    Alert.alert(
      'Reject request',
      `Reject ${req.displayName}'s request to join ${req.teamName} as ${req.requestedRole ? ROLE_LABEL[req.requestedRole] : 'captain/VC'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject', style: 'destructive',
          onPress: async () => {
            const batch = writeBatch(db);
            batch.update(doc(db, 'joinRequests', req.id), { status: 'rejected', rejectedAt: serverTimestamp() });
            batch.update(doc(db, 'users', req.userId), { pendingRequestType: null, pendingRequestId: null });
            await batch.commit();
          },
        },
      ],
    );
  }

  return (
    <Screen header={<AppBar title="Inbox" />}>
      <Stack.Screen options={{ headerShown: false }} />

      {actionableRequests.length === 0 && disputes.length === 0 ? (
        <Card className="items-center py-8">
          <Body tone="strong" weight="semibold">All caught up</Body>
          <Body size="sm" className="text-center mt-1">No pending requests or disputed results right now.</Body>
        </Card>
      ) : (
        <>
          {actionableRequests.length > 0 && (
            <View className="mb-5">
              <Heading size="sm" className="mb-2.5">⏳ Captain / VC Requests ({actionableRequests.length})</Heading>
              {actionableRequests.map((req) => (
                <Card key={req.id} tone="coral" className="mb-2.5">
                  <Body tone="strong" weight="bold">{req.displayName}</Body>
                  <Body size="sm" className="mb-3.5">
                    Wants to be {req.requestedRole ? ROLE_LABEL[req.requestedRole] : '…'} of {req.teamName}
                  </Body>
                  <View className="flex-row gap-2.5">
                    <Button
                      variant="good"
                      className="flex-1"
                      disabled={approvingId === req.id}
                      loading={approvingId === req.id}
                      onPress={() => approveRequest(req)}
                    >
                      Approve
                    </Button>
                    <Button variant="danger" className="flex-1" disabled={approvingId === req.id} onPress={() => rejectRequest(req)}>
                      Reject
                    </Button>
                  </View>
                </Card>
              ))}
            </View>
          )}

          {disputes.length > 0 && (
            <View className="mb-5">
              <View className="flex-row items-center gap-1.5 mb-2.5">
                <AppIcon name="warning" size={16} color={isDark ? RAW.coralInkDark : RAW.coralInk} />
                <Heading size="sm">Disputed Results ({disputes.length})</Heading>
              </View>
              <View className="gap-2">
                {disputes.map((match) => (
                  <ListRow
                    key={match.id}
                    title={`${teamNames[match.homeTeamId] ?? '…'} vs ${teamNames[match.awayTeamId] ?? '…'}`}
                    trailing={<Body tone="coral" weight="semibold">Resolve ›</Body>}
                    onPress={() => router.push(`/(protected)/admin-dispute?matchId=${match.id}`)}
                  />
                ))}
              </View>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
