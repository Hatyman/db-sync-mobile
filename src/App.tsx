/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * Generated with the TypeScript template
 * https://github.com/react-native-community/react-native-template-typescript
 *
 * @format
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { EntryScreen } from 'screens/entry/EntryScreen';
import { setAxiosFactory } from 'services/api/api-client';
import axios from 'axios';
import { RealmService } from 'services/RealmService';
import { setRealmService } from 'utils/realm-utils';
import { schemeConfig } from 'services/scheme-config';
import { StatusBar, useColorScheme } from 'react-native';

const backendAxios = axios.create({
  baseURL: 'http://192.168.101.210:48903',
});
setAxiosFactory(() => backendAxios);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      useErrorBoundary: true,
      suspense: false,
    },
  },
});

const App = () => {
  const isDarkMode = useColorScheme() === 'dark';
  const realmService = new RealmService(schemeConfig);
  setRealmService(realmService);
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar
        barStyle={isDarkMode ? 'dark-content' : 'light-content'}
        backgroundColor={isDarkMode ? '#333' : '#eee'}
      />
      <EntryScreen />
    </QueryClientProvider>
  );
};

export default App;
