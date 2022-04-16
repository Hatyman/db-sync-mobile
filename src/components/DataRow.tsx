import React, { FC } from 'react';
import { StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { Colors } from 'react-native/Libraries/NewAppScreen';

type OwnProps = {
  onPress?: () => void;
  onLongPress?: () => void;
};

export const DataRow: FC<OwnProps> = function DataRow(props) {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <TouchableOpacity
      style={[ownStyles.container, isDarkMode ? ownStyles.dark : ownStyles.light]}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
    >
      {props.children}
    </TouchableOpacity>
  );
};

const ownStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginHorizontal: 10,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginVertical: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 3,
    gap: 10,
  },
  dark: { backgroundColor: '#2e2e2e', borderColor: '#373737' },
  light: { backgroundColor: '#f1f1f1', borderColor: '#ccc' },
});
