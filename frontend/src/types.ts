import { Layer } from './layer';

export type Inputs = {
  layer: Layer;
  limit: number | null;
};

export type SolutionInfo = {
  routeLength: number;
  routeDuration: number;
  stops: number;
  cleanStops: number;
  potentialCleanStops: number;
};

export type RouteInfo = {
  routeId: string;
  routeLength: number;
  routeType: 'clean' | 'dirty';
  stops: number;
  color?: string;
  alpha?: number;
  maxRouteLength?: number;
  maxStopsPerRoute?: number;
};

export type Timestamp = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  nanosecond: number;
};

export type PickUpInfo = {
  year: number;
  month: number;
  day: number;
  dscore: number;
  reports: {
    rid: number;
    rscore: number;
    timestamp: {
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      second: number;
      nanosecond: number;
    };
    trash: {
      type: string;
      count: number;
    }[];
  }[];
};
