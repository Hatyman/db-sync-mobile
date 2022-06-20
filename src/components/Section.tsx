import React from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { Colors } from 'react-native/Libraries/NewAppScreen';

type OwnProps = {
  title: string;
};

export const Section: React.FC<OwnProps> = props => {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <View style={ownStyles.sectionContainer}>
      <Text
        style={[
          ownStyles.sectionTitle,
          {
            color: isDarkMode ? Colors.white : Colors.black,
          },
        ]}
      >
        {props.title}
      </Text>
      {props.children}
    </View>
  );
};

const ownStyles = StyleSheet.create({
  sectionContainer: {
    marginTop: 32,
    marginHorizontal: 10,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
  },
  sectionDescription: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '400',
  },
  highlight: {
    fontWeight: '700',
  },
});
