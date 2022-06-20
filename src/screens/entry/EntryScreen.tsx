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
  ViewStyle,
} from 'react-native';
import { Colors } from 'react-native/Libraries/NewAppScreen';
import { Section } from 'components/Section';
import { useRealmData, useTransactions } from 'utils/realm-utils';
import { DataRow } from 'components/DataRow';
import { RealmService } from 'services/RealmService';
import { generateRGBColor, getRandomIntNumber, shouldIUseDarkText } from 'utils/text-utils';
import { getValueIfTruthy } from 'utils/utils';

enum ProductType {
  Undefined,
  Auto,
  Electronic,
  Other,
}

type BoxesScheme = {
  Id: string;
  IsFull: boolean;
  Color: string | null;
  Count: number | null;
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
    <SafeAreaView style={[ownStyles.container, backgroundStyle]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={ownStyles.scrollView}>
        {/*<Header />*/}
        {/*<View*/}
        {/*  style={{*/}
        {/*    backgroundColor: isDarkMode ? Colors.black : Colors.white,*/}
        {/*  }}*/}
        {/*>*/}
        {/*<Button*/}
        {/*  title={'Delete all'}*/}
        {/*  color={'#6a2a2a'}*/}
        {/*  onPress={() => {*/}
        {/*    realm?.write(() => {*/}
        {/*      realm?.deleteAll();*/}
        {/*    });*/}
        {/*    snapshotRealm?.write(() => {*/}
        {/*      snapshotRealm?.deleteAll();*/}
        {/*    });*/}
        {/*  }}*/}
        {/*/>*/}
        {/*<Button*/}
        {/*  title={'Call send transactions'}*/}
        {/*  color={'#d5b350'}*/}
        {/*  onPress={() => {*/}
        {/*    getRealmService()*/}
        {/*      .transportService?.sendFakeTransactions()*/}
        {/*      .catch(e => console.log('e', e));*/}
        {/*  }}*/}
        {/*/>*/}
        <Button
          title={'Add box'}
          onPress={() => {
            realm?.write(() => {
              const id = RealmService.getNewId();
              console.log('id', id);
              realm?.create<BoxesScheme>('Boxes', {
                Id: id,
                IsFull: Math.random() > 0.5,
                Color: generateRGBColor(),
                Count: null,
              });
            });
          }}
          color={'steelblue'}
        />
        {/*<Button*/}
        {/*  title={'Add sale'}*/}
        {/*  onPress={() => {*/}
        {/*    realm?.write(() => {*/}
        {/*      const Id = RealmService.getNewId();*/}
        {/*      console.log('new sale Id', Id);*/}
        {/*      realm?.create<SalesScheme>('Sales', {*/}
        {/*        Id,*/}
        {/*        DateTime: new Date(),*/}
        {/*        OptionalDateTime: addHours(new Date(), 3),*/}
        {/*      });*/}
        {/*    });*/}
        {/*  }}*/}
        {/*/>*/}

        <Section title="Boxes">
          <View style={ownStyles.boxesContainer}>
            {data.map((box, index) => {
              const isDarkText = shouldIUseDarkText(box.Color);

              return (
                <DataRow
                  key={box.Id}
                  onPress={() => {
                    realm?.write(() => {
                      box.IsFull = !box.IsFull;
                      box.Count = getRandomIntNumber(0, 100);
                    });
                  }}
                  onLongPress={() => {
                    realm?.write(() => {
                      // realm?.delete(box);
                      box.Color = generateRGBColor();
                      box.Count = getRandomIntNumber(0, 100);
                    });
                  }}
                  style={StyleSheet.compose<ViewStyle>(
                    ownStyles.box,
                    getValueIfTruthy({ backgroundColor: box.Color! }, Boolean(box.Color))
                  )}
                >
                  {/*<Text adjustsFontSizeToFit={true}>{index}</Text>*/}
                  <Text
                    adjustsFontSizeToFit={true}
                    style={isDarkText ? ownStyles.darkText : ownStyles.lightText}
                  >
                    {box.Id.substring(0, 8)}
                  </Text>
                  {/*<Text adjustsFontSizeToFit={true}>{String(box.IsFull)}</Text>*/}
                  {/*<Text adjustsFontSizeToFit={true}>{box.Color ?? '?'}</Text>*/}
                  <Text
                    adjustsFontSizeToFit={true}
                    style={[
                      isDarkText ? ownStyles.darkText : ownStyles.lightText,
                      ownStyles.bigText,
                    ]}
                  >
                    {box.Count ?? '?'}
                  </Text>
                </DataRow>
              );
            })}
          </View>
        </Section>

        {/*<Section title="Sales">*/}
        {/*  {sales.map((sale, index) => (*/}
        {/*    <DataRow*/}
        {/*      key={sale.Id}*/}
        {/*      onPress={() => {*/}
        {/*        const service = getRealmService();*/}

        {/*        service.safeWrite(() => {*/}
        {/*          const now = new Date();*/}
        {/*          sale.DateTime = now;*/}
        {/*          sale.OptionalDateTime = addHours(now, 2);*/}
        {/*        });*/}
        {/*      }}*/}
        {/*    >*/}
        {/*      <Text adjustsFontSizeToFit={true}>{index}</Text>*/}
        {/*      <Text adjustsFontSizeToFit={true}>{sale.Id.substring(0, 8)}</Text>*/}
        {/*      <Text adjustsFontSizeToFit={true}>{format(sale.DateTime, 'pp')}</Text>*/}
        {/*    </DataRow>*/}
        {/*  ))}*/}
        {/*</Section>*/}

        {/*<Section title="Transactions">*/}
        {/*{transactions.map((transaction, index) => (*/}
        {/*  <DataRow key={transaction.Id}>*/}
        {/*    <Text adjustsFontSizeToFit={true}>{index}</Text>*/}
        {/*    <Text adjustsFontSizeToFit={true}>{JSON.stringify(transaction.toJSON())}</Text>*/}
        {/*  </DataRow>*/}
        {/*))}*/}
        {/*</Section>*/}
        {/*</View>*/}
      </ScrollView>
    </SafeAreaView>
  );
};

const ownStyles = StyleSheet.create({
  highlight: {
    fontWeight: '700',
  },
  container: {
    height: '100%',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'white',
  },
  box: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flexBasis: '48%',
    marginVertical: 5,
  },
  boxesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  bigText: {
    fontSize: 36,
  },
  lightText: {
    color: Colors.lighter,
  },
  darkText: {
    color: Colors.darker,
  },
});
