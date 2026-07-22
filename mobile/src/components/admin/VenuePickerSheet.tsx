import { useState, useEffect } from 'react';
import { View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { collection, onSnapshot, query, where, orderBy, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { RAW } from '@/lib/theme';
import { Sheet, Heading, Body, Caption, Button, Input, Label, ListRow } from '@/components/ui';
import type { Venue } from '@/types';

interface VenuePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  value: string | null;
  onSelect: (venueId: string | null) => void;
  // Only admins can create venues (firestore.rules `venues` create is
  // admin-only) — captain-facing callers should omit this so they only ever
  // pick from the league's existing list.
  allowCreate?: boolean;
}

export function VenuePickerSheet({ visible, onClose, leagueId, value, onSelect, allowCreate }: VenuePickerSheetProps) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newBoardCount, setNewBoardCount] = useState('1');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!visible || !leagueId) return;
    const unsub = onSnapshot(
      query(collection(db, 'venues'), where('leagueId', '==', leagueId), orderBy('name', 'asc')),
      (snap) => setVenues(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Venue))),
    );
    return unsub;
  }, [visible, leagueId]);

  useEffect(() => {
    if (!visible) {
      setShowCreate(false);
      setNewName('');
      setNewAddress('');
      setNewPhone('');
      setNewBoardCount('1');
    }
  }, [visible]);

  function pick(venueId: string | null) {
    onSelect(venueId);
    onClose();
  }

  async function createVenue() {
    const boardCount = Number(newBoardCount);
    if (!newName.trim() || !Number.isFinite(boardCount) || boardCount < 1) return;
    setIsCreating(true);
    try {
      const ref = await addDoc(collection(db, 'venues'), {
        leagueId,
        name: newName.trim(),
        address: newAddress.trim() || null,
        venuePhone: newPhone.trim() || null,
        boardCount,
        createdAt: serverTimestamp(),
      });
      pick(ref.id);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Heading size="lg" className="mb-4">{showCreate ? 'New Venue' : 'Home Venue'}</Heading>

      {showCreate ? (
        <>
          <Label>Name</Label>
          <Input value={newName} onChangeText={setNewName} placeholder="e.g. The Red Lion" autoCapitalize="words" autoFocus className="mb-3" />
          <Label>Address (optional)</Label>
          <Input value={newAddress} onChangeText={setNewAddress} placeholder="12 High St, Birmingham" autoCapitalize="words" className="mb-3" />
          <Label>Contact number (optional)</Label>
          <Input value={newPhone} onChangeText={setNewPhone} placeholder="01234 567890" keyboardType="phone-pad" className="mb-3" />
          <Label>Boards available</Label>
          <Input value={newBoardCount} onChangeText={setNewBoardCount} placeholder="1" keyboardType="number-pad" className="mb-1" />
          <Caption className="mb-4">How many teams can play a home fixture here on the same day.</Caption>
          <View className="flex-row gap-2.5">
            <Button variant="ghost" className="flex-1" disabled={isCreating} onPress={() => setShowCreate(false)}>Back</Button>
            <Button
              className="flex-1"
              disabled={isCreating || !newName.trim() || !Number(newBoardCount)}
              loading={isCreating}
              onPress={createVenue}
            >
              Create &amp; Select
            </Button>
          </View>
        </>
      ) : (
        <>
          {venues.length === 0 ? (
            <Body size="sm" className="mb-4">No venues yet.</Body>
          ) : (
            <View className="gap-2 mb-2">
              {venues.map((v) => (
                <ListRow
                  key={v.id}
                  title={v.name}
                  subtitle={`${v.boardCount} board${v.boardCount === 1 ? '' : 's'}${v.address ? ` · ${v.address}` : ''}`}
                  onPress={() => pick(v.id)}
                  trailing={value === v.id ? <Body size="xs" tone="brand" weight="semibold">Selected</Body> : undefined}
                />
              ))}
            </View>
          )}
          {value != null && (
            <TouchableOpacity onPress={() => pick(null)} className="py-2 mb-2">
              <Body size="sm" tone="coral" weight="semibold">Clear venue</Body>
            </TouchableOpacity>
          )}
          {allowCreate && (
            <Button variant="secondary" className="mb-2" onPress={() => setShowCreate(true)}>+ New Venue</Button>
          )}
          {isCreating && <ActivityIndicator color={RAW.brand} style={{ marginTop: 8 }} />}
          <Button variant="ghost" className="mt-2" onPress={onClose}>Cancel</Button>
        </>
      )}
    </Sheet>
  );
}
