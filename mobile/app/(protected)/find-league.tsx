import { useState, useEffect } from 'react';
import { View, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { RAW } from '@/lib/theme';
import { Heading, Body, Card, Input } from '@/components/ui';

interface LeagueDoc { id: string; name: string }

export default function FindLeagueScreen() {
  const [search, setSearch] = useState('');
  const [allLeagues, setAllLeagues] = useState<LeagueDoc[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { setLeague, setTeam, setSkipChoosePath } = useOnboardingStore();

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'leagues'),
      (snap) => {
        setAllLeagues(snap.docs.map((d) => ({ id: d.id, name: d.data().name as string })));
        setIsLoadingLeagues(false);
      },
      () => {
        setError('Could not load leagues. Check your connection.');
        setIsLoadingLeagues(false);
      },
    );
    return unsub;
  }, []);

  const filtered = search.trim().length < 2
    ? []
    : allLeagues.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()));

  function selectLeague(league: LeagueDoc) {
    setLeague(league);
    setTeam(null);
    setSkipChoosePath(false);
    router.push('/(protected)/choose-path');
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <Stack.Screen options={{ title: 'Find Your League' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingVertical: 24 }} keyboardShouldPersistTaps="handled">
          <Card>
            <Heading className="mb-1">Search for your league</Heading>
            <Body size="sm" className="mb-4">Type at least 2 characters</Body>

            {error ? (
              <Card tone="coral" className="mb-4" padded={false}>
                <Body tone="coral" className="p-3">{error}</Body>
              </Card>
            ) : null}

            <Input value={search} onChangeText={setSearch} placeholder="e.g. Midlands Darts League" autoCorrect={false} />

            {isLoadingLeagues && <ActivityIndicator color={RAW.brand} style={{ marginTop: 16 }} />}

            {!isLoadingLeagues && search.trim().length >= 2 && (
              <View className="mt-3">
                {filtered.length === 0 ? (
                  <Body className="text-center py-3">No leagues found for "{search}"</Body>
                ) : (
                  filtered.map((league) => (
                    <TouchableOpacity
                      key={league.id}
                      onPress={() => selectLeague(league)}
                      activeOpacity={0.7}
                      className="py-3.5 px-4 rounded-xl mb-2 bg-surface-2 dark:bg-surface-2-dark"
                    >
                      <Body tone="strong">{league.name}</Body>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
