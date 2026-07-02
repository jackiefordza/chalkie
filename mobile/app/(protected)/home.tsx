import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { router, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { collection, doc, onSnapshot, query, where, getDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import * as S from '@/styles/common';

interface Player { id: string; name: string; claimedByUserId: string | null }

export default function PlayerHomeScreen() {
  const { appUser } = useAuthStore();
  const teamId = appUser?.teamId ?? null;

  const [teamName, setTeamName] = useState('');
  const [divisionName, setDivisionName] = useState('');
  const [captainName, setCaptainName] = useState<string | null>(null);
  const [captainPhone, setCaptainPhone] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!teamId) return;

    const unsubTeam = onSnapshot(doc(db, 'teams', teamId), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setTeamName(data.name ?? '');

      if (data.divisionId) {
        const divSnap = await getDoc(doc(db, 'divisions', data.divisionId));
        if (divSnap.exists()) setDivisionName(divSnap.data().name ?? '');
      }

      if (data.captainUserId) {
        const captainSnap = await getDoc(doc(db, 'users', data.captainUserId));
        if (captainSnap.exists()) {
          const captainData = captainSnap.data();
          setCaptainName(captainData.displayName ?? null);
          // Only surface the phone number if the captain set visibility to 'public'
          setCaptainPhone(captainData.phoneVisibility === 'public' ? (captainData.phone ?? null) : null);
        }
      } else {
        setCaptainName(null);
        setCaptainPhone(null);
      }
    });

    const unsubPlayers = onSnapshot(
      query(collection(db, 'players'), where('teamId', '==', teamId)),
      (snap) => {
        setPlayers(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Player))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setIsLoading(false);
      },
    );

    return () => { unsubTeam(); unsubPlayers(); };
  }, [teamId]);

  const myPlayer = players.find((p) => p.claimedByUserId === appUser?.uid);

  return (
    <LinearGradient colors={S.GRADIENT} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: teamName || 'My Team' }} />
      <ScrollView contentContainerStyle={{ padding: 20 }}>

        {/* Team banner */}
        <BlurView intensity={20} tint="dark" style={{ borderRadius: 20, overflow: 'hidden', marginBottom: 20 }}>
          <View style={[S.glassCard, { alignItems: 'center', paddingVertical: 28 }]}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🎯</Text>
            <Text style={{ color: S.WHITE, fontSize: 24, fontWeight: '700', marginBottom: 4 }}>
              {teamName}
            </Text>
            {divisionName ? (
              <Text style={{ color: S.WHITE_50, fontSize: 14 }}>{divisionName}</Text>
            ) : null}
            {myPlayer && (
              <View style={{
                marginTop: 16, backgroundColor: 'rgba(0,122,255,0.2)',
                borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5,
                borderWidth: 1, borderColor: 'rgba(0,122,255,0.4)',
              }}>
                <Text style={{ color: S.BLUE, fontSize: 13, fontWeight: '600' }}>
                  {myPlayer.name}
                </Text>
              </View>
            )}
          </View>
        </BlurView>

        <TouchableOpacity
          onPress={() => router.push('/(protected)/fixtures')}
          activeOpacity={0.7}
          style={{
            backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 16,
            marginBottom: 20, flexDirection: 'row', alignItems: 'center',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
          }}
        >
          <Text style={{ fontSize: 20, marginRight: 10 }}>🗓</Text>
          <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '600', flex: 1 }}>Fixtures & Results</Text>
          <Text style={{ color: S.WHITE_50 }}>›</Text>
        </TouchableOpacity>

        {/* Captain contact (only shown when captain has set phoneVisibility = 'public') */}
        {captainName && captainPhone && (
          <BlurView intensity={20} tint="dark" style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
            <View style={[S.glassCard, { padding: 16 }]}>
              <Text style={{ color: S.WHITE_50, fontSize: 11, fontWeight: '600', marginBottom: 6 }}>CAPTAIN</Text>
              <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '600', marginBottom: 4 }}>{captainName}</Text>
              <Text style={{ color: S.BLUE, fontSize: 14 }}>{captainPhone}</Text>
            </View>
          </BlurView>
        )}

        {/* Squad list */}
        <Text style={{ color: S.WHITE, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>
          Squad ({players.length})
        </Text>

        {isLoading ? (
          <ActivityIndicator color={S.BLUE} />
        ) : players.length === 0 ? (
          <Text style={{ color: S.WHITE_50, textAlign: 'center', paddingVertical: 20 }}>
            No players on the squad yet
          </Text>
        ) : (
          players.map((player) => {
            const isMe = player.claimedByUserId === appUser?.uid;
            return (
              <View
                key={player.id}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  padding: 14, borderRadius: 12, marginBottom: 8,
                  backgroundColor: isMe ? 'rgba(0,122,255,0.12)' : 'rgba(255,255,255,0.07)',
                  borderWidth: 1,
                  borderColor: isMe ? 'rgba(0,122,255,0.35)' : 'rgba(255,255,255,0.12)',
                }}
              >
                <View style={{
                  width: 36, height: 36, borderRadius: 18, marginRight: 12,
                  backgroundColor: isMe ? 'rgba(0,122,255,0.3)' : 'rgba(255,255,255,0.1)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: isMe ? S.BLUE : S.WHITE_60, fontWeight: '700' }}>
                    {player.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: S.WHITE, fontWeight: isMe ? '700' : '500' }}>
                    {player.name}{isMe ? '  (you)' : ''}
                  </Text>
                  <Text style={{ color: player.claimedByUserId ? '#34C759' : S.WHITE_50, fontSize: 12, marginTop: 1 }}>
                    {player.claimedByUserId ? 'Registered' : 'No account yet'}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </LinearGradient>
  );
}
