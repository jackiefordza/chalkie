import { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';
import {
  collection, doc, onSnapshot, query, where,
  getDoc, writeBatch, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { RAW, type SemanticTone } from '@/lib/theme';
import { Screen, Heading, Body, Caption, Button, Card, Badge, ListRow, Input, Label, Sheet, AppIcon } from '@/components/ui';

interface Season { id: string; name: string; status: string }

const SEASON_STATUS_TONE: Record<string, SemanticTone> = {
  active: 'sage',
  upcoming: 'butter',
  completed: 'brand',
};

export default function AdminHomeScreen() {
  const { appUser, isLoading, logOut } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const leagueId = appUser?.leagueId ?? null;

  const [leagueName, setLeagueName] = useState('');
  const [leagueExists, setLeagueExists] = useState<boolean | null>(null); // null = checking
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [disputeCount, setDisputeCount] = useState(0);

  // New season modal
  const [showSeasonModal, setShowSeasonModal] = useState(false);
  const [newSeasonName, setNewSeasonName] = useState('');
  const [isCreatingSeason, setIsCreatingSeason] = useState(false);

  const [setupLeagueName, setSetupLeagueName] = useState('');
  const [isCreatingLeague, setIsCreatingLeague] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  async function handleCreateLeague() {
    if (!setupLeagueName.trim() || !appUser) return;
    setSetupError(null);
    setIsCreatingLeague(true);
    try {
      const batch = writeBatch(db);
      const leagueRef = doc(collection(db, 'leagues'));
      batch.set(leagueRef, {
        name: setupLeagueName.trim(),
        adminUserId: appUser.uid,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', appUser.uid), { leagueId: leagueRef.id });
      await batch.commit();
      // Stay on null (spinner) — onSnapshot updates leagueId → useEffect checks Firestore → sets leagueExists(true)
    } catch (e: unknown) {
      setSetupError((e as Error).message ?? 'Something went wrong');
      setIsCreatingLeague(false);
    }
  }

  // Load league info + live subscriptions
  useEffect(() => {
    if (!leagueId) {
      setLeagueExists(false);
      return;
    }

    let cancelled = false;
    getDoc(doc(db, 'leagues', leagueId)).then((snap) => {
      if (cancelled) return;
      if (snap.exists()) {
        setLeagueExists(true);
        setLeagueName(snap.data().name);
      } else {
        setLeagueExists(false);
      }
    });

    const unsubSeasons = onSnapshot(
      query(collection(db, 'seasons'), where('leagueId', '==', leagueId)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Season))
          .sort((a, b) => (b as any).createdAt?.seconds - (a as any).createdAt?.seconds);
        setSeasons(list);
      },
    );

    // Lightweight — just counts, for the Inbox nav row badge. May slightly
    // overcount vs admin-inbox.tsx's actual list (a VC request on a team that
    // already has a captain belongs to that captain, not admin) — acceptable
    // for a badge, the inbox screen itself filters precisely.
    const unsubReqs = onSnapshot(
      query(
        collection(db, 'joinRequests'),
        where('leagueId', '==', leagueId),
        where('requestType', '==', 'captainRole'),
        where('status', '==', 'pending'),
      ),
      (snap) => setPendingCount(snap.size),
    );
    const unsubDisputes = onSnapshot(
      query(collection(db, 'matches'), where('leagueId', '==', leagueId), where('status', '==', 'disputed')),
      (snap) => setDisputeCount(snap.size),
    );

    return () => { cancelled = true; unsubSeasons(); unsubReqs(); unsubDisputes(); };
  }, [leagueId]); // appUser intentionally excluded — new object ref on every onSnapshot would restart subscriptions

  async function createSeason() {
    if (!newSeasonName.trim() || !leagueId) return;
    setIsCreatingSeason(true);
    await addDoc(collection(db, 'seasons'), {
      leagueId,
      name: newSeasonName.trim(),
      status: 'upcoming',
      createdAt: serverTimestamp(),
    });
    setNewSeasonName('');
    setShowSeasonModal(false);
    setIsCreatingSeason(false);
  }

  // Auth still loading, or leagueId is set but we haven't confirmed the doc exists yet
  if (isLoading || (leagueId && leagueExists === null)) {
    return (
      <View className="flex-1 items-center justify-center bg-bg dark:bg-bg-dark">
        <ActivityIndicator color={RAW.brand} size="large" />
      </View>
    );
  }

  // Show setup if no leagueId or league doc doesn't exist in Firestore
  if (!leagueId || leagueExists === false) {
    return (
      <View className="flex-1 bg-bg dark:bg-bg-dark justify-center px-5">
        <Card>
          <Heading size="lg" className="mb-1.5">Set up your league</Heading>
          <Body size="sm" className="mb-7">
            One-time setup — this is the name players will search for when joining.
          </Body>
          {setupError ? (
            <Card tone="coral" className="mb-4" padded={false}>
              <Body tone="coral" className="p-3">{setupError}</Body>
            </Card>
          ) : null}
          <Label>League name</Label>
          <Input
            value={setupLeagueName}
            onChangeText={setSetupLeagueName}
            placeholder="e.g. Midlands Darts League"
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={handleCreateLeague}
            className="mb-6"
          />
          <Button onPress={handleCreateLeague} disabled={isCreatingLeague || !setupLeagueName.trim()} loading={isCreatingLeague}>
            Create League
          </Button>
        </Card>
      </View>
    );
  }

  return (
    <Screen>
      {/* League banner */}
      <Card className="mb-5 flex-row items-center">
        <View className="w-11 h-11 rounded-full items-center justify-center bg-brand-fill dark:bg-brand-fill-dark mr-3">
          <AppIcon name="trophy" size={22} color={isDark ? RAW.brandInkDark : RAW.brandInk} />
        </View>
        <View className="flex-1">
          <Caption className="mb-0.5">Your League</Caption>
          <Heading>{leagueName || '…'}</Heading>
        </View>
        <Badge tone="brand">Admin</Badge>
      </Card>

      {/* Inbox / Tools */}
      <View className="gap-2 mb-5">
        <ListRow
          title="Inbox"
          subtitle="Pending requests & disputed results"
          trailing={
            <View className="flex-row items-center gap-2">
              {pendingCount + disputeCount > 0 && <Badge tone="coral">{pendingCount + disputeCount}</Badge>}
              <Body tone="dim">›</Body>
            </View>
          }
          onPress={() => router.push('/(protected)/admin-inbox')}
        />
        <ListRow
          title="Tools"
          subtitle="Testing utilities"
          trailing={<Body tone="dim">›</Body>}
          onPress={() => router.push('/(protected)/admin-tools')}
        />
      </View>

      {/* Seasons */}
      <View className="flex-row items-center mb-3">
        <Heading size="sm" className="flex-1">Seasons</Heading>
        <Button size="sm" onPress={() => setShowSeasonModal(true)}>+ New Season</Button>
      </View>

      {seasons.length === 0 ? (
        <Body className="text-center py-5">No seasons yet — create one to get started</Body>
      ) : (
        <View className="gap-2">
          {seasons.map((season) => (
            <ListRow
              key={season.id}
              title={season.name}
              trailing={
                <View className="flex-row items-center gap-2">
                  <Badge tone={SEASON_STATUS_TONE[season.status] ?? 'brand'}>{season.status}</Badge>
                  <Body tone="dim">›</Body>
                </View>
              }
              onPress={() => router.push(`/(protected)/admin-season?seasonId=${season.id}`)}
            />
          ))}
        </View>
      )}

      {/* Sign out */}
      <Button variant="ghost" className="mt-6" onPress={logOut}>Sign Out</Button>

      {/* New season modal */}
      <Sheet visible={showSeasonModal} onClose={() => { setShowSeasonModal(false); setNewSeasonName(''); }}>
        <Heading size="lg" className="mb-5">New Season</Heading>
        <Label>Season name</Label>
        <Input value={newSeasonName} onChangeText={setNewSeasonName} placeholder="e.g. 2025/26" autoFocus className="mb-5" />
        <View className="flex-row gap-2.5">
          <Button variant="ghost" className="flex-1" onPress={() => { setShowSeasonModal(false); setNewSeasonName(''); }}>Cancel</Button>
          <Button className="flex-1" disabled={isCreatingSeason || !newSeasonName.trim()} loading={isCreatingSeason} onPress={createSeason}>
            Create
          </Button>
        </View>
      </Sheet>
    </Screen>
  );
}
