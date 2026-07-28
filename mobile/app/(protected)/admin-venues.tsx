import { useState, useEffect } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { collection, doc, onSnapshot, query, where, orderBy, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Alert } from '@/lib/alert';
import { Screen, Heading, Body, Button, Card, ListRow, Input, Label, Sheet, AppBar } from '@/components/ui';
import { AdminShell } from '@/components/admin/AdminShell';
import type { Venue } from '@/types';

const DESKTOP_BREAKPOINT = 768;

export default function AdminVenuesScreen() {
  const { appUser } = useAuthStore();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const leagueId = appUser?.leagueId ?? null;

  const [venues, setVenues] = useState<Venue[]>([]);
  const [editing, setEditing] = useState<Venue | 'new' | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [venuePhone, setVenuePhone] = useState('');
  const [boardCount, setBoardCount] = useState('1');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = onSnapshot(
      query(collection(db, 'venues'), where('leagueId', '==', leagueId), orderBy('name', 'asc')),
      (snap) => setVenues(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Venue))),
      (e) => Alert.alert('Error', (e as Error).message ?? 'Something went wrong'),
    );
    return unsub;
  }, [leagueId]);

  function openNew() {
    setName('');
    setAddress('');
    setVenuePhone('');
    setBoardCount('1');
    setEditing('new');
  }

  function openEdit(venue: Venue) {
    setName(venue.name);
    setAddress(venue.address ?? '');
    setVenuePhone(venue.venuePhone ?? '');
    setBoardCount(String(venue.boardCount));
    setEditing(venue);
  }

  async function save() {
    if (!leagueId) return;
    const boards = Number(boardCount);
    if (!name.trim() || !Number.isFinite(boards) || boards < 1) return;
    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        address: address.trim() || null,
        venuePhone: venuePhone.trim() || null,
        boardCount: boards,
      };
      if (editing === 'new') {
        await addDoc(collection(db, 'venues'), { ...payload, leagueId, createdAt: serverTimestamp() });
      } else if (editing) {
        await updateDoc(doc(db, 'venues', editing.id), payload);
      }
      setEditing(null);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsSaving(false);
    }
  }

  function confirmDelete(venue: Venue) {
    Alert.alert(
      'Delete venue',
      `Delete ${venue.name}? Blocked if any team still plays out of it — re-assign those teams first.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteVenue(venue) },
      ],
    );
  }

  async function deleteVenue(venue: Venue) {
    setIsDeleting(true);
    try {
      await httpsCallable(functions, 'adminDeleteVenue')({ venueId: venue.id });
      setEditing(null);
    } catch (e: unknown) {
      Alert.alert("Can't delete venue", (e as Error).message ?? 'Something went wrong');
    } finally {
      setIsDeleting(false);
    }
  }

  const body = (
    <>
      <View className="flex-row items-center mb-2.5">
        <Heading size="sm" className="flex-1">Venues ({venues.length})</Heading>
        <Button size="sm" onPress={openNew}>+ New Venue</Button>
      </View>
      {venues.length === 0 ? (
        <Card className="items-center py-8">
          <Body tone="strong" weight="semibold">No venues yet</Body>
          <Body size="sm" className="text-center mt-1">
            Venues let teams share a home ground and tell the fixture generator how many boards
            are available, so it can avoid scheduling too many home games there on the same day.
          </Body>
        </Card>
      ) : (
        <View className="gap-2">
          {venues.map((v) => (
            <ListRow
              key={v.id}
              title={v.name}
              subtitle={`${v.boardCount} board${v.boardCount === 1 ? '' : 's'}${v.address ? ` · ${v.address}` : ''}`}
              onPress={() => openEdit(v)}
            />
          ))}
        </View>
      )}
    </>
  );

  const modal = (
    <Sheet visible={editing !== null} onClose={() => setEditing(null)}>
      <Heading size="lg" className="mb-4">{editing === 'new' ? 'New Venue' : 'Edit Venue'}</Heading>
      <Label>Name</Label>
      <Input value={name} onChangeText={setName} placeholder="e.g. The Red Lion" autoCapitalize="words" autoFocus className="mb-3" />
      <Label>Address (optional)</Label>
      <Input value={address} onChangeText={setAddress} placeholder="12 High St, Birmingham" autoCapitalize="words" className="mb-3" />
      <Label>Contact number (optional)</Label>
      <Input value={venuePhone} onChangeText={setVenuePhone} placeholder="01234 567890" keyboardType="phone-pad" className="mb-3" />
      <Label>Boards available</Label>
      <Input value={boardCount} onChangeText={setBoardCount} placeholder="1" keyboardType="number-pad" className="mb-1" />
      <Body size="xs" className="mb-4">How many teams can play a home fixture here on the same day.</Body>
      <View className="flex-row gap-2.5 mb-2">
        <Button variant="ghost" className="flex-1" disabled={isSaving} onPress={() => setEditing(null)}>Cancel</Button>
        <Button className="flex-1" disabled={isSaving || !name.trim() || !Number(boardCount)} loading={isSaving} onPress={save}>
          Save
        </Button>
      </View>
      {editing !== 'new' && editing && (
        <Button variant="danger" disabled={isDeleting} loading={isDeleting} onPress={() => confirmDelete(editing)}>
          Delete Venue
        </Button>
      )}
    </Sheet>
  );

  if (isDesktop) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AdminShell title="Venues" breadcrumb={[{ label: 'Dashboard', path: '/(protected)/(tabs)/admin' }, { label: 'Venues' }]}>
          <View style={{ maxWidth: 780 }}>{body}</View>
        </AdminShell>
        {modal}
      </>
    );
  }

  return (
    <Screen header={<AppBar title="Venues" />}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
      {modal}
    </Screen>
  );
}
