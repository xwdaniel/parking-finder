import type { NavigatorScreenParams } from '@react-navigation/native';

// --- Search request shape (mirrors brief §4 / §5) -------------------------------

export type SearchMode = 'walk' | 'transit'; // "Park near destination" | "Park + Tube"
export type TimeMode = 'now' | 'arrive_by';

export interface SearchParams {
  destinationLat: number;
  destinationLng: number;
  destinationLabel: string;
  mode: SearchMode;
  timeMode: TimeMode;
  /** ISO-8601 string; present only when timeMode === 'arrive_by'. */
  arrivalTime?: string;
  /** Slider value — max walk-to-destination (walk) or max walk-to-stop (transit). */
  maxWalkMinutes: number;
  includeBus: boolean;
}

// --- Navigation param lists -----------------------------------------------------

export type ParkStackParamList = {
  Search: undefined;
  MapResults: { search: SearchParams };
};

export type RootTabParamList = {
  Park: NavigatorScreenParams<ParkStackParamList>;
  Log: undefined;
};

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootTabParamList {}
  }
}
