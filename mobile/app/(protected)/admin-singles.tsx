import { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Alert } from '@/lib/alert';
import { parseDateInput, formatDateInput, formatDate } from '@/lib/dates';
import { RAW, type SemanticTone } from '@/lib/theme';
import {
  Screen, Heading, Body, Caption, Badge, Button, Card, Chip, Input, Label, Sheet, AppBar,
} from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';
import type { SinglesCompetition, SinglesTie, SinglesTieStatus, MatchLeg, MatchSide, HighCheckout } from '@/types';

const DESKTOP_BREAKPOINT = 768;

interface SeasonInfo { id: string; name: string }
interface PlayerInfo { id: string; name: string }

const TIE_STATUS_LABEL: Record<SinglesTieStatus, string> = {
  pending: 'Waiting',
  ready: 'Ready',
  confirmed: 'Final',
  bye: 'Bye',
};

const TIE_STATUS_TONE: Record<SinglesTieStatus, SemanticTone | null> = {
  pending: null,
  ready: null,
  confirmed: 'sage',
  bye: 'butter',
};

// Same cosmetic-only preview as admin-cup.tsx's previewRounds — see that
// file's comment for why duplicating this tiny bit of display logic is fine
// (the real draw is only ever computed once, server-side).
function previewRounds(entrantCount: number): string[] {
  if (entrantCount < 2) return [];
  let bracketSize = 1;
  while (bracketSize < entrantCount) bracketSize *= 2;
  const names: string[] = [];
  let slots = bracketSize;
  while (slots >= 2) {
    names.push(slots === 2 ? 'Final' : slots === 4 ? 'Semi-Final' : slots === 8 ? 'Quarter-Final' : `Round of ${slots}`);
    slots /= 2;
  }
  return names;
}

function roundName(entrantsInRound: number): string {
  return entrantsInRound === 2 ? 'Final' : entrantsInRound === 4 ? 'Semi-Final' : entrantsInRound === 8 ? 'Quarter-Final' : `Round of ${entrantsInRound}`;
}

interface DraftLeg { winner: MatchSide | null; oneEighties: string[]; highCheckout: HighCheckout | null }

function blankLeg(): DraftLeg {
  return { winner: null, oneEighties: [], highCheckout: null };
}

export default function AdminSinglesScreen() {
  const { appUser } = useAuthStore();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const leagueId = appUser?.leagueId ?? null;

  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [eligiblePlayers, setEligiblePlayers] = useState<PlayerInfo[]>([]);
  const [allPlayerNames, setAllPlayerNames] = useState<Record<string, string>>({});
  const [competitions, setCompetitions] = useState<SinglesCompetition[]>([]);
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [ties, setTies] = useState<SinglesTie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [compName, setCompName] = useState('Singles Competition');
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [eventDateText, setEventDateText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [entryTie, setEntryTie] = useState<SinglesTie | null>(null);
  const [legs, setLegs] = useState<DraftLeg[]>([blankLeg(), blankLeg()]);
  const [isSaving, setIsSaving] = useState(false);
  const [checkoutModal, setCheckoutModal] = useState<{ legIndex: number } | null>(null);
  const [checkoutPlayerId, setCheckoutPlayerId] = useState<string | null>(null);
  const [checkoutValue, setCheckoutValue] = useState('');

  useEffect(() => {
    if (!leagueId) return;
    const onErr = (e: unknown) => { setLoadError((e as Error).message ?? 'Something went wrong'); setIsLoading(false); };
    const unsubSeasons = onSnapshot(
      query(collection(db, 'seasons'), where('leagueId', '==', leagueId)),
      (snap) => {
        setSeasons(snap.docs.map((d) => ({ id: d.id, name: d.data().name })).sort((a, b) => b.name.localeCompare(a.name)));
        setIsLoading(false);
      },
      onErr,
    );
    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('leagueId', '==', leagueId)),
      (snap) => {
        const names: Record<string, string> = {};
        snap.docs.forEach((d) => { names[d.id] = d.data().name; });
        setAllPlayerNames(names);
      },
      onErr,
    );
    return () => { unsubSeasons(); unsubPlayers(); };
  }, [leagueId]);

  // Eligible = has actually played a league game this season (playerSeasonStats.played > 0),
  // not just "on a roster" — a player who's never taken the oche yet shouldn't be
  // drawable into a knockout. playerSeasonStats reads are open to any signed-in
  // user (see firestore.rules), so this needs no leagueId filter to satisfy the rule.
  useEffect(() => {
    if (!seasonId) { setEligiblePlayers([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'playerSeasonStats'), where('seasonId', '==', seasonId)),
      (snap) => {
        const ids = snap.docs.filter((d) => (d.data().played ?? 0) > 0).map((d) => d.data().playerId as string);
        setEligiblePlayers(
          ids.map((id) => ({ id, name: allPlayerNames[id] ?? '…' })).sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [seasonId, allPlayerNames]);

  useEffect(() => {
    if (!leagueId || !seasonId) { setCompetitions([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'singlesCompetitions'), where('leagueId', '==', leagueId), where('seasonId', '==', seasonId)),
      (snap) => setCompetitions(snap.docs.map((d) => ({
        id: d.id, ...d.data(), eventDate: d.data().eventDate?.toDate() ?? new Date(), createdAt: d.data().createdAt?.toDate() ?? new Date(),
      } as SinglesCompetition))),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [leagueId, seasonId]);

  useEffect(() => {
    setSelectedCompId(competitions.length === 1 ? competitions[0].id : null);
  }, [competitions]);

  useEffect(() => {
    if (!leagueId || !selectedCompId) { setTies([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'singlesTies'), where('leagueId', '==', leagueId), where('competitionId', '==', selectedCompId)),
      (snap) => setTies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SinglesTie))),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [leagueId, selectedCompId]);

  function openCreate() {
    setSelectedPlayerIds(new Set(eligiblePlayers.map((p) => p.id)));
    setCompName('Singles Competition');
    setEventDateText('');
    setCreateError(null);
    setShowCreate(true);
  }

  function togglePlayer(playerId: string) {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId); else next.add(playerId);
      return next;
    });
  }

  async function createCompetition() {
    setCreateError(null);
    if (!leagueId || !seasonId) return;
    if (!compName.trim()) { setCreateError('Give the competition a name'); return; }
    if (selectedPlayerIds.size < 2) { setCreateError('Pick at least 2 players'); return; }
    const eventDate = parseDateInput(eventDateText);
    if (!eventDate) { setCreateError('Enter the event date as YYYY-MM-DD'); return; }

    setIsCreating(true);
    try {
      const result = await httpsCallable(functions, 'adminCreateSinglesCompetition')({
        leagueId, seasonId, name: compName.trim(), playerIds: [...selectedPlayerIds],
        eventDate: formatDateInput(eventDate),
      });
      const { competitionId } = result.data as { competitionId: string };
      setSelectedCompId(competitionId);
      setShowCreate(false);
    } catch (e: unknown) {
      setCreateError((e as Error).message ?? 'Something went wrong');
    } finally {
      setIsCreating(false);
    }
  }

  const selectedComp = competitions.find((c) => c.id === selectedCompId) ?? null;

  function confirmDeleteCompetition() {
    if (!selectedComp) return;
    Alert.alert(
      'Delete this competition',
      `Delete "${selectedComp.name}" and its entire bracket? Blocked if any tie has a confirmed result. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteCompetition },
      ],
    );
  }

  async function deleteCompetition() {
    if (!selectedComp) return;
    setIsDeleting(true);
    try {
      await httpsCallable(functions, 'adminDeleteSinglesCompetition')({ competitionId: selectedComp.id });
      setSelectedCompId(null);
    } catch (e: unknown) {
      Alert.alert("Can't delete competition", (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsDeleting(false);
    }
  }

  const roundsWithTies = useMemo(() => {
    const byRound = new Map<number, SinglesTie[]>();
    ties.forEach((t) => { if (!byRound.has(t.round)) byRound.set(t.round, []); byRound.get(t.round)!.push(t); });
    const rounds = [...byRound.keys()].sort((a, b) => a - b);
    const maxRound = rounds[rounds.length - 1] ?? 0;
    return rounds.map((round) => {
      const roundTies = byRound.get(round)!.sort((a, b) => a.id.localeCompare(b.id));
      const entrantsInRound = roundTies.length * 2;
      // The Final's own entrant-count math (2) always resolves right; earlier
      // rounds use the actual tie count in that round, which already accounts
      // for how many byes/entrants there were.
      const name = round === maxRound && roundTies.length === 1 ? 'Final' : roundName(entrantsInRound);
      return { round, name, ties: roundTies };
    });
  }, [ties]);

  function playerName(id: string | null): string {
    if (!id) return 'TBD';
    return allPlayerNames[id] ?? '…';
  }

  function tieLabel(tie: SinglesTie): string {
    if (tie.status === 'bye') return `${playerName(tie.homePlayerId)} — bye`;
    return `${playerName(tie.homePlayerId)} vs ${playerName(tie.awayPlayerId)}`;
  }

  function openEntry(tie: SinglesTie) {
    if (tie.status === 'bye' || tie.status === 'pending') return;
    setEntryTie(tie);
    if (tie.legs && tie.legs.length > 0) {
      setLegs(tie.legs.map((l) => ({ winner: l.winner, oneEighties: [...l.oneEighties], highCheckout: l.highCheckout })));
    } else {
      setLegs([blankLeg(), blankLeg()]);
    }
  }

  function setLegWinner(legIndex: number, winner: MatchSide) {
    setLegs((prev) => {
      const next = prev.map((l, i) => (i === legIndex ? { ...l, winner } : l));
      // Best of 3: a 3rd leg only exists once the first two split 1-1 —
      // otherwise the tie's already decided and a decider would be a dead
      // rubber. Deliberately checked against legs 0/1 only, never the full
      // array — checking the full array would flip back to "no decider
      // needed" the instant leg 3 itself gets a winner (2-1 overall is no
      // longer 1-1), truncating the very leg just being recorded.
      const needsDecider = !!next[0].winner && !!next[1].winner && next[0].winner !== next[1].winner;
      if (needsDecider && next.length < 3) next.push(blankLeg());
      if (!needsDecider && next.length > 2) next.length = 2;
      return next;
    });
  }

  function addOneEighty(legIndex: number, playerId: string) {
    setLegs((prev) => prev.map((l, i) => (i === legIndex ? { ...l, oneEighties: [...l.oneEighties, playerId] } : l)));
  }
  function removeOneEighty(legIndex: number, playerId: string) {
    setLegs((prev) => prev.map((l, i) => {
      if (i !== legIndex) return l;
      const list = [...l.oneEighties];
      const idx = list.lastIndexOf(playerId);
      if (idx !== -1) list.splice(idx, 1);
      return { ...l, oneEighties: list };
    }));
  }

  function openAddCheckout(legIndex: number) {
    setCheckoutPlayerId(null);
    setCheckoutValue('');
    setCheckoutModal({ legIndex });
  }
  function saveCheckout() {
    if (!checkoutModal || !checkoutPlayerId || !checkoutValue.trim()) return;
    const { legIndex } = checkoutModal;
    setLegs((prev) => prev.map((l, i) => (i === legIndex ? { ...l, highCheckout: { playerId: checkoutPlayerId, value: checkoutValue.trim() } } : l)));
    setCheckoutModal(null);
  }
  function removeCheckout() {
    if (!checkoutModal) return;
    const { legIndex } = checkoutModal;
    setLegs((prev) => prev.map((l, i) => (i === legIndex ? { ...l, highCheckout: null } : l)));
    setCheckoutModal(null);
  }

  const decided = legs.length >= 2 && legs[0].winner && legs[1].winner
    && (legs[0].winner === legs[1].winner || (legs.length === 3 && !!legs[2].winner));

  async function saveResult() {
    if (!entryTie || !decided) return;
    setIsSaving(true);
    try {
      const finalLegs: MatchLeg[] = legs.filter((l) => l.winner).map((l) => ({
        winner: l.winner as MatchSide, oneEighties: l.oneEighties, highCheckout: l.highCheckout,
      }));
      await updateDoc(doc(db, 'singlesTies', entryTie.id), { status: 'confirmed', legs: finalLegs });
      setEntryTie(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSaving(false);
    }
  }

  const preview = previewRounds(selectedPlayerIds.size);

  const body = (
    <>
      <View className="flex-row items-center mb-4">
        <Heading size="sm" className="flex-1">Season</Heading>
      </View>
      {seasons.length === 0 ? (
        <Card className="items-center py-6 mb-5">
          <Body size="sm">No seasons yet — create one from the Dashboard first.</Body>
        </Card>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-5" contentContainerStyle={{ gap: 8 }}>
          {seasons.map((s) => (
            <Chip key={s.id} label={s.name} selected={seasonId === s.id} onPress={() => setSeasonId(s.id)} />
          ))}
        </ScrollView>
      )}

      {loadError ? (
        <Card tone="coral"><Body tone="coral">{loadError}</Body></Card>
      ) : isLoading ? (
        <ActivityIndicator color={RAW.brand} style={{ marginTop: 40 }} />
      ) : !seasonId ? (
        <Card className="items-center py-8">
          <Body tone="strong" weight="semibold">Pick a season above</Body>
        </Card>
      ) : competitions.length === 0 ? (
        <Card>
          <Heading size="lg" className="mb-1.5">Singles Competition</Heading>
          <Body size="sm" className="mb-5">
            {eligiblePlayers.length} player{eligiblePlayers.length === 1 ? '' : 's'} eligible (have played a
            league game this season). Draws a single-elimination bracket, best of 3 legs per tie, played
            through in one night — enter each result as it happens.
          </Body>
          <Button onPress={openCreate} disabled={eligiblePlayers.length < 2}>Create &amp; Draw Competition</Button>
          {eligiblePlayers.length < 2 && <Body size="xs" className="mt-2">Needs at least 2 players who've played a league game this season.</Body>}
        </Card>
      ) : competitions.length > 1 && !selectedCompId ? (
        <View className="gap-2">
          {competitions.map((c) => (
            <TouchableOpacity
              key={c.id}
              activeOpacity={0.7}
              onPress={() => setSelectedCompId(c.id)}
              className="p-4 rounded-2xl bg-surface-2 dark:bg-surface-2-dark"
            >
              <Body tone="strong" weight="semibold">{c.name}</Body>
              <Body size="sm">{c.playerIds.length} players · {c.status}</Body>
            </TouchableOpacity>
          ))}
        </View>
      ) : selectedComp ? (
        <>
          <View className="flex-row items-center justify-between mb-4">
            <View>
              <Heading size="lg">{selectedComp.name}</Heading>
              <Body size="sm">
                {selectedComp.status === 'completed' && selectedComp.winnerPlayerId
                  ? `Winner: ${playerName(selectedComp.winnerPlayerId)}`
                  : `${selectedComp.playerIds.length} players · ${formatDate(selectedComp.eventDate)}`}
              </Body>
            </View>
            <Button variant="danger" size="sm" disabled={isDeleting} loading={isDeleting} onPress={confirmDeleteCompetition}>
              Delete
            </Button>
          </View>

          {roundsWithTies.map(({ round, name, ties: roundTies }) => (
            <Card key={round} className="mb-4" padded={false}>
              <View className="p-4 border-b border-border dark:border-border-dark">
                <Heading size="sm">{name}</Heading>
              </View>
              {roundTies.map((tie, i) => {
                const tone = TIE_STATUS_TONE[tie.status];
                const tappable = tie.status === 'ready' || tie.status === 'confirmed';
                return (
                  <TouchableOpacity
                    key={tie.id}
                    activeOpacity={tappable ? 0.6 : 1}
                    onPress={() => openEntry(tie)}
                    className={[
                      'flex-row items-center justify-between px-4 py-3',
                      i < roundTies.length - 1 ? 'border-b border-border dark:border-border-dark' : '',
                    ].join(' ')}
                  >
                    <Body tone="strong" weight="semibold" numberOfLines={1} className="flex-1 mr-2">{tieLabel(tie)}</Body>
                    {tie.status === 'confirmed' && (
                      <Body size="sm" className="mr-3">{tie.homeLegsWon}-{tie.awayLegsWon}</Body>
                    )}
                    {tone ? <Badge tone={tone}>{TIE_STATUS_LABEL[tie.status]}</Badge> : <Body size="sm">{TIE_STATUS_LABEL[tie.status]}</Body>}
                  </TouchableOpacity>
                );
              })}
            </Card>
          ))}
        </>
      ) : null}

      <Sheet visible={showCreate} onClose={() => setShowCreate(false)}>
        <ScrollView>
          <Heading size="lg" className="mb-4">Create &amp; Draw Competition</Heading>

          <Label>Name</Label>
          <Input value={compName} onChangeText={setCompName} autoCapitalize="words" className="mb-4" />

          <Label>Event date (YYYY-MM-DD)</Label>
          <Input value={eventDateText} onChangeText={setEventDateText} placeholder="e.g. 2026-07-01" autoCapitalize="none" autoCorrect={false} className="mb-4" />

          <Label>Players entering ({selectedPlayerIds.size})</Label>
          <View className="flex-row flex-wrap gap-2 mb-2">
            {eligiblePlayers.map((p) => (
              <Chip key={p.id} label={p.name} selected={selectedPlayerIds.has(p.id)} onPress={() => togglePlayer(p.id)} />
            ))}
          </View>

          {preview.length > 0 && (
            <Body size="xs" className="mb-4">
              Bracket: {[...preview].reverse().join(' → ')}
              {selectedPlayerIds.size > 0 && (2 ** Math.ceil(Math.log2(selectedPlayerIds.size))) !== selectedPlayerIds.size
                ? ` (${(2 ** Math.ceil(Math.log2(selectedPlayerIds.size))) - selectedPlayerIds.size} bye${(2 ** Math.ceil(Math.log2(selectedPlayerIds.size))) - selectedPlayerIds.size === 1 ? '' : 's'} in round 1)`
                : ''}
            </Body>
          )}

          {createError && (
            <Card tone="coral" className="mb-4" padded={false}>
              <Body tone="coral" className="p-3">{createError}</Body>
            </Card>
          )}

          <View className="flex-row gap-2.5">
            <Button variant="ghost" className="flex-1" disabled={isCreating} onPress={() => setShowCreate(false)}>Cancel</Button>
            <Button className="flex-1" disabled={isCreating || selectedPlayerIds.size < 2} loading={isCreating} onPress={createCompetition}>
              Draw Bracket
            </Button>
          </View>
        </ScrollView>
      </Sheet>

      {/* Result entry — no lineup picking needed (the two players are already
          fixed by the tie itself), just leg-by-leg winner + optional 180s/
          checkout, best of 3. Admin enters and confirms in one action — no
          submit-and-wait, since there's no separate captain on each side. */}
      <Sheet visible={!!entryTie} onClose={() => setEntryTie(null)}>
        <ScrollView>
          <Heading size="lg" className="mb-1">
            {entryTie ? `${playerName(entryTie.homePlayerId)} vs ${playerName(entryTie.awayPlayerId)}` : ''}
          </Heading>
          <Body size="sm" className="mb-5">Best of 3 legs — tap a name to record the leg winner.</Body>

          {entryTie && legs.map((leg, legIndex) => {
            const homeId = entryTie.homePlayerId!;
            const awayId = entryTie.awayPlayerId!;
            const participants = [homeId, awayId];
            return (
              <Card key={legIndex} className="mb-3.5">
                <Caption className="mb-2">Leg {legIndex + 1}{legIndex === 2 ? ' (decider)' : ''}</Caption>
                <View className="flex-row gap-2.5 mb-3.5">
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setLegWinner(legIndex, 'home')}
                    className={['flex-1 items-center px-3 py-3 rounded-xl', leg.winner === 'home' ? 'bg-sage-fill dark:bg-sage-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark'].join(' ')}
                  >
                    <Body tone={leg.winner === 'home' ? 'sage' : 'strong'} weight="semibold">{playerName(homeId)}</Body>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setLegWinner(legIndex, 'away')}
                    className={['flex-1 items-center px-3 py-3 rounded-xl', leg.winner === 'away' ? 'bg-sage-fill dark:bg-sage-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark'].join(' ')}
                  >
                    <Body tone={leg.winner === 'away' ? 'sage' : 'strong'} weight="semibold">{playerName(awayId)}</Body>
                  </TouchableOpacity>
                </View>

                <Caption className="mb-1.5">180s (tap to add, tap − to remove)</Caption>
                <View className="flex-row flex-wrap gap-2 mb-3.5">
                  {participants.map((id) => {
                    const count = leg.oneEighties.filter((x) => x === id).length;
                    const active = count > 0;
                    return (
                      <View key={id} className={['flex-row min-h-[44px] rounded-full items-center pl-1', active ? 'bg-butter-fill dark:bg-butter-fill-dark' : 'bg-surface-2 dark:bg-surface-2-dark'].join(' ')}>
                        <TouchableOpacity activeOpacity={0.7} onPress={() => addOneEighty(legIndex, id)} className="px-2.5 py-2.5">
                          <Body size="sm" tone={active ? 'butter' : 'dim'} weight="semibold">{playerName(id)}{active ? ` × ${count}` : ''}</Body>
                        </TouchableOpacity>
                        {active && (
                          <TouchableOpacity activeOpacity={0.7} onPress={() => removeOneEighty(legIndex, id)} hitSlop={8} className="px-3 py-2.5 border-l border-border dark:border-border-dark">
                            <Body tone="butter" weight="bold">−</Body>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>

                <Caption className="mb-1.5">High checkout</Caption>
                <View className="flex-row flex-wrap gap-2">
                  {leg.highCheckout && (
                    <Chip tone="butter" selected onPress={() => { setCheckoutPlayerId(leg.highCheckout!.playerId); setCheckoutValue(leg.highCheckout!.value); setCheckoutModal({ legIndex }); }} label={`${playerName(leg.highCheckout.playerId)} — ${leg.highCheckout.value}`} />
                  )}
                  {!leg.highCheckout && <Chip onPress={() => openAddCheckout(legIndex)} label="+ Add high checkout" />}
                </View>
              </Card>
            );
          })}

          <View className="flex-row gap-2.5 mt-2">
            <Button variant="ghost" className="flex-1" disabled={isSaving} onPress={() => setEntryTie(null)}>Cancel</Button>
            <Button className="flex-1" disabled={!decided || isSaving} loading={isSaving} onPress={saveResult}>Save Result</Button>
          </View>
        </ScrollView>
      </Sheet>

      <Sheet visible={!!checkoutModal} onClose={() => setCheckoutModal(null)}>
        <Heading className="mb-4">High Checkout</Heading>
        <Label>Player</Label>
        <View className="flex-row flex-wrap gap-1.5 mb-4">
          {entryTie && [entryTie.homePlayerId, entryTie.awayPlayerId].filter((id): id is string => !!id).map((id) => (
            <Chip key={id} label={playerName(id)} selected={checkoutPlayerId === id} onPress={() => setCheckoutPlayerId(id)} />
          ))}
        </View>
        <Label>Checkout (free text, e.g. "121")</Label>
        <Input value={checkoutValue} onChangeText={setCheckoutValue} placeholder="e.g. 121" className="mb-5" />
        <View className="flex-row gap-2.5">
          <Button variant="ghost" className="flex-1" onPress={() => setCheckoutModal(null)}>Cancel</Button>
          {checkoutModal && legs[checkoutModal.legIndex]?.highCheckout && (
            <Button variant="danger" className="flex-1" onPress={removeCheckout}>Remove</Button>
          )}
          <Button className="flex-1" disabled={!checkoutPlayerId || !checkoutValue.trim()} onPress={saveCheckout}>Save</Button>
        </View>
      </Sheet>
    </>
  );

  if (isDesktop) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell title="Singles Competition" breadcrumb={[{ label: 'Dashboard', path: '/(protected)/(tabs)/admin' }, { label: 'Singles' }]}>
          <View style={{ maxWidth: 780 }}>{body}</View>
        </AdminShell>
      </>
    );
  }

  return (
    <Screen header={<AppBar title="Singles" />}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
    </Screen>
  );
}
