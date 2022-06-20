import React, { FC } from 'react';
import { StyleProp, StyleSheet, TouchableOpacity, useColorScheme, ViewStyle } from 'react-native';

type OwnProps = {
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export const DataRow: FC<OwnProps> = function DataRow(props) {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <TouchableOpacity
      style={StyleSheet.compose<ViewStyle>(
        [ownStyles.container, isDarkMode ? ownStyles.dark : ownStyles.light],
        props.style
      )}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      activeOpacity={0.7}
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
