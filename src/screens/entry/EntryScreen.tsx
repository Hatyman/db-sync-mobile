import React, { FC, useEffect } from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import {
  Colors,
  DebugInstructions,
  Header,
  LearnMoreLinks,
  ReloadInstructions,
} from 'react-native/Libraries/NewAppScreen';
import { Section } from 'components/Section';
import { getRealmService, useRealmData, useTransactions } from 'utils/realm-utils';
import { DataRow } from 'components/DataRow';
import { RealmService } from 'services/RealmService';
import { HubConnectionState } from '@microsoft/signalr';

type BoxesScheme = {
  Id: string;
  IsFull: boolean;
};

export const EntryScreen: FC = function EntryScreen() {
  const isDarkMode = useColorScheme() === 'dark';
  const { data, realm, snapshotRealm } = useRealmData<BoxesScheme>({
    type: 'Boxes',
  });
  const transactions = useTransactions();

  useEffect(() => {
    const service = getRealmService();
    const state = service.transportService.connectionState;
    console.log('state', state);
    (async () => {
      const response = await service.transportService.invokeTest<string>('some test message');
      console.log('response', response);
      await service.transportService.sendTest('sent string');
    })();
  }, []);

  const backgroundStyle = {
    backgroundColor: isDarkMode ? Colors.darker : Colors.lighter,
  };
  return (
    <SafeAreaView style={backgroundStyle}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={backgroundStyle}>
        <Header />
        <View
          style={{
            backgroundColor: isDarkMode ? Colors.black : Colors.white,
          }}
        >
          <Button
            title={'Delete all'}
            color={'#6a2a2a'}
            onPress={() => {
              realm?.write(() => {
                realm?.deleteAll();
              });
              snapshotRealm?.write(() => {
                snapshotRealm?.deleteAll();
              });
            }}
          />
          <Button
            title={'Add box'}
            onPress={() => {
              realm?.write(() => {
                const id = RealmService.getNewId();
                console.log('id', id);
                realm?.create<BoxesScheme>('Boxes', {
                  Id: id,
                  IsFull: Math.random() > 0.5,
                });
              });
            }}
          />
          {data.map((box, index) => (
            <DataRow
              key={box.Id}
              onPress={() => {
                realm?.write(() => {
                  box.IsFull = !box.IsFull;
                });
              }}
              onLongPress={() => {
                realm?.write(() => {
                  realm?.delete(box);
                });
              }}
            >
              <Text adjustsFontSizeToFit={true}>{index}</Text>
              <Text adjustsFontSizeToFit={true}>{box.Id}</Text>
              <Text adjustsFontSizeToFit={true}>{String(box.IsFull)}</Text>
            </DataRow>
          ))}
          <Section title="Step One">
            Edit <Text style={ownStyles.highlight}>App.tsx</Text> to change this screen and then
            come back to see your edits.
          </Section>
          {transactions.map((transaction, index) => (
            <DataRow key={transaction.Id}>
              <Text adjustsFontSizeToFit={true}>{index}</Text>
              <Text adjustsFontSizeToFit={true}>{JSON.stringify(transaction.toJSON())}</Text>
            </DataRow>
          ))}
          <Section title="See Your Changes">
            <ReloadInstructions />
          </Section>
          <Section title="Debug">
            <DebugInstructions />
          </Section>
          <Section title="Learn More">Read the docs to discover what to do next:</Section>
          <LearnMoreLinks />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const ownStyles = StyleSheet.create({
  highlight: {
    fontWeight: '700',
  },
});
