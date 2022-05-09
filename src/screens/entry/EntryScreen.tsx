import React, { FC } from 'react';
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
import { addHours, format } from 'date-fns';

enum ProductType {
  Undefined,
  Auto,
  Electronic,
  Other,
}

type BoxesScheme = {
  Id: string;
  IsFull: boolean;
};
type SalesScheme = {
  Id: string;
  DateTime: Date;
  OptionalDateTime?: Date | null;
};
type ProductsScheme = {
  Id: string;
  BoxId: string | null;
  Boxes: BoxesScheme | null;
  LastStockUpdatedAt: Date;
  PriceDouble: number;
  PriceFloat: number;
  ProductType: ProductType;
  SaleId: string | null;
  Sales: SalesScheme | null;
  Title: string | null;
};

export const EntryScreen: FC = function EntryScreen() {
  const isDarkMode = useColorScheme() === 'dark';
  const { data, realm, snapshotRealm } = useRealmData<BoxesScheme>({
    type: 'Boxes',
  });
  const {
    data: sales,
    realm: anotherRealm,
    snapshotRealm: anotherSnapshotRealm,
  } = useRealmData<SalesScheme>({
    type: 'Sales',
  });
  // const { data: products } = useRealmData<ProductsScheme>({
  //   type: 'Products',
  // });
  const transactions = useTransactions();

  // console.log('on render', JSON.stringify(transactions));

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
            title={'Call send transactions'}
            color={'#d5b350'}
            onPress={() => {
              getRealmService()
                .transportService?.sendFakeTransactions()
                .catch(e => console.log('e', e));
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
            color={'steelblue'}
          />
          <Button
            title={'Add sale'}
            onPress={() => {
              realm?.write(() => {
                const Id = RealmService.getNewId();
                console.log('new sale Id', Id);
                realm?.create<SalesScheme>('Sales', {
                  Id,
                  DateTime: new Date(),
                  OptionalDateTime: addHours(new Date(), 3),
                });
              });
            }}
          />

          <Section title="Boxes">
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
          </Section>

          <Section title="Sales">
            {sales.map((sale, index) => (
              <DataRow
                key={sale.Id}
                onPress={() => {
                  const service = getRealmService();

                  service.safeWrite(() => {
                    const now = new Date();
                    sale.DateTime = now;
                    sale.OptionalDateTime = addHours(now, 2);
                  });
                }}
              >
                <Text adjustsFontSizeToFit={true}>{index}</Text>
                <Text adjustsFontSizeToFit={true}>{sale.Id}</Text>
                <Text adjustsFontSizeToFit={true}>{format(sale.DateTime, 'pp')}</Text>
              </DataRow>
            ))}
          </Section>

          <Section title="Transactions">
            {/*{transactions.map((transaction, index) => (*/}
            {/*  <DataRow key={transaction.Id}>*/}
            {/*    <Text adjustsFontSizeToFit={true}>{index}</Text>*/}
            {/*    <Text adjustsFontSizeToFit={true}>{JSON.stringify(transaction.toJSON())}</Text>*/}
            {/*  </DataRow>*/}
            {/*))}*/}
          </Section>
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
