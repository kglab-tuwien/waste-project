import axios from 'axios';

import { Layer } from './layer';
import { PickUpInfo, RouteInfo, SolutionInfo } from './types';

const backend = axios.create({
  baseURL: 'http://localhost:4000',
  timeout: 10000,
});

export async function createLayer(layer: Layer, days: number | undefined) {
  console.log(`POST: ${backend.getUri()}/create/${layer}`);
  await backend.post('/create/' + layer, null, {
    params: {
      days: days,
      withDistances: true,
    },
  });
}

/**
 * Count the number of nodes in the graph matching a given layer and node label.
 * @param layer
 * @param nodeLabel
 */
export async function count(layer?: Layer, nodeLabel?: string) {
  console.log(
    `GET: ${backend.getUri()}/count?layer=${layer},nodeLabel=${nodeLabel}`,
  );
  const res = await backend.get('/count', {
    params: {
      layer: layer,
      nodeLabel: nodeLabel,
    },
  });
  return res.data.count;
}

/**
 * Get the pickup locations in the graph for layer 1.
 * @param layer
 * @param alpha
 * @param day
 */
export async function getRoutes(
  day: string,
  alpha: number,
  layer?: Layer,
): Promise<
  {
    routeInfo: RouteInfo;
    routeCoords: {
      lat: number;
      lng: number;
      id: string;
      score: number | null;
    }[];
  }[]
> {
  console.log(
    `GET: ${backend.getUri()}/routes?layer=${layer}&day=${day}&alpha=${alpha}`,
  );
  const res = await backend.get('/routes', {
    params: {
      layer: layer,
      day: day,
      alpha: alpha,
    },
  });
  return res.data.routes;
}

/**
 * Get available days for routes on layer
 */
export async function getDays(layer: Layer): Promise<string[]> {
  console.log(`GET: ${backend.getUri()}/days?layer=${layer}`);
  const res = await backend.get('/days', {
    params: {
      layer: layer,
    },
  });
  return res.data.days;
}

/**
 * Get the static markers for the visualization.
 */
export async function getStaticMarkers(): Promise<{
  base: [number, number];
  dropOff: [number, number];
}> {
  console.log(`GET: ${backend.getUri()}/staticMarkers`);
  const res = await backend.get('/static');
  console.log(res);
  return res.data;
}

/**
 * Get the pickup details by id
 * [
 *         {   year: ...
 *             month: ...
 *             day: ...
 *             dscore: ...
 *             reports: [
 *                {
 *                  rid: ...
 *                  score: ...
 *                  trash:
 *                },
 *                {
 *
 *                }
 *             ],
 *         }
 *     ]
 */
export async function getPickUpById(id: string): Promise<PickUpInfo[]> {
  console.log(`GET: ${backend.getUri()}/pickup?id=${id}`);
  const res = await backend.get('/pickup', {
    params: {
      id: id,
    },
  });
  return res.data;
}

export async function getSolutionDetails(
  layer: Layer,
  alpha: number,
): Promise<SolutionInfo> {
  console.log(
    `GET: ${backend.getUri()}/solution?layer=${layer}&alpha=${alpha}`,
  );
  const res = await backend.get('/solution', {
    params: {
      layer: layer,
      alpha: alpha,
    },
  });
  return res.data;
}
