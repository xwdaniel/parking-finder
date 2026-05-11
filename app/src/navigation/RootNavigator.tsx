import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SearchScreen } from '../screens/SearchScreen';
import { MapResultsScreen } from '../screens/MapResultsScreen';
import { LogScreen } from '../screens/LogScreen';
import type { ParkStackParamList, RootTabParamList } from './types';

const ParkStackNav = createNativeStackNavigator<ParkStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();

function ParkStack() {
  return (
    <ParkStackNav.Navigator>
      <ParkStackNav.Screen
        name="Search"
        component={SearchScreen}
        options={{ title: 'Find free parking' }}
      />
      <ParkStackNav.Screen
        name="MapResults"
        component={MapResultsScreen}
        options={{ title: 'Results' }}
      />
    </ParkStackNav.Navigator>
  );
}

export function RootNavigator() {
  // Tab bar icons land with @expo/vector-icons in a later step; labels are fine for now.
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Park" component={ParkStack} options={{ title: 'Park' }} />
      <Tab.Screen name="Log" component={LogScreen} options={{ title: 'Log' }} />
    </Tab.Navigator>
  );
}
