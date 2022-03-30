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
  return (
    <QueryClientProvider client={queryClient}>
      <EntryScreen />
    </QueryClientProvider>
  );
};

export default App;
